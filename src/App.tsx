// The tray panel, laid out like Split's macOS menu (src/runners-menu.css): a heading line with the computer's name,
// the five summary rows (each opens its details in a box below it), "why it is slow" on top while the computer is
// slow, then the menu commands. It is the one menu people use; the right-click native menu holds the same commands.
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cpu,
  HardDrive,
  Info,
  MemoryStick,
  Recycle,
  RefreshCw,
  Square,
  SquareCheck,
  SquareTerminal,
  SquareX,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { t } from "./i18n";
import * as native from "./native";
import type { MenuCommand, MenuState } from "./native";
import type { AppUse, Cleanup, Pressure, Snapshot } from "./types";
import "./runners-menu.css";
import "./App.css";

type Section = "cpu" | "memory" | "disk" | "work" | "cleanup";

type Level = "ok" | "high" | "full";

const REFRESH_MS = 3000;
// Why: the cleanup numbers change only every 30 minutes, so the panel asks for them far less often.
const CLEANUP_REFRESH_MS = 60_000;
// Why: the same stroke as Prompt and Split so the three apps' icons look equally light.
const ICON_STROKE = 1.5;
const ICON_SIZE = 16;
// Why: apps under this share are noise next to the one actually loading the computer.
const MIN_TOP_CPU = 1;
// Why: Spotlight indexing shows up as these processes and is a common cause of a slow Mac with big source folders.
const SPOTLIGHT = /^(mds|mds_stores|mdworker|mdworker_shared)$/i;

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function percent(used: number, total: number): number {
  return total === 0 ? 0 : (used * 100) / total;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600) % 24;
  const d = Math.floor(secs / 86400);
  if (d > 0) return t("time.days", { d, h });
  if (h > 0) return t("time.hours", { h, m });
  return t("time.minutes", { m });
}

// Why: the same thresholds colour every bar so a full disk and a busy CPU read the same way.
function level(value: number): Level {
  if (value >= 90) return "full";
  if (value >= 70) return "high";
  return "ok";
}

// Why: macOS fills spare memory with cache, so memory is coloured by pressure; a high "used" with normal pressure is fine.
const PRESSURE_LEVEL: Record<Pressure, Level> = { normal: "ok", warn: "high", critical: "full" };

function Icon({ icon: Glyph }: { icon: LucideIcon }) {
  return <Glyph size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />;
}

/** The last ten minutes as a line, so a short spike and a steady load look different. */
function Sparkline({ values, tone }: { values: number[]; tone: Level }) {
  if (values.length < 2) return null;
  const step = 100 / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${(20 - (Math.min(v, 100) / 100) * 18 - 1).toFixed(2)}`).join(" ");
  return (
    <svg className={`spark ${tone}`} viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The small bar in front of a summary number, so how full something is reads without opening the row. */
function MiniBar({ value, tone }: { value: number; tone: Level }) {
  return (
    <span className="mini-track" aria-hidden>
      <span className={`mini-fill ${tone}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </span>
  );
}

/** One line inside an open box: a name, its state, and maybe a button (Quit, Pause). */
function Row({
  text,
  state,
  tone,
  action,
}: {
  text: string;
  state: string;
  tone?: "busy" | "quiet";
  action?: { label: string; run: () => Promise<unknown> };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const press = () => {
    if (!action) return;
    setPending(true);
    setError(null);
    action
      .run()
      .catch((e) => setError(String(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : e)))
      .finally(() => setPending(false));
  };
  return (
    <>
      <div className="row">
        <span className="row-text">{text}</span>
        <span className="row-right">
          <span className={`row-state ${tone ?? ""}`}>{state}</span>
          {action && (
            <button type="button" className="row-button" disabled={pending} onClick={press}>
              {action.label}
            </button>
          )}
        </span>
      </div>
      {error && <div className="rm-note rm-full">{t("action.failed", { error })}</div>}
    </>
  );
}

/** One summary row of the menu. Clicking it opens its details in a box right below. */
function SummaryRow({
  icon,
  label,
  value,
  tone,
  gauge,
  badge,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Colours the number only when it is high, so a normal row stays plain. */
  tone?: Level;
  gauge?: React.ReactNode;
  badge?: { text: string; tone: Level };
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <button type="button" className="rm-item summary-row" aria-expanded={open} onClick={onToggle}>
        <Icon icon={icon} />
        <span className="rm-label">{label}</span>
        <span className="rm-trailing">
          {badge && <span className={`badge ${badge.tone}`}>{badge.text}</span>}
          {gauge}
          <span className={`value ${tone && tone !== "ok" ? `rm-${tone}` : ""}`}>{value}</span>
          <Chevron size={12} strokeWidth={ICON_STROKE} className="chevron" aria-hidden />
        </span>
      </button>
      {open && <div className="rm-group details">{children}</div>}
    </>
  );
}

/** Build tools and simulators get a note instead of Quit, so a build another session runs is never broken from here. */
function appState(app: AppUse, amount: string): string {
  if (app.kind === "build") return app.folder ? t("app.buildIn", { amount, folder: app.folder }) : t("app.build", { amount });
  if (app.kind === "simulator") return t("app.simulator", { amount });
  return amount;
}

function formatClock(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Why: one colour per app in the "who uses it" bar; claude keeps purple so it reads the same every time.
const APP_COLOURS = ["#ff9f0a", "#bf5af2", "#64d2ff", "#30d158"];
const CLAUDE_COLOUR = "#bf5af2";

type Part = { key: string; label: string; amount: string; size: number; colour: string; app?: AppUse };

/** Colours for the apps in order: claude always purple, the others take the next free colour. */
function appParts(apps: AppUse[], size: (app: AppUse) => number, amount: (app: AppUse) => string): Part[] {
  const claudeShown = apps.some((app) => app.sessions !== null);
  const palette = claudeShown ? APP_COLOURS.filter((colour) => colour !== CLAUDE_COLOUR) : APP_COLOURS;
  let next = 0;
  return apps.map((app) => ({
    key: `app-${app.name}`,
    label: app.sessions !== null ? t("slow.claudeSessions", { count: app.sessions }) : app.name,
    amount: appState(app, amount(app)),
    size: size(app),
    colour: app.sessions !== null ? CLAUDE_COLOUR : palette[next++ % palette.length],
    app,
  }));
}

/** The parts of memory, adding up to the total: top apps, system, cache, other apps and the free part (left empty). */
function memoryParts(snap: Snapshot): { parts: Part[]; total: number } {
  const apps = appParts(snap.topMemory, (app) => app.memory, (app) => formatGb(app.memory));
  const system = snap.memoryWired + snap.memoryCompressed;
  const known = apps.reduce((sum, part) => sum + part.size, 0) + system + snap.memoryCache + snap.memoryFree;
  const other = Math.max(0, snap.memoryTotal - known);
  const parts: Part[] = [
    ...apps,
    { key: "system", label: t("slow.system"), amount: formatGb(system), size: system, colour: "#8e8e93" },
    { key: "cache", label: t("slow.cache"), amount: formatGb(snap.memoryCache), size: snap.memoryCache, colour: "#c7c7cc" },
    { key: "other", label: t("slow.other"), amount: formatGb(other), size: other, colour: "var(--other-apps)" },
  ];
  // Why: apps' sizes count shared pages more than once, so the parts can add up past the total; the bar then scales down.
  return { parts: parts.filter((part) => part.size > 0), total: Math.max(snap.memoryTotal, known + other) };
}

/** The parts of the CPU in percent of the whole computer: top apps, other apps and the idle part (left empty). */
function cpuParts(snap: Snapshot): { parts: Part[]; total: number } {
  const shown = snap.topCpu.filter((app) => app.cpuPercent >= MIN_TOP_CPU);
  const apps = appParts(shown, (app) => app.cpuPercent, (app) => `${Math.round(app.cpuPercent)}%`);
  const used = apps.reduce((sum, part) => sum + part.size, 0);
  const other = Math.max(0, snap.cpuPercent - used);
  const parts: Part[] = [
    ...apps,
    { key: "other", label: t("slow.other"), amount: `${Math.round(other)}%`, size: other, colour: "var(--other-apps)" },
  ];
  return { parts: parts.filter((part) => part.size > 0), total: Math.max(100, used + other) };
}

const KIND_COLOURS = { cache: "#ff9f0a", packages: "#64d2ff", build: "#bf5af2" } as const;

/** The parts of the disk: what could be cleaned, by kind, then the rest of the used space (the free part left empty). */
function diskParts(snap: Snapshot, cleanup: Cleanup | null): { parts: Part[]; total: number } {
  // Why: a result saved by an older version has no split, so the whole cleanup total shows as one part.
  const kinds = cleanup ? (cleanup.kinds?.length ? cleanup.kinds : [{ kind: "cache" as const, bytes: cleanup.total }]) : [];
  const cleanable: Part[] = kinds.map((item) => ({
    key: item.kind,
    label: cleanup?.kinds?.length ? t(`disk.${item.kind}`) : t("panel.cleanup"),
    amount: formatGb(item.bytes),
    size: item.bytes,
    colour: KIND_COLOURS[item.kind],
  }));
  const rest = Math.max(0, snap.diskUsed - cleanable.reduce((sum, part) => sum + part.size, 0));
  const parts: Part[] = [...cleanable, { key: "rest", label: t("disk.rest"), amount: formatGb(rest), size: rest, colour: "#8e8e93" }];
  return { parts: parts.filter((part) => part.size > 0), total: snap.diskTotal };
}

/** One line under the bar: colour square, name, amount, and Quit for an app that can be quit. */
function Legend({ part }: { part: Part }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const app = part.app;
  const quit = () => {
    if (!app) return;
    setPending(true);
    setError(null);
    native
      .quitApp(app.name)
      .catch((e) => setError(String(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : e)))
      .finally(() => setPending(false));
  };
  const note = app?.sessions != null ? t("slow.claudeNote") : null;
  return (
    <>
      <div className="legend">
        <span className="swatch" style={{ background: part.colour }} aria-hidden />
        <span className="legend-label">{part.label}</span>
        <span className="legend-amount">{part.amount}</span>
        {app?.quittable && (
          <button type="button" className="row-button" disabled={pending} onClick={quit}>
            {t("slow.quit")}
          </button>
        )}
      </div>
      {note && <div className="rm-note legend-note">{note}</div>}
      {error && <div className="rm-note rm-full">{t("action.failed", { error })}</div>}
    </>
  );
}

/** Who fills the CPU, memory or disk: one bar with a colour per part, and a line (with Quit for an app) per part. */
function Breakdown({ parts, total, label }: { parts: Part[]; total: number; label: string }) {
  return (
    <>
      <div className="stack" role="img" aria-label={label}>
        {parts.map((part) => (
          <span key={part.key} style={{ width: `${(part.size * 100) / total}%`, background: part.colour }} />
        ))}
      </div>
      {parts.map((part) => (
        <Legend key={part.key} part={part} />
      ))}
    </>
  );
}

/** The menu commands under the readings, the same lines as the right-click menu. */
function Commands() {
  const [state, setState] = useState<MenuState | null>(null);
  useEffect(() => {
    void native.menuState().then(setState);
    // Why: the right-click menu can change the same settings while the panel stays loaded.
    const again = () => void native.menuState().then(setState);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);
  const run = (name: MenuCommand) => void native.command(name).then(setState);
  const line = (name: MenuCommand, icon: LucideIcon, label: string) => (
    <button type="button" className="rm-item" onClick={() => run(name)}>
      <Icon icon={icon} />
      <span className="rm-label">{label}</span>
    </button>
  );
  return (
    <>
      {line("login", state?.openAtLogin ? SquareCheck : Square, t("menu.openAtLogin"))}
      {line("autoUpdate", state?.autoUpdate ? SquareCheck : Square, t("menu.autoUpdate"))}
      <div className="rm-separator" />
      {line("about", Info, t("menu.about"))}
      {line("updates", RefreshCw, t("menu.checkUpdates"))}
      {line("help", CircleHelp, t("menu.help"))}
      <div className="rm-separator" />
      {line("quit", SquareX, t("menu.quit"))}
    </>
  );
}

// Why: a fixed window height left empty space under the last row, so the window follows the panel's height.
function useFitWindow(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => native.fitHeight(Math.ceil(node.getBoundingClientRect().height)));
    observer.observe(node);
    return () => observer.disconnect();
  });
}

function usePolling<T>(load: () => Promise<T | null>, everyMs: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      load().then((next) => {
        if (alive && next) setValue(next);
      });
    void read();
    const timer = setInterval(read, everyMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load, everyMs]);
  return value;
}

function App() {
  const snap = usePolling<Snapshot>(native.snapshot, REFRESH_MS);
  const cleanup = usePolling<Cleanup>(native.cleanup, CLEANUP_REFRESH_MS);
  // Why: a debug run can start with a row open (`VITE_MONITOR_EXPAND=work`) so it can be captured without clicking.
  const debugOpen = import.meta.env.DEV ? ((import.meta.env.VITE_MONITOR_EXPAND as Section | undefined) ?? null) : null;
  const [open, setOpen] = useState<Section | null>(debugOpen);
  const panelRef = useRef<HTMLElement>(null);
  useFitWindow(panelRef);
  // Why: the slow box at the top repeated what the row shows, so a slow computer now opens the row that is short instead.
  const slowRow: Section | null = snap?.slowMemory ? "memory" : snap?.slowCpu ? "cpu" : null;
  useEffect(() => {
    if (slowRow && !debugOpen) setOpen(slowRow);
  }, [slowRow, debugOpen]);

  if (!snap) {
    return (
      <main ref={panelRef} className="panel">
        <div className="rm-note">{t("panel.loading")}</div>
      </main>
    );
  }

  const toggle = (section: Section) => setOpen((now) => (now === section ? null : section));
  const slow = snap.slowMemory || snap.slowCpu;
  const memory = percent(snap.memoryUsed, snap.memoryTotal);
  const disk = percent(snap.diskUsed, snap.diskTotal);
  const memoryTone = PRESSURE_LEVEL[snap.memoryPressure];
  const spotlightBusy = snap.topCpu.some((app) => SPOTLIGHT.test(app.name) && app.cpuPercent >= MIN_TOP_CPU);
  const cpuBreakdown = cpuParts(snap);
  const memoryBreakdown = memoryParts(snap);
  const quitNote = (parts: Part[]) => parts.some((part) => part.app?.quittable) && <div className="rm-note">{t("slow.quitNote")}</div>;
  const idleRunners = snap.runners.filter((runner) => !runner.busy && !runner.pausedUntil).length;
  const busyRunners = snap.runners.filter((runner) => runner.busy && !runner.pausedUntil).length;
  const people = snap.claudeSessions.filter((session) => session.human).length;
  const jobs = snap.claudeSessions.length - people;
  const workValue = [
    ...(snap.heavyJob ? [t("summary.heavy")] : []),
    jobs > 0 ? t("summary.claudeWithJobs", { count: people, jobs }) : t("summary.claude", { count: people }),
    busyRunners > 0 ? t("summary.runnersBusy", { count: busyRunners }) : t("summary.runnersIdle", { count: idleRunners }),
  ].join(" · ");
  const status = snap.slowMemory ? "slowMemory" : "slowCpu";
  const cpuTone = level(snap.cpuPercent);
  const diskTone = level(disk);

  return (
    <main ref={panelRef} className="panel">
      <header className="head">
        <span className="host">{snap.host}</span>
        <span className="os">{snap.os}</span>
        {/* Why: a "normal" badge on every open said nothing, so the badge shows only when something is wrong. */}
        {slow && <span className={`badge ${snap.memoryPressure === "critical" ? "full" : "high"}`}>{t(`status.${status}`)}</span>}
        {snap.popup && (
          <button type="button" className="close" aria-label={t("popup.close")} title={t("popup.close")} onClick={() => void native.closePopup()}>
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        )}
      </header>
      <div className="rm-separator" />
      <SummaryRow
        icon={Cpu}
        label={t("panel.cpu")}
        value={`${Math.round(snap.cpuPercent)}%`}
        tone={cpuTone}
        gauge={
          <span className="mini-spark">
            <Sparkline values={snap.cpuHistory} tone={cpuTone} />
          </span>
        }
        open={open === "cpu"}
        onToggle={() => toggle("cpu")}
      >
        <Sparkline values={snap.cpuHistory} tone={cpuTone} />
        <div className="rm-note">{t("panel.cpuDetail")}</div>
        <Breakdown {...cpuBreakdown} label={t("panel.cpu")} />
        {snap.slowCpu && <div className="rm-note">{t("slow.cpu")}</div>}
        {spotlightBusy && <div className="rm-note">{t("slow.spotlight")}</div>}
        {quitNote(cpuBreakdown.parts)}
      </SummaryRow>
      <SummaryRow
        icon={MemoryStick}
        label={t("panel.memory")}
        value={`${Math.round(memory)}%`}
        tone={memoryTone}
        gauge={<MiniBar value={memory} tone={memoryTone} />}
        badge={snap.memoryPressure === "normal" ? undefined : { text: t(`panel.pressure.${snap.memoryPressure}`), tone: memoryTone }}
        open={open === "memory"}
        onToggle={() => toggle("memory")}
      >
        <Sparkline values={snap.memoryHistory} tone={memoryTone} />
        <div className="rm-note">{`${formatGb(snap.memoryUsed)} / ${formatGb(snap.memoryTotal)}`}</div>
        <Breakdown {...memoryBreakdown} label={t("panel.memory")} />
        {snap.swapUsed > 0 && <div className="rm-note">{t("slow.swap", { size: formatGb(snap.swapUsed) })}</div>}
        {quitNote(memoryBreakdown.parts)}
      </SummaryRow>
      <SummaryRow
        icon={HardDrive}
        label={t("panel.disk")}
        value={`${Math.round(disk)}%`}
        tone={diskTone}
        gauge={<MiniBar value={disk} tone={diskTone} />}
        open={open === "disk"}
        onToggle={() => toggle("disk")}
      >
        <div className="rm-note">
          {`${formatGb(snap.diskUsed)} / ${formatGb(snap.diskTotal)} · ${t("panel.diskFree", { free: formatGb(snap.diskTotal - snap.diskUsed) })}`}
        </div>
        <Breakdown {...diskParts(snap, cleanup)} label={t("panel.disk")} />
        <div className="rm-note">{cleanup ? t("disk.cleanupNote") : t("panel.cleanupMeasuringNote")}</div>
      </SummaryRow>
      <SummaryRow icon={SquareTerminal} label={t("panel.work")} value={workValue} open={open === "work"} onToggle={() => toggle("work")}>
        {snap.heavyJob && (
          <>
            <Row
              text={t("panel.heavyRow", { name: snap.heavyJob.name || "claude", command: snap.heavyJob.command })}
              state={formatDuration(snap.heavyJob.runningSecs)}
              tone="busy"
            />
            <div className="rm-note">{t("panel.heavyNote")}</div>
            <div className="group-gap" />
          </>
        )}
        {snap.claudeSessions.length === 0 && <div className="rm-note">{t("panel.claudeEmpty")}</div>}
        {snap.claudeSessions.map((session) => (
          <Row
            key={session.pid}
            text={t("panel.claudeRow", { name: session.name ?? (session.human ? "claude" : t("panel.claudeJob")), time: formatDuration(session.runningSecs) })}
            state={t(session.busy ? "panel.claudeBusy" : "panel.claudeIdle")}
            tone={session.busy ? "busy" : "quiet"}
          />
        ))}
        <div className="group-gap" />
        <div className="rm-heading heading-icon">
          <Workflow size={12} strokeWidth={ICON_STROKE} aria-hidden />
          {t("panel.runner")}
        </div>
        {snap.runners.length === 0 && <div className="rm-note">{t("panel.runnerEmpty")}</div>}
        {snap.runners.map((runner) =>
          runner.pausedUntil ? (
            <Row key={runner.name} text={runner.name} state={t("runner.paused", { time: formatClock(runner.pausedUntil) })} tone="quiet" />
          ) : (
            <Row
              key={runner.name}
              text={runner.name}
              state={t(runner.busy ? "runner.busy" : "runner.idle")}
              tone={runner.busy ? "busy" : "quiet"}
              action={{ label: t("runner.pause"), run: () => native.pauseRunner(runner.name) }}
            />
          ),
        )}
        {snap.runners.some((runner) => runner.busy && !runner.pausedUntil) && <div className="rm-note">{t("runner.pauseBusyNote")}</div>}
      </SummaryRow>
      <SummaryRow
        icon={Recycle}
        label={t("panel.cleanup")}
        value={cleanup ? formatGb(cleanup.total) : t("panel.cleanupMeasuring")}
        open={open === "cleanup"}
        onToggle={() => toggle("cleanup")}
      >
        {cleanup?.top.map((item) => <Row key={item.path} text={item.path} state={formatGb(item.bytes)} tone="quiet" />)}
        <div className="rm-note">
          {cleanup ? t("panel.cleanupNote", { time: formatClock(cleanup.measuredAt) }) : t("panel.cleanupMeasuringNote")}
        </div>
      </SummaryRow>
      <div className="rm-separator" />
      <Commands />
    </main>
  );
}

export default App;
