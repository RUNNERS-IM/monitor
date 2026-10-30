import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { Cpu, HardDrive, MemoryStick, SquareTerminal, Workflow, type LucideIcon } from "lucide-react";
import "./App.css";

type RunnerState = "none" | "idle" | "busy";

type Snapshot = {
  host: string;
  os: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  claudeSessions: number;
  runner: RunnerState;
};

const REFRESH_MS = 3000;
const PANEL_WIDTH = 340;
// Why: the same stroke as Prompt and Split so the three apps' icons look equally light.
const ICON_STROKE = 1.5;
const ICON_SIZE = 14;

const RUNNER_LABEL: Record<RunnerState, string> = {
  none: "없음",
  idle: "대기",
  busy: "빌드 중",
};

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function percent(used: number, total: number): number {
  return total === 0 ? 0 : (used * 100) / total;
}

// Why: the same thresholds colour every bar so a full disk and full memory read the same way.
function level(value: number): "ok" | "high" | "full" {
  if (value >= 90) return "full";
  if (value >= 70) return "high";
  return "ok";
}

function Label({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="label">
      <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
      {text}
    </span>
  );
}

function Meter({ icon, label, value, detail }: { icon: LucideIcon; label: string; value: number; detail: string }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <Label icon={icon} text={label} />
        <span className="meter-value">{Math.round(value)}%</span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${level(value)}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <div className="meter-detail">{detail}</div>
    </div>
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

function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  useTranslucent();
  useFitWindow(panelRef);

  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<Snapshot>("snapshot").then((next) => {
        if (alive) setSnap(next);
      });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!snap) {
    return (
      <main ref={panelRef} className="panel loading">
        불러오는 중
      </main>
    );
  }

  const memory = percent(snap.memoryUsed, snap.memoryTotal);
  const disk = percent(snap.diskUsed, snap.diskTotal);

  return (
    <main ref={panelRef} className="panel">
      <header>
        <div className="host">{snap.host}</div>
        <div className="os">{snap.os}</div>
      </header>
      <section>
        <h2 className="section-head">자원</h2>
        <div className="card">
          <Meter icon={Cpu} label="CPU" value={snap.cpuPercent} detail="모든 코어 평균" />
          <Meter
            icon={MemoryStick}
            label="메모리"
            value={memory}
            detail={`${formatGb(snap.memoryUsed)} / ${formatGb(snap.memoryTotal)}`}
          />
          <Meter icon={HardDrive} label="디스크" value={disk} detail={`${formatGb(snap.diskUsed)} / ${formatGb(snap.diskTotal)}`} />
        </div>
      </section>
      <section>
        <h2 className="section-head">작업</h2>
        <div className="card">
          <div className="fact">
            <Label icon={SquareTerminal} text="claude 세션" />
            <strong>{snap.claudeSessions}개</strong>
          </div>
          <div className="fact">
            <Label icon={Workflow} text="GitHub 러너" />
            <strong className={`runner ${snap.runner}`}>{RUNNER_LABEL[snap.runner]}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
