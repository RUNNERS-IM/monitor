// "Worth doing now": which apps to quit and what to empty when the computer is slow or the disk is nearly full.
// The panel shows them at the top and the slow-computer notice offers the first one as a button.
import { native } from "./native";
import { diskPercent, type AppUse, type Snapshot } from "./types";

export type Suggestion =
  | { action: "quit"; reason: "memory" | "cpu"; name: string; quit: "app" | "process"; devServer: boolean; folder: string | null; runningSecs: number | null; bytes: number; cpuPercent: number }
  | { action: "empty"; reason: "disk"; kind: string; bytes: number };

// Why: an app used in the last half hour is probably still wanted, so it is never suggested.
const RECENT_MS = 30 * 60 * 1000;
// Why: a program averaging more than this (percent of the whole computer) over the half hour is working, window or not.
const IN_USE_CPU_PERCENT = 1;
const DISK_FROM_PERCENT = 85;
const MIN_APP_BYTES = 512 * 1024 ** 2;
const MIN_CPU_PERCENT = 20;
const MIN_EMPTY_BYTES = 1024 ** 3;
const MAX_QUIT = 2;
const MAX_EMPTY = 2;

/** When each app (by bundle id) was last the frontmost one. */
const lastFront = new Map<string, number>();
/** Each reading's CPU per entry name over the last half hour, oldest first. */
const cpuHistory: { at: number; cpu: Map<string, number> }[] = [];
/** Why: Monitor itself may have started minutes ago, so before it has watched for half an hour nothing counts as unused. */
const watchingSince = Date.now();

/** Notes which app is in front. macOS only (elsewhere every app counts as recently used), asked inside Monitor
 *  instead of by starting programs. Why the bundle id: the shown name is translated ("터미널") while the panel's name
 *  is the `.app` folder ("Terminal"). */
export function noteFrontApp(): void {
  if (process.platform !== "darwin") return;
  const id = native.frontBundleId();
  if (id) lastFront.set(id, Date.now());
}

/** Notes each listed entry's CPU, so a program working in the background counts as used. */
export function noteCpu(snap: Snapshot): void {
  const now = Date.now();
  const cpu = new Map<string, number>();
  for (const app of [...snap.topCpu, ...snap.topMemory]) cpu.set(app.name, app.cpuPercent);
  cpuHistory.push({ at: now, cpu });
  while (cpuHistory.length > 0 && now - cpuHistory[0].at > RECENT_MS) cpuHistory.shift();
}

/** Average CPU over the half hour; a reading where the entry was not listed counts as idle. */
function averageCpu(name: string): number {
  if (cpuHistory.length === 0) return 0;
  return cpuHistory.reduce((sum, reading) => sum + (reading.cpu.get(name) ?? 0), 0) / cpuHistory.length;
}

function wasRecentlyUsed(app: AppUse, now: number): boolean {
  if (averageCpu(app.name) > IN_USE_CPU_PERCENT) return true;
  if (process.platform !== "darwin" || now - watchingSince < RECENT_MS) return app.kind !== "devServer";
  return app.bundleId != null && now - (lastFront.get(app.bundleId) ?? 0) < RECENT_MS;
}

/** Up to two apps to quit and two kinds to empty, biggest win first. */
export function suggestions(snap: Snapshot, cleanup: { kinds?: { kind: string; bytes: number }[] } | null, demo = false): Suggestion[] {
  const now = Date.now();
  // Why: a demo run has watched nothing, so for screenshots every made-up app counts as unused.
  const recentlyUsed = (app: AppUse, at: number) => !demo && wasRecentlyUsed(app, at);
  const quit = (reason: "memory" | "cpu", app: AppUse): Suggestion => ({
    action: "quit",
    reason,
    name: app.name,
    quit: app.quit ?? "process",
    devServer: app.kind === "devServer",
    folder: app.folder,
    runningSecs: app.runningSecs,
    bytes: app.memory,
    cpuPercent: app.cpuPercent,
  });
  const out: Suggestion[] = [];
  // Why: a Mac uses most of its memory on purpose (cache), so only macOS's own pressure level says it is short.
  if (snap.slowMemory) {
    out.push(
      ...snap.topMemory
        .filter((app) => app.quit != null && app.memory >= MIN_APP_BYTES && !recentlyUsed(app, now))
        .slice(0, MAX_QUIT)
        .map((app) => quit("memory", app)),
    );
  }
  if (snap.slowCpu && out.length < MAX_QUIT) {
    const app = snap.topCpu.find(
      (app) => app.quit != null && app.cpuPercent >= MIN_CPU_PERCENT && !recentlyUsed(app, now) && !out.some((s) => s.action === "quit" && s.name === app.name),
    );
    if (app) out.push(quit("cpu", app));
  }
  if (diskPercent(snap) >= DISK_FROM_PERCENT) {
    out.push(
      ...(cleanup?.kinds ?? [])
        .filter((part) => part.bytes >= MIN_EMPTY_BYTES)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, MAX_EMPTY)
        .map((part): Suggestion => ({ action: "empty", reason: "disk", kind: part.kind, bytes: part.bytes })),
    );
  }
  return out;
}
