// The All Computers window: this computer and every other computer on the same Tailscale network, as cards. A card
// shows what the panel's summary rows show; choosing one shows its biggest apps below. Look only: nothing here quits
// an app or empties a folder on another computer (shared decision 2026-11-02 "[MONITOR] 패널 나누기" 1A).
import { useEffect, useState } from "react";
import { t } from "./i18n";
import * as native from "./native";
import type { Peer, PeerUsage } from "./native";
import "./runners-window.css";
import "./Computers.css";

const REFRESH_MS = 2000;
const GB = 1024 ** 3;

type Card = { name: string; self: boolean; state: Peer["state"]; usage: PeerUsage | null; at: number | null };

const pct = (used: number, total: number) => (total > 0 ? Math.round((used * 100) / total) : 0);
const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const slowOf = (u: PeerUsage | null) => !!u && (u.slowMemory || u.slowCpu);

function Bar({ value }: { value: number }) {
  const tone = value >= 90 ? "full" : value >= 75 ? "high" : "ok";
  return (
    <span className="c-bar">
      <i className={tone} style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

function Line({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div className="c-line">
      <span>{label}</span>
      {bar !== undefined && <Bar value={bar} />}
      <b>{value}</b>
    </div>
  );
}

function CardView({ card, chosen, onChoose }: { card: Card; chosen: boolean; onChoose: () => void }) {
  const u = card.usage;
  const status = u?.slowMemory ? t("status.slowMemory") : u?.slowCpu ? t("status.slowCpu") : null;
  return (
    <button type="button" className={`c-card ${chosen ? "chosen" : ""} ${u ? "" : "off"}`} onClick={onChoose}>
      <div className="c-head">
        <span className="c-name">{card.self ? `${card.name} · ${t("computers.thisComputer")}` : card.name}</span>
        {status && <span className="c-badge">{status}</span>}
      </div>
      {u ? (
        <>
          <Line label={t("panel.cpu")} value={`${Math.round(u.cpuPercent)}%`} bar={u.cpuPercent} />
          <Line label={t("panel.memory")} value={`${pct(u.memoryUsed, u.memoryTotal)}%`} bar={pct(u.memoryUsed, u.memoryTotal)} />
          <Line label={t("panel.disk")} value={`${pct(u.diskUsed, u.diskTotal)}%`} bar={pct(u.diskUsed, u.diskTotal)} />
        </>
      ) : (
        <div className="c-off">{card.state === "offline" ? t("computers.offline") : t("computers.noMonitor")}</div>
      )}
    </button>
  );
}

function Detail({ card }: { card: Card }) {
  const u = card.usage;
  if (!u) return null;
  const runners = u.runnersBusy > 0 ? t("summary.runnersBusy", { count: u.runnersBusy }) : t("summary.runnersIdle", { count: u.runnersIdle });
  return (
    <section className="c-detail">
      <div className="c-detail-head">
        <b>{card.name}</b>
        <span>
          {u.os} · Monitor {u.version}
          {card.at && !card.self ? ` · ${t("computers.seen", { time: clock(card.at) })}` : ""}
        </span>
      </div>
      <div className="c-cols">
        <div>
          <div className="c-sec">{t("computers.apps")}</div>
          {u.topMemory.map((app) => (
            <div key={app.name} className="c-line">
              <span>{app.name}</span>
              <b>{gb(app.memory)}</b>
            </div>
          ))}
        </div>
        <div>
          <div className="c-sec">&nbsp;</div>
          <Line label={t("panel.memory")} value={`${gb(u.memoryUsed)} / ${gb(u.memoryTotal)}`} />
          <Line label={t("panel.disk")} value={`${gb(u.diskTotal - u.diskUsed)} · ${t("computers.free")}`} />
          <Line label={t("panel.cleanup")} value={u.cleanable === null ? t("panel.cleanupMeasuring") : gb(u.cleanable)} />
          <Line label={t("panel.work")} value={`${t("summary.claude", { count: u.claudeSessions })} · ${runners}`} />
        </div>
      </div>
    </section>
  );
}

export default function Computers() {
  const [cards, setCards] = useState<Card[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const [self, peers] = await Promise.all([native.selfUsage(), native.peers()]);
      if (!alive) return;
      const mine: Card[] = self ? [{ name: self.host, self: true, state: "ok", usage: self, at: Date.now() }] : [];
      setCards([...mine, ...peers.map((p) => ({ ...p, self: false }))]);
    };
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && native.closeWindow();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  // Why: with nothing chosen yet, the first slow computer (or this one) is shown, so the window opens on something useful.
  const current = cards.find((c) => c.name === chosen) ?? cards.find((c) => slowOf(c.usage)) ?? cards[0];
  return (
    <main className="computers">
      <h1>{t("computers.title")}</h1>
      <p className="c-note">{t("computers.note")}</p>
      {cards.length <= 1 && <p className="c-note">{t("computers.empty")}</p>}
      <div className="c-grid">
        {cards.map((card) => (
          <CardView key={card.name} card={card} chosen={card === current} onChoose={() => setChosen(card.name)} />
        ))}
      </div>
      {current && <Detail card={current} />}
    </main>
  );
}
