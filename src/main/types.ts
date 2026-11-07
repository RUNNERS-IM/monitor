// The parts of a reading the main process reads. The full shape is in src/renderer/types.ts, which the panel uses.
export type Pressure = 'normal' | 'warn' | 'critical'

export type AppKind = 'app' | 'build' | 'simulator' | 'devServer'
export type QuitKind = 'app' | 'process'

export type AppUse = {
  name: string
  cpuPercent: number
  memory: number
  /** How Quit ends it: "app" asks it to quit like ⌘Q (it may ask to save), "process" ends it at once; null offers no Quit. */
  quit: QuitKind | null
  kind: AppKind
  /** The Mac app's bundle id, for the entries on screen. */
  bundleId: string | null
  folder: string | null
  runningSecs: number | null
}

export type Runner = {
  name: string
  busy: boolean
  pausedUntil: number | null
  /** Turned off in launchd on this computer, so it never runs here. */
  off?: boolean
}

export type Snapshot = {
  host: string
  cpuPercent: number
  /** The part of cpuPercent spent in macOS itself (kernel); missing from an older native module. */
  cpuSystemPercent?: number
  memoryUsed: number
  memoryTotal: number
  memoryPressure: Pressure
  diskUsed: number
  diskTotal: number
  slowMemory: boolean
  slowCpu: boolean
  topCpu: AppUse[]
  topMemory: AppUse[]
  runners: Runner[]
}

export function memoryPercent(snap: Snapshot): number {
  return snap.memoryTotal === 0 ? 0 : (snap.memoryUsed * 100) / snap.memoryTotal
}

export function diskPercent(snap: Snapshot): number {
  return snap.diskTotal === 0 ? 0 : (snap.diskUsed * 100) / snap.diskTotal
}
