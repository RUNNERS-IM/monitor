// The parts of a reading the main process reads. The full shape is in src/types.ts, which the panel uses.
export type Pressure = "normal" | "warn" | "critical";

export type AppUse = { name: string; cpuPercent: number; memory: number };

export type Runner = { name: string; busy: boolean; pausedUntil: number | null };

export type Snapshot = {
  host: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPressure: Pressure;
  diskUsed: number;
  diskTotal: number;
  slowMemory: boolean;
  slowCpu: boolean;
  topCpu: AppUse[];
  topMemory: AppUse[];
  runners: Runner[];
};

export function memoryPercent(snap: Snapshot): number {
  return snap.memoryTotal === 0 ? 0 : (snap.memoryUsed * 100) / snap.memoryTotal;
}

export function diskPercent(snap: Snapshot): number {
  return snap.diskTotal === 0 ? 0 : (snap.diskUsed * 100) / snap.diskTotal;
}
