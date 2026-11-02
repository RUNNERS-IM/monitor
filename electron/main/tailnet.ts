// Reads this computer's Tailscale network (tailnet) through the `tailscale` command: its own addresses and the other
// devices. Monitor uses it to find the other computers to ask, and to decide who may ask this one: any device of the
// same tailnet, but not a device shared in from another tailnet (ShareeNode). The same rule as Prompt (shared decision
// 2026-11-02 "[MONITOR] 다른 맥 허락" 1A).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

const CANDIDATES: Record<string, string[]> = {
  darwin: ["/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
  linux: ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale"],
};
/** Why: `tailscale status` takes a moment, and the server checks every request against it. */
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

/** Whether a request from this address may be answered: same tailnet, not shared in. */
export async function allowed(address: string): Promise<boolean> {
  const ip = address.replace(/^::ffff:/, "");
  const find = (net: Tailnet | null) => (net ? [net.self, ...net.peers].find((d) => d.ips.includes(ip)) : undefined);
  // Why: a computer that joined a minute ago is not in the cached list yet, so an unknown address reads again once.
  const found = find(await tailnet()) ?? find(await tailnet(true));
  return !!found && !found.shared;
}

/** Computers worth asking: other devices that are online and run a desktop system Monitor exists for. */
export function computers(net: Tailnet): Device[] {
  return net.peers.filter((d) => !d.shared && ["macOS", "windows", "linux"].includes(d.os));
}
