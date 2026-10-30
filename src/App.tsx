import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="meter-value">{Math.round(value)}%</span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${level(value)}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <div className="meter-detail">{detail}</div>
    </div>
  );
}

function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);

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
    return <main className="panel loading">불러오는 중</main>;
  }

  const memory = percent(snap.memoryUsed, snap.memoryTotal);
  const disk = percent(snap.diskUsed, snap.diskTotal);

  return (
    <main className="panel">
      <header>
        <div className="host">{snap.host}</div>
        <div className="os">{snap.os}</div>
      </header>
      <section className="meters">
        <Meter label="CPU" value={snap.cpuPercent} detail="모든 코어 평균" />
        <Meter
          label="메모리"
          value={memory}
          detail={`${formatGb(snap.memoryUsed)} / ${formatGb(snap.memoryTotal)}`}
        />
        <Meter label="디스크" value={disk} detail={`${formatGb(snap.diskUsed)} / ${formatGb(snap.diskTotal)}`} />
      </section>
      <section className="facts">
        <div className="fact">
          <span>claude 세션</span>
          <strong>{snap.claudeSessions}개</strong>
        </div>
        <div className="fact">
          <span>GitHub 러너</span>
          <strong className={`runner ${snap.runner}`}>{RUNNER_LABEL[snap.runner]}</strong>
        </div>
      </section>
    </main>
  );
}

export default App;
