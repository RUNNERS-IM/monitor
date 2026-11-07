// The account's other computers: every Monitor signed in to the same RUNNERS account, found and asked through the
// system server's relay instead of the Tailscale network (shared decision 2026-11-05 "네 앱 계정 · 연결 통일" 1A, which
// replaced 2026-11-02's Tailscale-only way). Look only: another computer may ask this one for its numbers (`usage.get`)
// and nothing else, so nobody can quit an app or delete files from afar.
import * as relay from './relay'

/** How often the other computers are asked: slowly with nothing open, quickly while the All Computers window shows. */
const SLOW_MS = 30 * 1000
const FAST_MS = 5 * 1000
const ASK_TIMEOUT_MS = 4000
/** Why: a computer that left the relay (shut down, signed out, offline) stays on the list a while as Off, so a Mac
 *  that went down is noticed instead of quietly disappearing; after a day it is dropped. */
const KEEP_OFF_MS = 24 * 60 * 60 * 1000
const TOP_APPS = 5

/** What one computer tells the others. Kept small and free of paths: names and numbers only. */
export type Usage = {
  host: string
  os: string
  version: string
  cpuPercent: number
  memoryUsed: number
  memoryTotal: number
  memoryPressure: 'normal' | 'warn' | 'critical'
  diskUsed: number
  diskTotal: number
  slowMemory: boolean
  slowCpu: boolean
  /** The icon's level, held for a minute like slowMemory and slowCpu: "fine", "warn" or "bad" (memory critical).
   *  Optional because older Monitors do not send it. */
  level?: 'fine' | 'warn' | 'bad'
  topMemory: { name: string; memory: number }[]
  claudeSessions: number
  runnersBusy: number
  runnersIdle: number
  /** Bytes of caches and build folders that could be emptied; null while the first measurement runs. */
  cleanable: number | null
}

/** One other computer as the panel and the window show it. */
export type Peer = {
  name: string
  /** `ok` answered; `noAnswer` is on the relay but did not answer in time (busy, asleep a moment, or an older Monitor
   *  that only answers phones); `offline` left the relay. */
  state: 'ok' | 'noAnswer' | 'offline'
  /** For `noAnswer`, the last reading it gave, so a slow computer still shows its numbers. */
  usage: Usage | null
  /** When the last answer came (ms), so an old reading can be told apart. */
  at: number | null
}

/** By deviceId, so two Macs with the same name stay two cards. */
let peers = new Map<string, Peer>()
let fast = false
let wake: (() => void) | null = null

async function askOne(deviceId: string, name: string): Promise<Peer> {
  const last = peers.get(deviceId)
  try {
    const usage = (await relay.ask(deviceId, 'usage.get', {}, ASK_TIMEOUT_MS)) as Usage | null
    if (!usage) {
      throw new Error('no reading yet')
    }
    return { name: usage.host || name, state: 'ok', usage, at: Date.now() }
  } catch {
    // Why: a computer short of memory answers late; its last numbers stay up with the time they were read.
    return {
      name: last?.name ?? name,
      state: 'noAnswer',
      usage: last?.usage ?? null,
      at: last?.at ?? null
    }
  }
}

/** Asks every other computer in turn, forever: every 30 s, or every 5 s while `setFast(true)`. */
export async function askLoop(): Promise<void> {
  for (;;) {
    const on = relay.currentStatus() === 'connected' ? relay.otherHosts() : []
    const answers = await Promise.all(
      on.map(async (host) => [host.deviceId, await askOne(host.deviceId, host.name)] as const)
    )
    const next = new Map(answers)
    // Why: while this computer itself is off the relay nothing can be known about the others, so they are not marked Off.
    if (relay.currentStatus() === 'connected') {
      for (const [id, peer] of peers) {
        if (next.has(id)) {
          continue
        }
        const since = peer.at ?? 0
        if (Date.now() - since < KEEP_OFF_MS) {
          next.set(id, { ...peer, state: 'offline', usage: null })
        }
      }
      peers = next
    } else if (relay.currentStatus() === 'signedOut') {
      peers = new Map()
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, fast ? FAST_MS : SLOW_MS)
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }
}

/** Asks quickly while the All Computers window is open; turning it on also asks right away. */
export function setFast(on: boolean): void {
  const was = fast
  fast = on
  if (on && !was) {
    wake?.()
  }
}

/** Asks again now, as when this computer just joined the relay. */
export function askNow(): void {
  wake?.()
}

/** The other computers, slow ones first, then by name. Empty when signed out. */
export function peerList(): Peer[] {
  const rank = (peer: Peer) =>
    peer.usage && (peer.usage.slowMemory || peer.usage.slowCpu) && peer.state !== 'offline'
      ? 0
      : peer.state === 'ok'
        ? 1
        : 2
  return [...peers.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export function topApps<T extends { name: string; memory: number }>(
  apps: T[]
): { name: string; memory: number }[] {
  return apps.slice(0, TOP_APPS).map((app) => ({ name: app.name, memory: app.memory }))
}

/** Debug runs only: made-up computers for the homepage screenshots, with no real names or numbers. */
export function demoPeers(korean: boolean): Peer[] {
  const gb = 1024 ** 3
  const make = (
    name: string,
    cpu: number,
    mem: number,
    disk: number,
    slow: boolean,
    apps: [string, number][],
    claude: number,
    busy: number
  ): Peer => ({
    name,
    state: 'ok',
    at: Date.now() - 20_000,
    usage: {
      host: name,
      os: 'macOS 26.5 Tahoe',
      version: '2.6.1102',
      cpuPercent: cpu,
      memoryUsed: (mem / 100) * 32 * gb,
      memoryTotal: 32 * gb,
      memoryPressure: slow ? 'warn' : 'normal',
      diskUsed: (disk / 100) * 1000 * gb,
      diskTotal: 1000 * gb,
      slowMemory: slow,
      slowCpu: false,
      topMemory: apps.map(([app, size]) => ({ name: app, memory: size * gb })),
      claudeSessions: claude,
      runnersBusy: busy,
      runnersIdle: 1 - busy,
      cleanable: 38.4 * gb
    }
  })
  const office = korean
    ? ['디자인 맥', '빌드 맥', '회의실 맥', '서버 맥']
    : ['Design Mac', 'Build Mac', 'Meeting Room Mac', 'Server Mac']
  return [
    make(
      office[1],
      71,
      91,
      64,
      true,
      [
        ['Xcode', 7.4],
        ['Simulator', 4.1],
        ['Google Chrome', 2.6]
      ],
      3,
      1
    ),
    make(
      office[0],
      18,
      52,
      41,
      false,
      [
        ['Figma', 3.2],
        ['Google Chrome', 2.1],
        ['Slack', 0.9]
      ],
      1,
      0
    ),
    make(
      office[3],
      34,
      63,
      72,
      false,
      [
        ['Docker', 6.3],
        ['node', 1.8],
        ['Terminal', 0.4]
      ],
      2,
      0
    ),
    make(
      office[2],
      6,
      38,
      29,
      false,
      [
        ['Zoom', 1.2],
        ['Keynote', 0.8],
        ['Safari', 0.7]
      ],
      0,
      0
    ),
    { name: korean ? '노트북' : 'Laptop', state: 'offline', usage: null, at: null }
  ]
}
