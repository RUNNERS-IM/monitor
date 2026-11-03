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

export type RelayStatus = "signedOut" | "connecting" | "connected";

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

/** Pushes a notice to the account's phones. Does nothing while signed out or not connected. */
export function sendAlert(title: string, body: string): void {
  send({ type: "alert", title, body });
}

/** Keeps this computer on the relay while an account is signed in, reconnecting after drops. */
export function startRelay(options: Options): void {
  let retryMs = RETRY_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let refreshedOnce = false;

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
        setStatus("connected");
        retryMs = RETRY_MIN_MS;
        refreshedOnce = false;
        sendState();
        beat = setInterval(sendState, STATE_MS);
      });
    });
    ws.addEventListener("message", (event) => {
      let message: { type?: string; from?: string; id?: string; name?: string; args?: Record<string, unknown> };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type !== "command" || !message.id) return;
      const reply = (ok: boolean, data: unknown) => send({ type: "result", to: message.from, id: message.id, ok, data });
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
      socket = null;
      if (!account.accessToken()) {
        setStatus("signedOut");
        return;
      }
      setStatus("connecting");
      if (event.code === CLOSE_WRONG_APP || event.code === CLOSE_REPLACED) return;
      if (event.code === CLOSE_UNAUTHORIZED && !refreshedOnce) {
        refreshedOnce = true;
        void account.refresh().then((next) => (next ? schedule(0) : setStatus("signedOut")));
        return;
      }
      schedule(retryMs);
      retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
    });
    // Why: an error is always followed by close, which retries.
    ws.addEventListener("error", () => undefined);
  };

  account.onChange(() => {
    const old = socket;
    socket = null;
    old?.close();
    retryMs = RETRY_MIN_MS;
    schedule(0);
  });
  void connect();
}
