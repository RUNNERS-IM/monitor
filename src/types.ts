// One reading of this computer, as the native module sends it (native/src/snapshot.rs, camelCase JSON).
import type { CleanupKind } from "../electron/preload/api";

export type Pressure = "normal" | "warn" | "critical";

export type AppKind = "app" | "build" | "simulator" | "devServer";
export type AppUse = { name: string; cpuPercent: number; memory: number; quittable: boolean; kind: AppKind; folder: string | null;
  /** For the "claude" entry: how many claude processes it adds up. */
  sessions: number | null;
  /** For a dev server: how long it has been running. */
  runningSecs: number | null;
};
/** Something worth doing now, chosen by the app (electron/main/suggest.ts). */
export type Suggestion =
  | { action: "quit"; reason: "memory" | "cpu"; name: string; devServer: boolean; folder: string | null; runningSecs: number | null; bytes: number; cpuPercent: number }
  | { action: "empty"; reason: "disk"; kind: CleanupKind; bytes: number };
export type ClaudeSession = { pid: number; name: string | null; runningSecs: number; busy: boolean; human: boolean };
export type Runner = { name: string; busy: boolean; pausedUntil: number | null };

export type Snapshot = {
  host: string;
  os: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  /** Bytes the panel's memory map shows besides apps (0 where the OS does not report one). */
  memoryWired: number;
  memoryCompressed: number;
  memoryCache: number;
  memoryFree: number;
  memoryPressure: Pressure;
  diskUsed: number;
  diskTotal: number;
  swapUsed: number;
  slowMemory: boolean;
  slowCpu: boolean;
  cpuHistory: number[];
  memoryHistory: number[];
  topCpu: AppUse[];
  topMemory: AppUse[];
  claudeSessions: ClaudeSession[];
  heavyJob: { name: string; command: string; runningSecs: number } | null;
  runners: Runner[];
  /** What to quit or empty now; added by the app, empty when nothing is worth doing. */
  suggestions: Suggestion[];
};

export type Cleanup = {
  total: number;
  top: { path: string; bytes: number }[];
  /** The total split by kind; empty in a result an older version saved. */
  kinds: { kind: CleanupKind; bytes: number }[];
  measuredAt: number;
};
