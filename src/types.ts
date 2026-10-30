// One reading of this computer, as the native module sends it (native/src/snapshot.rs, camelCase JSON).
export type Pressure = "normal" | "warn" | "critical";

export type AppKind = "app" | "build" | "simulator";
export type AppUse = { name: string; cpuPercent: number; memory: number; quittable: boolean; kind: AppKind; folder: string | null };
export type ClaudeSession = { pid: number; name: string | null; runningSecs: number; busy: boolean; human: boolean };
export type Runner = { name: string; busy: boolean; pausedUntil: number | null };

export type Snapshot = {
  host: string;
  os: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
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
  popup: boolean;
};

export type Cleanup = { total: number; top: { path: string; bytes: number }[]; measuredAt: number };
