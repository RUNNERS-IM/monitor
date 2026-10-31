// "Open at login": Monitor starts with the computer so a slow computer is always shown on the tray (decided default on).
// The first release run turns it on once; after that only the menu line changes it, so turning it off sticks.
// macOS 13+ registers the app itself (listed by name under Login Items), Windows uses the Run key, Linux an
// autostart .desktop file.
import { app } from "electron";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Marks that the one-time default was applied, so a later launch never turns it back on. */
const DEFAULT_APPLIED = "open-at-login-default";
/** Folder the Tauri build of Monitor kept its data in; its marker counts too, so a choice made there is kept. */
const TAURI_DATA = "im.runners.monitor";
/** Login item the Tauri build wrote (tauri-plugin-autostart, LaunchAgent mode). */
const TAURI_LAUNCH_AGENT = join(homedir(), "Library", "LaunchAgents", "Monitor.plist");
const LINUX_AUTOSTART = join(homedir(), ".config", "autostart", "monitor.desktop");

export function isOn(): boolean {
  if (process.platform === "linux") return existsSync(LINUX_AUTOSTART);
  return app.getLoginItemSettings().openAtLogin;
}

export function setOn(on: boolean): void {
  if (process.platform === "linux") {
    if (!on) {
      rmSync(LINUX_AUTOSTART, { force: true });
      return;
    }
    // Why: an AppImage runs from a temporary mount, so the file names the AppImage itself.
    const exec = process.env.APPIMAGE ?? process.execPath;
    mkdirSync(join(homedir(), ".config", "autostart"), { recursive: true });
    writeFileSync(
      LINUX_AUTOSTART,
      `[Desktop Entry]\nType=Application\nName=Monitor\nExec="${exec}"\nX-GNOME-Autostart-enabled=true\n`,
    );
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on });
}

/** The menu line: flips the setting and returns what it is now. */
export function toggle(): boolean {
  setOn(!isOn());
  return isOn();
}

/**
 * Release builds only. Moves a Tauri login item over to the app's own, then turns it on the first time.
 * Debug runs leave the login items alone, so a dev copy of Electron is never registered.
 */
export function applyDefault(): void {
  if (!app.isPackaged) return;
  const marker = join(app.getPath("userData"), DEFAULT_APPLIED);
  // Why: the Tauri build left a LaunchAgent pointing at its binary; it is replaced by the app's own login item
  // so Monitor is listed by name, and the person's choice (on) is kept.
  if (process.platform === "darwin" && existsSync(TAURI_LAUNCH_AGENT)) {
    try {
      unlinkSync(TAURI_LAUNCH_AGENT);
      setOn(true);
      writeMarker(marker);
    } catch {
      // Left for the next launch.
    }
    return;
  }
  const tauriMarker = join(app.getPath("appData"), TAURI_DATA, DEFAULT_APPLIED);
  if (existsSync(marker) || existsSync(tauriMarker)) return;
  setOn(true);
  writeMarker(marker);
}

function writeMarker(marker: string): void {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(marker, "");
}
