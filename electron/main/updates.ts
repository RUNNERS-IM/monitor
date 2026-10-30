// Keeps Monitor up to date from the GitHub release (electron-updater, RUNNERS-IM/monitor): checks once a day,
// first about a minute after launch, and asks before installing. Release builds only: a dev run is not a signed
// build, so it has nothing to compare with or install.
import { app, dialog, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { t } from "./i18n";
import { readSettings } from "./settings";

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
      if (asked) await tell(t("update.latest", { version: displayVersion() }));
      return;
    }
    const version = result.updateInfo.version.replace("+", ".");
    app.focus({ steal: true });
    const answer = await dialog.showMessageBox({
      type: "info",
      message: t("update.ask", { version }),
      detail: t("update.askDetail"),
      buttons: [t("update.install"), t("update.later")],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response !== 0) return;
    new Notification({ title: "Monitor", body: t("update.installing", { version }) }).show();
    await autoUpdater.downloadUpdate();
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
