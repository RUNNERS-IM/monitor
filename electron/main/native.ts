// Loads Monitor's one native module (native/, napi-rs): readings, the cleanup scan, quit / pause and the tray picture.
// Why a path instead of a package: the build leaves one file per OS and CPU (monitor-native.darwin-arm64.node …);
// a dev run reads it from native/, a packaged app from Resources/native/ (electron-builder extraResources).
import { app } from "electron";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export interface Sampler {
  /** One reading as JSON. */
  sample(): Promise<string>;
  /** The last reading with made-up names and numbers (debug runs only, `MONITOR_DEMO=1`); `korean` picks the session names. */
  demoSnapshot(korean: boolean): string | null;
  quitApp(name: string): Promise<string>;
  /** Resolves to the Unix time the runner comes back, as text. */
  pauseRunner(name: string): Promise<string>;
}

export interface Native {
  Sampler: new () => Sampler;
  cleanupLoad(path: string): string | null;
  cleanupMeasure(progressPath?: string): Promise<string>;
  cleanupSave(path: string, json: string): void;
  /** Deletes the cleanable folders of one kind; resolves to `{"freed":bytes,"skipped":folders}` as JSON. */
  cleanupEmpty(kind: string): Promise<string>;
  /** A made-up cleanup result as JSON (debug runs only, `MONITOR_DEMO=1`). */
  demoCleanup(): string | null;
  nowSecs(): number;
  barsPng(h0: number, h1: number, h2: number, r: number, g: number, b: number): Buffer;
  barHeight(fraction: number): number;
  easeOut(t: number): number;
}

function load(): Native {
  const dir = app.isPackaged ? join(process.resourcesPath, "native") : join(app.getAppPath(), "native");
  const prefix = `monitor-native.${process.platform}-${process.arch}`;
  const file = readdirSync(dir).find((name) => name.startsWith(prefix) && name.endsWith(".node"));
  if (!file) throw new Error(`no ${prefix}*.node in ${dir}; run pnpm native`);
  return createRequire(__filename)(join(dir, file)) as Native;
}

export const native = load();
