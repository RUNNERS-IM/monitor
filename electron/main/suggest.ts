// "Worth doing now": which apps to quit and what to empty when the computer is slow or the disk is nearly full.
// The panel shows them at the top and the slow-computer notice offers the first one as a button.
import { execFile } from "node:child_process";
import { diskPercent, memoryPercent, type AppUse, type Snapshot } from "./types";

export type Suggestion =
  | { action: "quit"; reason: "memory" | "cpu"; name: string; devServer: boolean; folder: string | null; runningSecs: number | null; bytes: number; cpuPercent: number }
  | { action: "empty"; reason: "disk"; kind: string; bytes: number };

// Why: an app used in the last half hour is probably still wanted, so it is never suggested.
const RECENT_MS = 30 * 60 * 1000;
const MEMORY_FROM_PERCENT = 85;
const DISK_FROM_PERCENT = 85;
const MIN_APP_BYTES = 512 * 1024 ** 2;
const MIN_CPU_PERCENT = 20;
const MIN_EMPTY_BYTES = 1024 ** 3;
const MAX_QUIT = 2;
const MAX_EMPTY = 2;

/** When each app (by the name the panel shows) was last the frontmost one. */
const lastFront = new Map<string, number>();
/** Why: Monitor itself may have started minutes ago, so before it has watched for half an hour nothing counts as unused. */
const watchingSince = Date.now();

/** Notes which app is in front. macOS only: `lsappinfo` names it; elsewhere every app counts as recently used. */
export function noteFrontApp(): void {
  if (process.platform !== "darwin") return;
  execFile("/bin/sh", ["-c", "lsappinfo info -only name \"$(lsappinfo front)\""], { timeout: 2000 }, (error, out) => {
    const name = /"LSDisplayName"="(.*)"/.exec(out)?.[1];
    if (!error && name) lastFront.set(name, Date.now());
  });
}

function recentlyUsed(app: AppUse, now: number): boolean {
  if (process.platform !== "darwin" || now - watchingSince < RECENT_MS) return app.kind !== "devServer";
  return now - (lastFront.get(app.name) ?? 0) < RECENT_MS;
}

/** Up to two apps to quit and two kinds to empty, biggest win first. */
export function suggestions(snap: Snapshot, cleanup: { kinds?: { kind: string; bytes: number }[] } | null): Suggestion[] {
  const now = Date.now();
  const quit = (reason: "memory" | "cpu", app: AppUse): Suggestion => ({
    action: "quit",
    reason,
    name: app.name,
    devServer: app.kind === "devServer",
    folder: app.folder,
    runningSecs: app.runningSecs,
    bytes: app.memory,
    cpuPercent: app.cpuPercent,
  });
  const out: Suggestion[] = [];
  if (snap.slowMemory || memoryPercent(snap) >= MEMORY_FROM_PERCENT) {
    out.push(
      ...snap.topMemory
        .filter((app) => app.quittable && app.memory >= MIN_APP_BYTES && !recentlyUsed(app, now))
        .slice(0, MAX_QUIT)
        .map((app) => quit("memory", app)),
    );
  }
  if (snap.slowCpu && out.length < MAX_QUIT) {
    const app = snap.topCpu.find(
      (app) => app.quittable && app.cpuPercent >= MIN_CPU_PERCENT && !recentlyUsed(app, now) && !out.some((s) => s.action === "quit" && s.name === app.name),
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
