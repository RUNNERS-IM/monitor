import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Recycle,
  SquareTerminal,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { t } from "./i18n";
import "./App.css";

type Pressure = "normal" | "warn" | "critical";

type AppKind = "app" | "build" | "simulator";
type AppUse = { name: string; cpuPercent: number; memory: number; quittable: boolean; kind: AppKind; folder: string | null };
type ClaudeSession = { pid: number; name: string | null; runningSecs: number; busy: boolean; human: boolean };
type Runner = { name: string; busy: boolean; pausedUntil: number | null };

type Snapshot = {
  host: string;
  os: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPressure: Pressure;
  diskUsed: number;
  diskTotal: number;
  swapUsed: number;
  slowMemory: boolean;
  slowCpu: boolean;
  cpuHistory: number[];
  memoryHistory: number[];
  topCpu: AppUse[];
  topMemory: AppUse[];
  claudeSessions: ClaudeSession[];
  heavyJob: { name: string; command: string; runningSecs: number } | null;
  runners: Runner[];
  popup: boolean;
};

type Cleanup = { total: number; top: { path: string; bytes: number }[]; measuredAt: number };

type Section = "cpu" | "memory" | "disk" | "work" | "cleanup";

type Level = "ok" | "high" | "full";

const REFRESH_MS = 3000;
// Why: the cleanup numbers change only every 30 minutes, so the panel asks for them far less often.
const CLEANUP_REFRESH_MS = 60_000;
const PANEL_WIDTH = 380;
// Why: the same stroke as Prompt and Split so the three apps' icons look equally light.
const ICON_STROKE = 1.5;
const ICON_SIZE = 14;
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

function Label({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="label">
      <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
      {text}
    </span>
  );
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

/** The small bar in front of a summary number, so how full something is reads without opening the line. */
function MiniBar({ value, tone }: { value: number; tone: Level }) {
  return (
    <span className="mini-track" aria-hidden>
      <span className={`mini-fill ${tone}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </span>
  );
}

/** What opens under a summary line: the graph (or bar) and the detail lines. */
function Meter({ value, tone, history, details }: { value: number; tone: Level; history?: number[]; details: string[] }) {
  return (
    <div className="meter">
      {history ? (
        <Sparkline values={history} tone={tone} />
      ) : (
        <div className="meter-track">
          <div className={`meter-fill ${tone}`} style={{ width: `${Math.min(value, 100)}%` }} />
        </div>
      )}
      {details.map((line) => (
        <div key={line} className="meter-detail">
          {line}
        </div>
      ))}
    </div>
  );
}

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
      .catch((e) => setError(String(e)))
      .finally(() => setPending(false));
  };
  return (
    <>
      <div className="row">
        <span>{text}</span>
        <span className="row-right">
          <span className={`row-state ${tone ?? ""}`}>{state}</span>
          {action && (
            <button type="button" className="row-button" disabled={pending} onClick={press}>
              {action.label}
            </button>
          )}
        </span>
      </div>
      {error && <div className="row-error">{t("action.failed", { error })}</div>}
    </>
  );
}

/** One line of the summary. Clicking it opens its details right below. */
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
  /** Colours the number only when it is high, so a normal line stays plain. */
  tone?: Level;
  gauge?: React.ReactNode;
  badge?: { text: string; tone: Level };
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="summary">
      <button type="button" className="summary-row" aria-expanded={open} onClick={onToggle}>
        <Label icon={icon} text={label} />
        <span className="meter-right">
          {badge && <span className={`badge ${badge.tone}`}>{badge.text}</span>}
          {gauge}
          <span className={`meter-value ${tone && tone !== "ok" ? tone : ""}`}>{value}</span>
          <Chevron size={ICON_SIZE} strokeWidth={ICON_STROKE} className="chevron" aria-hidden />
        </span>
      </button>
      {open && <div className="summary-body">{children}</div>}
    </div>
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

/** Shown only while the computer is slow: what is behind it and a Quit button for each app. */
function SlowCard({ snap }: { snap: Snapshot }) {
  const apps = snap.slowMemory ? snap.topMemory : snap.topCpu;
  const spotlightBusy = snap.topCpu.some((app) => SPOTLIGHT.test(app.name) && app.cpuPercent >= MIN_TOP_CPU);
  return (
    <section>
      <h2 className="section-head">{t("slow.title")}</h2>
      <div className="card slow">
        <div className="group">
          {snap.slowMemory && <Label icon={Gauge} text={t("slow.memory")} />}
          {snap.slowCpu && <Label icon={Gauge} text={t("slow.cpu")} />}
          {apps.map((app) => (
            <Row
              key={app.name}
              text={app.name}
              state={appState(app, snap.slowMemory ? formatGb(app.memory) : `${Math.round(app.cpuPercent)}%`)}
              tone="quiet"
              action={app.quittable ? { label: t("slow.quit"), run: () => invoke("quit_app", { name: app.name }) } : undefined}
            />
          ))}
          {snap.swapUsed > 0 && <div className="meter-detail">{t("slow.swap", { size: formatGb(snap.swapUsed) })}</div>}
          {spotlightBusy && <div className="meter-detail">{t("slow.spotlight")}</div>}
          {apps.some((app) => app.quittable) && <div className="meter-detail">{t("slow.quitNote")}</div>}
        </div>
      </div>
    </section>
  );
}

// Why: the OS blur only shows through a transparent page, so the solid background is dropped when blur is on.
function useTranslucent() {
  useEffect(() => {
    invoke<boolean>("translucent").then((on) => {
      document.documentElement.dataset.translucent = String(on);
    });
  }, []);
}

// Why: a fixed window height left empty space under the last card, so the window follows the panel's height.
function useFitWindow(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      getCurrentWindow().setSize(new LogicalSize(PANEL_WIDTH, Math.ceil(node.getBoundingClientRect().height)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  });
}

function usePolling<T>(command: string, everyMs: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<T | null>(command).then((next) => {
        if (alive && next) setValue(next);
      });
    load();
    const timer = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [command, everyMs]);
  return value;
}

function App() {
  const snap = usePolling<Snapshot>("snapshot", REFRESH_MS);
  const cleanup = usePolling<Cleanup>("cleanup", CLEANUP_REFRESH_MS);
  // Why: a debug run can start with a row open (`VITE_MONITOR_EXPAND=work`) so it can be captured without clicking.
  const [open, setOpen] = useState<Section | null>(
    import.meta.env.DEV ? ((import.meta.env.VITE_MONITOR_EXPAND as Section | undefined) ?? null) : null,
  );
  const panelRef = useRef<HTMLElement>(null);
  useTranslucent();
  useFitWindow(panelRef);

  if (!snap) {
    return (
      <main ref={panelRef} className="panel loading">
        {t("panel.loading")}
      </main>
    );
  }

  const toggle = (section: Section) => setOpen((now) => (now === section ? null : section));
  const slow = snap.slowMemory || snap.slowCpu;
  const memory = percent(snap.memoryUsed, snap.memoryTotal);
  const disk = percent(snap.diskUsed, snap.diskTotal);
  const memoryTone = PRESSURE_LEVEL[snap.memoryPressure];
  const topCpu = snap.topCpu
    .filter((app) => app.cpuPercent >= MIN_TOP_CPU)
    .map((app) => `${app.name} ${Math.round(app.cpuPercent)}%`)
    .join(", ");
  const topMemory = snap.topMemory.map((app) => `${app.name} ${formatGb(app.memory)}`).join(", ");
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
        <div>
          <div className="host">
            {snap.host}
            {/* Why: a "normal" badge on every open said nothing, so the badge shows only when something is wrong. */}
            {slow && <span className={`badge ${snap.memoryPressure === "critical" ? "full" : "high"}`}>{t(`status.${status}`)}</span>}
          </div>
          <div className="os">{snap.os}</div>
        </div>
        {snap.popup && (
          <button type="button" className="close" aria-label={t("popup.close")} title={t("popup.close")} onClick={() => invoke("close_popup")}>
            <X size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        )}
      </header>
      {slow && <SlowCard snap={snap} />}
      <div className="card summary-card">
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
          <Meter
            value={snap.cpuPercent}
            tone={cpuTone}
            history={snap.cpuHistory}
            details={[topCpu ? t("panel.top", { apps: topCpu }) : t("panel.cpuDetail")]}
          />
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
          <Meter
            value={memory}
            tone={memoryTone}
            history={snap.memoryHistory}
            details={[`${formatGb(snap.memoryUsed)} / ${formatGb(snap.memoryTotal)}`, t("panel.top", { apps: topMemory })]}
          />
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
          <Meter
            value={disk}
            tone={diskTone}
            details={[
              `${formatGb(snap.diskUsed)} / ${formatGb(snap.diskTotal)} · ${t("panel.diskFree", { free: formatGb(snap.diskTotal - snap.diskUsed) })}`,
            ]}
          />
        </SummaryRow>
        <SummaryRow icon={SquareTerminal} label={t("panel.work")} value={workValue} open={open === "work"} onToggle={() => toggle("work")}>
          {snap.heavyJob && (
            <div className="group">
              <Row
                text={t("panel.heavyRow", { name: snap.heavyJob.name || "claude", command: snap.heavyJob.command })}
                state={formatDuration(snap.heavyJob.runningSecs)}
                tone="busy"
              />
              <div className="meter-detail">{t("panel.heavyNote")}</div>
            </div>
          )}
          <div className="group">
            {snap.claudeSessions.length === 0 && <div className="empty">{t("panel.claudeEmpty")}</div>}
            {snap.claudeSessions.map((session) => (
              <Row
                key={session.pid}
                text={t("panel.claudeRow", { name: session.name ?? (session.human ? "claude" : t("panel.claudeJob")), time: formatDuration(session.runningSecs) })}
                state={t(session.busy ? "panel.claudeBusy" : "panel.claudeIdle")}
                tone={session.busy ? "busy" : "quiet"}
              />
            ))}
          </div>
          <div className="group">
            <Label icon={Workflow} text={t("panel.runner")} />
            {snap.runners.length === 0 && <div className="empty">{t("panel.runnerEmpty")}</div>}
            {snap.runners.map((runner) =>
              runner.pausedUntil ? (
                <Row
                  key={runner.name}
                  text={runner.name}
                  state={t("runner.paused", { time: formatClock(runner.pausedUntil) })}
                  tone="quiet"
                />
              ) : (
                <Row
                  key={runner.name}
                  text={runner.name}
                  state={t(runner.busy ? "runner.busy" : "runner.idle")}
                  tone={runner.busy ? "busy" : "quiet"}
                  action={{ label: t("runner.pause"), run: () => invoke("pause_runner", { name: runner.name }) }}
                />
              ),
            )}
            {snap.runners.some((runner) => runner.busy && !runner.pausedUntil) && (
              <div className="meter-detail">{t("runner.pauseBusyNote")}</div>
            )}
          </div>
        </SummaryRow>
        <SummaryRow
          icon={Recycle}
          label={t("panel.cleanup")}
          value={cleanup ? formatGb(cleanup.total) : t("panel.cleanupMeasuring")}
          open={open === "cleanup"}
          onToggle={() => toggle("cleanup")}
        >
          <div className="group">
            {cleanup?.top.map((item) => <Row key={item.path} text={item.path} state={formatGb(item.bytes)} tone="quiet" />)}
            <div className="meter-detail">
              {cleanup ? t("panel.cleanupNote", { time: formatClock(cleanup.measuredAt) }) : t("panel.cleanupMeasuringNote")}
            </div>
          </div>
        </SummaryRow>
      </div>
    </main>
  );
}

export default App;
