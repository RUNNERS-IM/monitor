// Monitor talking to Monitor on the other computers of the same Tailscale network, with no server in between
// (shared decision 2026-11-02: "computers are managed from the program"). Each Monitor answers on its Tailscale
// address only, with numbers to look at; it takes no commands, so nobody can quit an app or delete files from afar.
import { createServer, type Server } from "node:http";
import { computers, allowed, tailnet, type Device } from "./tailnet";

/** Why: next to Remote's 7787, so the RUNNERS apps' ports sit together and are easy to allow in an ACL. */
export const PORT = 7788;
const PATH = "/monitor/v1/usage";
/** How often the other computers are asked: slowly with nothing open, quickly while the All Computers window shows. */
const SLOW_MS = 30 * 1000;
const FAST_MS = 5 * 1000;
const ASK_TIMEOUT_MS = 3000;
/** Why: listening on a Tailscale address fails until Tailscale is up, so binding is retried this often. */
const BIND_RETRY_MS = 60 * 1000;
const TOP_APPS = 5;

/** What one computer tells the others. Kept small and free of paths: names and numbers only. */
export type Usage = {
  host: string;
  os: string;
  version: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPressure: "normal" | "warn" | "critical";
  diskUsed: number;
  diskTotal: number;
  slowMemory: boolean;
  slowCpu: boolean;
  topMemory: { name: string; memory: number }[];
  claudeSessions: number;
  runnersBusy: number;
  runnersIdle: number;
  /** Bytes of caches and build folders that could be emptied; null while the first measurement runs. */
  cleanable: number | null;
};

/** One other computer as the panel and the window show it. */
export type Peer = {
  name: string;
  /** `ok` answered; `noMonitor` is online but nothing answers on the port; `offline` per Tailscale. */
  state: "ok" | "noMonitor" | "offline";
  usage: Usage | null;
  /** When the last answer came (ms), so an old reading can be told apart. */
  at: number | null;
};

let servers: Server[] = [];
let boundTo = "";
let peers = new Map<string, Peer>();
let fast = false;
let wake: (() => void) | null = null;

/** Starts answering on this computer's Tailscale addresses, and keeps the binding right when they change. */
export function startServing(usage: () => Usage | null): void {
  const bind = async () => {
    const net = await tailnet(true);
    const ips = net?.self.ips.filter((ip) => !ip.includes(":")) ?? [];
    const key = ips.join(",");
    if (key !== boundTo) {
      for (const server of servers) server.close();
      servers = ips.map((ip) => serve(ip, usage));
      boundTo = key;
    }
  };
  void bind();
  setInterval(() => void bind(), BIND_RETRY_MS);
}

function serve(ip: string, usage: () => Usage | null): Server {
  const server = createServer((req, res) => {
    void (async () => {
      // Why: only GET of the one path; anything else, or a device outside the tailnet, gets nothing to read.
      if (req.method !== "GET" || req.url !== PATH || !(await allowed(req.socket.remoteAddress ?? ""))) {
        res.writeHead(404).end();
        return;
      }
      const body = usage();
      if (!body) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    })();
  });
  server.on("error", (error) => {
    console.error(`peers: listen ${ip}:${PORT}:`, error.message);
    boundTo = "";
  });
  server.listen(PORT, ip);
  return server;
}

async function ask(device: Device): Promise<Peer> {
  const ip = device.ips.find((value) => !value.includes(":"));
  if (!device.online || !ip) return { name: device.name, state: "offline", usage: null, at: peers.get(device.name)?.at ?? null };
  try {
    const res = await fetch(`http://${ip}:${PORT}${PATH}`, { signal: AbortSignal.timeout(ASK_TIMEOUT_MS) });
    if (!res.ok) throw new Error(String(res.status));
    return { name: device.name, state: "ok", usage: (await res.json()) as Usage, at: Date.now() };
  } catch {
    return { name: device.name, state: "noMonitor", usage: null, at: peers.get(device.name)?.at ?? null };
  }
}

/** Asks every other computer in turn, forever: every 30 s, or every 5 s while `setFast(true)`. */
export async function askLoop(): Promise<void> {
  for (;;) {
    const net = await tailnet();
    if (net) {
      const answers = await Promise.all(computers(net).map(ask));
      peers = new Map(answers.map((peer) => [peer.name, peer]));
    } else peers = new Map();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, fast ? FAST_MS : SLOW_MS);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

/** Asks quickly while the All Computers window is open; turning it on also asks right away. */
export function setFast(on: boolean): void {
  const was = fast;
  fast = on;
  if (on && !was) wake?.();
}

/** The other computers, slow ones first, then by name. Empty when Tailscale is off. */
export function peerList(): Peer[] {
  const rank = (peer: Peer) => (peer.usage && (peer.usage.slowMemory || peer.usage.slowCpu) ? 0 : peer.state === "ok" ? 1 : 2);
  return [...peers.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function topApps<T extends { name: string; memory: number }>(apps: T[]): { name: string; memory: number }[] {
  return apps.slice(0, TOP_APPS).map((app) => ({ name: app.name, memory: app.memory }));
}
