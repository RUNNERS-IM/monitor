// Reads this computer's Tailscale network (tailnet) through the `tailscale` command. Monitor only takes this computer's
// Tailscale name from it (m1-pro-2), the name the other computers and the phones show; the other computers are found
// through the RUNNERS account now (shared decision 2026-11-05 "네 앱 계정 · 연결 통일" 1A).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

const CANDIDATES: Record<string, string[]> = {
  darwin: ["/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
  linux: ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale"],
};
/** Why: `tailscale status` takes a moment, and the name is read on every relay hello and window refresh. */
const CACHE_MS = 30 * 1000;

export type Device = { name: string; ips: string[]; os: string; online: boolean; shared: boolean };
export type Tailnet = { self: Device; peers: Device[] };

let cached: { at: number; value: Tailnet | null } | null = null;

function command(): string | null {
  return (CANDIDATES[process.platform] ?? []).find((path) => existsSync(path)) ?? null;
}

type RawNode = { HostName?: string; DNSName?: string; TailscaleIPs?: string[]; OS?: string; Online?: boolean; ShareeNode?: boolean };

function device(node: RawNode, self = false): Device {
  // Why: HostName is what people see in the Tailscale app (m2-pro-1); the DNS name's first label is the fallback.
  const name = node.HostName || (node.DNSName ?? "").split(".")[0] || "?";
  return { name, ips: node.TailscaleIPs ?? [], os: node.OS ?? "", online: self || node.Online === true, shared: node.ShareeNode === true };
}

function read(): Promise<Tailnet | null> {
  const path = command();
  if (!path) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(path, ["status", "--json"], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const raw = JSON.parse(stdout) as { BackendState?: string; Self?: RawNode; Peer?: Record<string, RawNode> };
        if (raw.BackendState !== "Running" || !raw.Self) return resolve(null);
        resolve({ self: device(raw.Self, true), peers: Object.values(raw.Peer ?? {}).map((node) => device(node)) });
      } catch {
        resolve(null);
      }
    });
  });
}

/** The tailnet, or null when Tailscale is not installed or not connected. `fresh` skips the cache. */
export async function tailnet(fresh = false): Promise<Tailnet | null> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await read();
  cached = { at: Date.now(), value };
  return value;
}
