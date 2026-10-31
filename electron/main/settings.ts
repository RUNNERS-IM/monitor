// Monitor's few settings, kept in settings.json in the user data folder.
import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Settings = {
  /** Check GitHub for a new release once a day. On by default. */
  autoUpdate: boolean;
  /** The day (`2026-10-30`) "Later" was chosen in the update dialog, so the daily check does not ask again that day. */
  updateLaterOn: string | null;
  /** The day (`Sat Oct 31 2026`) each slow-computer notice was last shown. Why: once a day, even across restarts. */
  noticedOn: Partial<Record<"memory" | "cpu", string>>;
};

const DEFAULTS: Settings = { autoUpdate: true, updateLaterOn: null, noticedOn: {} };

function file(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function readSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(change: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...change };
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
