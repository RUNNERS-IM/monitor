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
  /** The icon's level, held for a minute like slowMemory and slowCpu: "fine", "warn" or "bad" (memory critical).
   *  Optional because older Monitors do not send it. */
  level?: "fine" | "warn" | "bad";
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
  /** `ok` answered; `noAnswer` has Monitor but did not answer in time (busy, or asleep a moment); `noMonitor` is online
   *  but nothing listens on the port; `offline` per Tailscale. */
  state: "ok" | "noAnswer" | "noMonitor" | "offline";
  /** For `noAnswer`, the last reading it gave, so a slow computer still shows its numbers. */
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
  } catch (error) {
    // Why: a computer short of memory answers late, and calling that "no Monitor" sent people off to reinstall it.
    // Only a refused connection with no earlier answer means nothing is there.
    const last = peers.get(device.name);
    const refused = error instanceof TypeError && (error.cause as { code?: string } | undefined)?.code === "ECONNREFUSED";
    if (refused && !last?.usage) return { name: device.name, state: "noMonitor", usage: null, at: last?.at ?? null };
    return { name: device.name, state: "noAnswer", usage: last?.usage ?? null, at: last?.at ?? null };
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

/** Debug runs only: made-up computers for the homepage screenshots, with no real names or numbers. */
export function demoPeers(korean: boolean): Peer[] {
  const gb = 1024 ** 3;
  const make = (name: string, cpu: number, mem: number, disk: number, slow: boolean, apps: [string, number][], claude: number, busy: number): Peer => ({
    name,
    state: "ok",
    at: Date.now() - 20_000,
    usage: {
      host: name,
      os: "macOS 26.5 Tahoe",
      version: "2.6.1102",
      cpuPercent: cpu,
      memoryUsed: (mem / 100) * 32 * gb,
      memoryTotal: 32 * gb,
      memoryPressure: slow ? "warn" : "normal",
      diskUsed: (disk / 100) * 1000 * gb,
      diskTotal: 1000 * gb,
      slowMemory: slow,
      slowCpu: false,
      topMemory: apps.map(([app, size]) => ({ name: app, memory: size * gb })),
      claudeSessions: claude,
      runnersBusy: busy,
      runnersIdle: 1 - busy,
      cleanable: 38.4 * gb,
    },
  });
  const office = korean ? ["디자인 맥", "빌드 맥", "회의실 맥", "서버 맥"] : ["Design Mac", "Build Mac", "Meeting Room Mac", "Server Mac"];
  return [
    make(office[1], 71, 91, 64, true, [["Xcode", 7.4], ["Simulator", 4.1], ["Google Chrome", 2.6]], 3, 1),
    make(office[0], 18, 52, 41, false, [["Figma", 3.2], ["Google Chrome", 2.1], ["Slack", 0.9]], 1, 0),
    make(office[3], 34, 63, 72, false, [["Docker", 6.3], ["node", 1.8], ["Terminal", 0.4]], 2, 0),
    make(office[2], 6, 38, 29, false, [["Zoom", 1.2], ["Keynote", 0.8], ["Safari", 0.7]], 0, 0),
    { name: korean ? "노트북" : "Laptop", state: "offline", usage: null, at: null },
  ];
}
