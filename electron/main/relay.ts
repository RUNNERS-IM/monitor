// This computer on the system server's relay, so the Monitor phone app can see it and act on it (shared decisions
// 2026-11-03 "[MONITOR] 휴대폰판 작업 계획" 1C and "네 앱 컴퓨터판 · 휴대폰판 개발 방식"). The format is
// runners-app-kit docs/relay.md: hello as a host, the reading as `state` every few seconds, alerts when the computer
// stays slow, and the phone's commands answered with `result`. The relay only joins devices of the same RUNNERS account.
import { app } from "electron";
import { randomUUID } from "node:crypto";
import * as account from "./account";
import { readSettings, writeSettings } from "./settings";

/** Debug runs can point at a local test server (`MONITOR_RELAY_URL=ws://127.0.0.1:8787/api/relay`). */
const RELAY_URL = (!app.isPackaged && process.env.MONITOR_RELAY_URL) || "wss://server.system.runners.im/api/relay";
const PROJECT = "MONITOR";
/** Why: the server keeps the last state for phones that join later, so a slow beat is enough between changes. */
const STATE_MS = 5 * 1000;
const RETRY_MIN_MS = 2 * 1000;
const RETRY_MAX_MS = 60 * 1000;
/** Close codes from docs/relay.md: the token was refused, it belongs to another app, or a newer connection with
 * this deviceId took over (reconnecting would make the two knock each other off). */
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_WRONG_APP = 4403;
const CLOSE_REPLACED = 4409;
/** Why: the server checks open connections every minute and closes them once the 1-hour token runs out, so a fresh
 * token is fetched a little before and handed over with `auth` on the same connection. */
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;

/** "elsewhere": another connection with this computer's id took over (4409) or the sign-in belongs to another app (4403);
 *  Monitor stays off the relay until Reconnect is pressed, since reconnecting by itself would knock the other off. */
export type RelayStatus = "signedOut" | "connecting" | "connected" | "elsewhere";

// Why: a notice is worth sending late when the connection comes back soon, but not hours later.
const ALERT_KEEP_MS = 30 * 60 * 1000;

/** A phone's command: what it is called and what came with it. Returns the result's data, or throws with the reason. */
export type Handler = (args: Record<string, unknown>) => Promise<unknown>;

type Options = {
  /** The reading to send as `state`, or null while there is none yet. */
  state: () => unknown;
  /** The name phones show for this computer. */
  name: () => Promise<string>;
  commands: Record<string, Handler>;
};

let socket: WebSocket | null = null;
let status: RelayStatus = "signedOut";
/** Notices made while not connected, sent once the relay answers again. */
let pendingAlerts: { title: string; body: string; at: number }[] = [];
let restart: (() => void) | null = null;
const statusListeners = new Set<(status: RelayStatus) => void>();

function setStatus(next: RelayStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of statusListeners) listener(next);
}

export function currentStatus(): RelayStatus {
  return status;
}

export function onStatus(listener: (status: RelayStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Made once and kept, so a phone sees the same computer across restarts. */
function deviceId(): string {
  const saved = readSettings().deviceId;
  if (saved) return saved;
  return writeSettings({ deviceId: randomUUID() }).deviceId!;
}

function send(message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** Pushes a notice to the account's phones; while not connected it waits (up to ALERT_KEEP_MS) for the connection. */
export function sendAlert(title: string, body: string): void {
  if (status === "connected" && socket?.readyState === WebSocket.OPEN) send({ type: "alert", title, body });
  else pendingAlerts = [...pendingAlerts.filter((a) => a.title !== title), { title, body, at: Date.now() }];
}

function sendPendingAlerts(): void {
  const now = Date.now();
  for (const alert of pendingAlerts) if (now - alert.at < ALERT_KEEP_MS) send({ type: "alert", title: alert.title, body: alert.body });
  pendingAlerts = [];
}

/** The Phone window's Reconnect, after another connection took this computer's place. */
export function reconnect(): void {
  restart?.();
}

/** Keeps this computer on the relay while an account is signed in, reconnecting after drops. */
export function startRelay(options: Options): void {
  let retryMs = RETRY_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let refreshedOnce = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** The account the open connection signed in as, so a refreshed token for it can be handed over in place. */
  let connectedEmail: string | null = null;

  const scheduleRefresh = (ms?: number) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const expiry = account.accessTokenExpiry();
    const wait = ms ?? (expiry === null ? null : Math.max(0, expiry - REFRESH_AHEAD_MS - Date.now()));
    refreshTimer =
      wait === null
        ? null
        : setTimeout(() => {
            refreshTimer = null;
            // Success comes back through account.onChange, which sends `auth`; "rejected" signs out there too.
            void account.refresh().then((result) => {
              if (!result.ok && result.reason === "network") scheduleRefresh(REFRESH_RETRY_MS);
            });
          }, wait);
  };

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void connect(), ms);
  };

  const connect = async () => {
    timer = null;
    const token = account.accessToken();
    if (!token) {
      setStatus("signedOut");
      return;
    }
    setStatus("connecting");
    connectedEmail = account.current();
    // Why: Node's WebSocket can carry headers, so the token stays out of the address (and out of server logs).
    const ws = new WebSocket(RELAY_URL, { headers: { Authorization: `Bearer ${token}` } } as unknown as string[]);
    socket = ws;
    let beat: ReturnType<typeof setInterval> | null = null;
    const sendState = () => {
      const data = options.state();
      if (data) send({ type: "state", data });
    };
    ws.addEventListener("open", () => {
      void options.name().then((name) => {
        if (socket !== ws) return;
        send({ type: "hello", deviceId: deviceId(), projectName: PROJECT, name, role: "host" });
        refreshedOnce = false;
        sendState();
        beat = setInterval(sendState, STATE_MS);
        scheduleRefresh();
      });
    });
    ws.addEventListener("message", (event) => {
      let message: {
        type?: string;
        from?: string;
        fromRole?: string;
        id?: string;
        name?: string;
        args?: Record<string, unknown>;
      };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      // Why: the relay answers hello with the account's other devices only after it checked the token. Counting the
      // connection as made (and the wait as over) only then keeps a server that accepts and then drops every connection
      // from being retried without a pause.
      if (message.type === "peers") {
        retryMs = RETRY_MIN_MS;
        setStatus("connected");
        sendPendingAlerts();
        return;
      }
      if (message.type !== "command" || !message.id) return;
      const reply = (ok: boolean, data: unknown) => send({ type: "result", to: message.from, id: message.id, ok, data });
      // Why: the relay fills in fromRole from the sender's hello, so only the account's phones can act on this
      // computer; another computer on the same account sees it but cannot quit its apps or empty its folders.
      if (message.fromRole !== "viewer") {
        reply(false, { error: "not allowed" });
        return;
      }
      const handler = message.name ? options.commands[message.name] : undefined;
      if (!handler) {
        reply(false, { error: "unknown command" });
        return;
      }
      handler(message.args ?? {})
        .then((data) => {
          reply(true, data ?? null);
          // Why: what a command changed (an app quit, folders emptied) shows on the phone right away.
          sendState();
        })
        .catch((error: unknown) => reply(false, { error: error instanceof Error ? error.message : String(error) }));
    });
    ws.addEventListener("close", (event) => {
      if (beat) clearInterval(beat);
      if (socket !== ws) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
      socket = null;
      if (!account.accessToken()) {
        setStatus("signedOut");
        return;
      }
      if (event.code === CLOSE_WRONG_APP || event.code === CLOSE_REPLACED) {
        setStatus("elsewhere");
        return;
      }
      setStatus("connecting");
      if (event.code === CLOSE_UNAUTHORIZED && !refreshedOnce) {
        refreshedOnce = true;
        void account.refresh().then((result) => {
          if (result.ok) schedule(0);
          else if (result.reason === "network") {
            // Why: no internet is not a sign-out. Keep the sign-in and try again, refreshing again on the next 4401.
            refreshedOnce = false;
            schedule(retryMs);
            retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
          } else setStatus("signedOut");
        });
        return;
      }
      schedule(retryMs);
      retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
    });
    // Why: an error is always followed by close, which retries.
    ws.addEventListener("error", () => undefined);
  };

  account.onChange(() => {
    const token = account.accessToken();
    if (token && socket?.readyState === WebSocket.OPEN && account.current() === connectedEmail) {
      send({ type: "auth", token });
      scheduleRefresh();
      return;
    }
    const old = socket;
    socket = null;
    old?.close();
    retryMs = RETRY_MIN_MS;
    schedule(0);
  });
  restart = () => {
    if (status !== "elsewhere") return;
    retryMs = RETRY_MIN_MS;
    schedule(0);
  };
  void connect();
}
