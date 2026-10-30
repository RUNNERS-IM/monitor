// Keeps Monitor up to date from the GitHub release (electron-updater, RUNNERS-IM/monitor): checks once a day,
// first about a minute after launch. A new version is downloaded first and only then does Monitor ask, so "Install Now"
// restarts at once (the shared rule for all RUNNERS apps). Release builds only: a dev run is not a signed build,
// so it has nothing to compare with or install.
import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { t } from "./i18n";
import { readSettings, writeSettings } from "./settings";

/** Wait after launch so a login start is not slowed down by the check. */
const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

let busy = false;

export function startUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  // Why: installing is only ever done after the person says yes, never silently on quit.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("error", (error) => console.error("update:", error));
  setTimeout(() => {
    void check(false);
    setInterval(() => void check(false), CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
}

/** "Check for Updates…" in the menu: same check, but also says when Monitor is already up to date. */
export function checkNow(): void {
  void check(true);
}

async function check(asked: boolean): Promise<void> {
  if (busy || (!asked && !readSettings().autoUpdate)) return;
  busy = true;
  try {
    if (!app.isPackaged) throw new Error("a development build does not update");
    const result = await autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      if (asked) await tell(t("update.latest"));
      return;
    }
    // Why: "Later" means not again today; only the menu's "Check for Updates…" asks again the same day.
    if (!asked && readSettings().updateLaterOn === today()) return;
    // Why: asking only after the download means "Install Now" never leaves the person waiting on a progress bar.
    await autoUpdater.downloadUpdate();
    const version = result.updateInfo.version.replace("+", ".");
    app.focus({ steal: true });
    const answer = await dialog.showMessageBox({
      type: "info",
      message: t("update.title"),
      detail: t("update.ask", { version }),
      // Why: macOS lays buttons out from the right, so this reads [Later] [Install Now] with Install Now as the default;
      // Windows and Linux read left to right, which puts the default first as their dialogs do.
      buttons: [t("update.install"), t("update.later")],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response !== 0) {
      writeSettings({ updateLaterOn: today() });
      return;
    }
    // Why: Monitor holds no unsaved work, so restarting right away is safe and puts the new build in place at once.
    autoUpdater.quitAndInstall(true, true);
  } catch (error) {
    if (asked) await tell(t("update.failed", { error: error instanceof Error ? error.message : String(error) }));
  } finally {
    busy = false;
  }
}

async function tell(message: string): Promise<void> {
  app.focus({ steal: true });
  await dialog.showMessageBox({ type: "info", message, buttons: ["OK"] });
}

/** Version as people see it: a same-day build `2.6.1030+2` reads `2.6.1030.2`, like its release tag. */
export function displayVersion(): string {
  return app.getVersion().replace("+", ".");
}

/** The local calendar day, as `2026-10-30`. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
