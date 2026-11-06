// The All Computers window: this computer and every other computer signed in to the same RUNNERS account, as cards.
// A card shows what the panel's summary rows show; choosing one shows its biggest apps below. Look only: nothing here
// quits an app or empties a folder on another computer (shared decision 2026-11-02 "[MONITOR] 패널 나누기" 1A).
// Signed out, the window holds one Sign In button and the shared sign-in sheet; signed in, the account badge sits at
// the top right (shared decision 2026-11-05 "네 앱 계정 · 연결 통일" 2A, parts copied from runners-app-kit/desktop).
import { useCallback, useEffect, useState } from "react";
import { locale, t } from "./i18n";
import * as native from "./native";
import type { AccountState, Peer, PeerUsage } from "./native";
import { AccountButton, RunnersMark, SignInSheet, type SignMode } from "./runners-account/runners-account";
import "./runners-window.css";
import "./runners-account/runners-account.css";
import "./Computers.css";

const REFRESH_MS = 2000;
const GB = 1024 ** 3;

type Card = { name: string; self: boolean; state: Peer["state"]; usage: PeerUsage | null; at: number | null };

const pct = (used: number, total: number) => (total > 0 ? Math.round((used * 100) / total) : 0);
const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const slowOf = (u: PeerUsage | null) => !!u && (u.slowMemory || u.slowCpu);
/** Why: the panel colours memory by macOS's pressure level, and a Mac uses most of its memory on purpose, so this
 *  window does the same; otherwise one Mac looked fine in the panel and slow here. */
const memoryTone = (u: PeerUsage) => (u.memoryPressure === "critical" ? "full" : u.memoryPressure === "warn" ? "high" : "ok");

function Bar({ value, tone: given }: { value: number; tone?: "ok" | "high" | "full" }) {
  const tone = given ?? (value >= 90 ? "full" : value >= 75 ? "high" : "ok");
  return (
    <span className="c-bar">
      <i className={tone} style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

function Line({ label, value, bar, tone }: { label: string; value: string; bar?: number; tone?: "ok" | "high" | "full" }) {
  return (
    <div className="c-line">
      <span>{label}</span>
      {bar !== undefined && <Bar value={bar} tone={tone} />}
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
          <Line label={t("panel.memory")} value={`${pct(u.memoryUsed, u.memoryTotal)}%`} bar={pct(u.memoryUsed, u.memoryTotal)} tone={memoryTone(u)} />
          <Line label={t("panel.disk")} value={`${pct(u.diskUsed, u.diskTotal)}%`} bar={pct(u.diskUsed, u.diskTotal)} />
          {card.state === "noAnswer" && (
            <div className="c-off">{card.at ? t("computers.noAnswerSince", { time: clock(card.at) }) : t("computers.noAnswer")}</div>
          )}
        </>
      ) : (
        <div className="c-off">
          {card.state === "offline" ? t("computers.offline") : t("computers.noAnswer")}
        </div>
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

/** The account badge's second line: how many of the account's computers are on, or how the connection stands. */
function AccountLine({ state, others }: { state: AccountState; others: Card[] }) {
  if (state.status !== "connected") return <>{t(`account.status.${state.status === "elsewhere" ? "elsewhere" : "connecting"}`)}</>;
  return <>{t("account.online", { count: 1 + others.filter((c) => c.state !== "offline").length })}</>;
}

export default function Computers() {
  const [cards, setCards] = useState<Card[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [state, setState] = useState<AccountState | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    void native.account().then(setState);
    const stop = native.onAccount(setState);
    // Why: the panel's account line opens this window to sign in, so the sheet comes up at once.
    void native.takeSignIn().then((wanted) => wanted && setSigningIn(true));
    const stopSignIn = native.onSignIn(() => {
      void native.takeSignIn();
      setSigningIn(true);
    });
    return () => {
      stop();
      stopSignIn();
    };
  }, []);
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
    // Why: Escape closes the sign-in sheet first (the sheet listens itself), and the window only when no sheet is up.
    const close = (event: KeyboardEvent) => event.key === "Escape" && !signingIn && native.closeWindow();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [signingIn]);
  const signIn = useCallback(async (mode: SignMode, email: string, password: string) => {
    const problem = await native.signIn(mode, email, password);
    if (problem) throw new Error(problem);
    setState(await native.account());
  }, []);
  const closeSignIn = useCallback(() => setSigningIn(false), []);
  // Why: with nothing chosen yet, the first slow computer (or this one) is shown, so the window opens on something useful.
  const current = cards.find((c) => c.name === chosen) ?? cards.find((c) => slowOf(c.usage)) ?? cards[0];
  const signedOut = state !== null && !state.email;
  return (
    <main className="computers">
      <header className="c-head-row">
        <div>
          <h1>{t("computers.title")}</h1>
          <p className="c-note">{t("computers.note")}</p>
        </div>
        {state?.email && (
          <AccountButton
            lang={locale}
            account={state.email}
            line={<AccountLine state={state} others={cards.filter((c) => !c.self)} />}
            items={
              state.status === "elsewhere"
                ? [{ label: t("account.reconnect"), onSelect: () => void native.reconnect() }]
                : []
            }
            onSignOut={() => void native.signOut().then(() => native.account().then(setState))}
          />
        )}
      </header>
      {signedOut && (
        <section className="c-signed-out">
          <RunnersMark size={28} />
          <b>{t("computers.signedOutTitle")}</b>
          <p className="c-note">{t("computers.signedOutNote")}</p>
          <button type="button" className="rw-button default" onClick={() => setSigningIn(true)}>
            {t("account.signIn")}
          </button>
        </section>
      )}
      {state?.status === "elsewhere" && <p className="c-note">{t("account.elsewhereNote")}</p>}
      {state?.email && cards.length <= 1 && <p className="c-note">{t("computers.empty")}</p>}
      <div className="c-grid">
        {cards.map((card, i) => (
          <CardView key={`${card.name}-${i}`} card={card} chosen={card === current} onChoose={() => setChosen(card.name)} />
        ))}
      </div>
      {current && <Detail card={current} />}
      {signingIn && <SignInSheet lang={locale} signIn={signIn} onClose={closeSignIn} />}
    </main>
  );
}
