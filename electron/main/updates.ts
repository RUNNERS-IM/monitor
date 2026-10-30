// Keeps Monitor up to date from the GitHub release (electron-updater, RUNNERS-IM/monitor): checks once a day,
// first about a minute after launch. A new version is downloaded first and only then does Monitor ask, so "Install Now"
// restarts at once (the shared rule for all RUNNERS apps). Release builds only: a dev run is not a signed build,
// so it has nothing to compare with or install.
import { app, dialog } from "electron";
import { autoUpdater, type ProgressInfo } from "electron-updater";
import { currentLocale, t } from "./i18n";
import { releaseNoteLines } from "./releaseNotes";
import { readSettings, writeSettings } from "./settings";
import { askUpdate, type UpdateAnswer } from "./windows";

/** Wait after launch so a login start is not slowed down by the check. */
const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

let busy = false;

export function startUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  // Why: "What's new" shows the offered version's notes only, not those of versions in between.
  autoUpdater.fullChangelog = false;
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
    const version = result.updateInfo.version.replace("+", ".");
    const notes = releaseNoteLines(result.updateInfo.releaseNotes, currentLocale() === "ko" ? "ko" : "en");
    const answer = asked ? await askWhileDownloading(version, notes) : await askAfterDownload(version, notes);
    if (answer !== "install") {
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

/** The daily check: download quietly, and only then show the question (without taking focus). */
async function askAfterDownload(version: string, notes: string[] | null): Promise<UpdateAnswer> {
  await autoUpdater.downloadUpdate();
  return askUpdate({ version, notes, downloading: false, percent: 100 }, false).answer;
}

/** The menu's "Check for Updates…": the person is waiting, so the window opens at once and shows the download.
 *  Later closes it while the download carries on, so the next question needs no second download. */
async function askWhileDownloading(version: string, notes: string[] | null): Promise<UpdateAnswer> {
  const prompt = askUpdate({ version, notes, downloading: true, percent: 0 }, true);
  const progress = (info: ProgressInfo) => prompt.set({ percent: info.percent });
  autoUpdater.on("download-progress", progress);
  let failed: unknown = null;
  // Why: electron-updater hands back the download already running, so a second check never downloads twice.
  autoUpdater
    .downloadUpdate()
    .then(() => prompt.set({ downloading: false, percent: 100 }))
    .catch((error: unknown) => {
      failed = error;
      prompt.close();
    })
    .finally(() => autoUpdater.off("download-progress", progress));
  const answer = await prompt.answer;
  if (failed) throw failed;
  return answer;
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
