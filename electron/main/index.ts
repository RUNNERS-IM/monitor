// Monitor's main process: a tray app that samples this computer every 3 seconds, shows the reading on the tray and
// in a panel under it, colours the tray icon and notifies once a day when the computer turns slow, and measures cleanable folders
// every 30 minutes.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, shell, systemPreferences, type Tray } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentLocale, t } from "./i18n";
import * as login from "./login";
import { buildMenu, forgetIcons, type Command, type MenuState } from "./menu";
import { native, type Sampler } from "./native";
import { releaseNoteLines } from "./releaseNotes";
import { readSettings, writeSettings } from "./settings";
import { createTray, showReading, type Level } from "./tray";
import type { Snapshot } from "./types";
import { checkNow, displayVersion, startUpdates } from "./updates";
import { answerUpdate, askUpdate, createPanel, placeUnderTray, showAbout, TRANSLUCENT, updateOffer } from "./windows";

const ISSUES_URL = "https://github.com/RUNNERS-IM/monitor/issues";
const REFRESH_MS = 3000;
const CLEANUP_EVERY_MS = 30 * 60 * 1000;
const CLEANUP_FILE = "cleanup.json";
const CLEANUP_PROGRESS_FILE = "cleanup-progress.json";
// Why: memory pressure flips to warning and back within seconds on a busy Mac, so a slow reading still counts until
// it has been gone this long; otherwise the icon would flicker and a notice could never see a full minute.
const SLOW_HOLD_MS = 60 * 1000;
// Why: a notice is for a computer that has stayed slow, not a short spike. The native CPU flag already means a full minute.
const SLOW_NOTICE_AFTER_MS = 60 * 1000;
const NOTICE_APPS = 2;
// Why: the tray click that opens the panel can also send it a focus-lost event right away, so blur is ignored this long after opening.
const BLUR_GRACE_MS = 400;
// Why: clicking the tray while the panel is open first takes focus from the panel (which hides it); a click that
// lands this soon after is the same click and must not open it again.
const REOPEN_GUARD_MS = 300;

/** Debug runs only: everything below that reads MONITOR_* is ignored in a packaged app. */
const DEV = !app.isPackaged;
const DEMO = DEV && !!process.env.MONITOR_DEMO;
// Why: the windows read their language from navigator.language, which follows Chromium's --lang switch.
if (DEV && process.env.MONITOR_LANG) app.commandLine.appendSwitch("lang", process.env.MONITOR_LANG);

type Reason = "memory" | "cpu";

let tray: Tray | null = null;
let panel: BrowserWindow | null = null;
let sampler: Sampler | null = null;
/** The newest reading. Why: one loop samples for both the tray and the panel, so opening the panel does not take
 *  extra readings that would cut CPU averages short and double the history. */
let latest: Snapshot | null = null;
/** Debug runs only: the same reading with made-up names, shown in the panel for public screenshots. */
let latestDemo: Snapshot | null = null;
type CleanupResult = { total: number; kinds?: { kind: string; bytes: number }[]; measuredAt: number };
let latestCleanup: CleanupResult | null = null;
/** Ends the cleanup loop's wait early, so a measurement right after emptying shows what is left. */
let measureNow: (() => void) | null = null;
let shownAt = 0;
let hiddenByBlurAt = 0;
/** Runners paused from the panel, by name, with the Unix time they come back.
 *  Why: a paused runner has no process, so without this it would simply vanish from the list. */
const paused = new Map<string, number>();

/** When each reason was last read as slow, and since when it has stayed slow (allowing the short gaps above). */
const slow = {
  lastAt: new Map<Reason, number>(),
  since: new Map<Reason, number>(),
  /** When memory pressure was last critical. */
  criticalAt: 0,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function reasons(snap: Snapshot): [Reason, boolean][] {
  return [
    ["memory", snap.slowMemory],
    ["cpu", snap.slowCpu],
  ];
}

const today = () => new Date().toDateString();

/** Reasons that are slow now, holding each for SLOW_HOLD_MS after its last slow reading. Also returns the icon level. */
function trackSlow(snap: Snapshot): { held: Reason[]; level: Level } {
  const now = Date.now();
  if (snap.memoryPressure === "critical") slow.criticalAt = now;
  const held: Reason[] = [];
  for (const [reason, isSlow] of reasons(snap)) {
    if (isSlow) slow.lastAt.set(reason, now);
    if (now - (slow.lastAt.get(reason) ?? -Infinity) < SLOW_HOLD_MS) {
      held.push(reason);
      if (!slow.since.has(reason)) slow.since.set(reason, now);
    } else slow.since.delete(reason);
  }
  const level: Level = now - slow.criticalAt < SLOW_HOLD_MS ? "bad" : held.length > 0 ? "warn" : "fine";
  return { held, level };
}

/** Shows a system notification once a day per reason when the computer has stayed slow, naming the apps most likely
 *  behind it. Clicking it opens the panel. Why: the panel no longer opens by itself (it kept reopening on Macs that
 *  hover at the warning level), and the day is saved so a restart does not repeat it. */
function notifyIfSlow(snap: Snapshot, held: Reason[]): void {
  const now = Date.now();
  for (const reason of held) {
    if (now - (slow.since.get(reason) ?? now) < SLOW_NOTICE_AFTER_MS) continue;
    const noticedOn = readSettings().noticedOn;
    if (noticedOn[reason] === today()) continue;
    writeSettings({ noticedOn: { ...noticedOn, [reason]: today() } });
    const apps =
      reason === "memory"
        ? snap.topMemory.slice(0, NOTICE_APPS).map((a) => `${a.name} ${(a.memory / 1024 ** 3).toFixed(1)} GB`)
        : snap.topCpu.slice(0, NOTICE_APPS).map((a) => `${a.name} ${Math.round(a.cpuPercent)}%`);
    const notice = new Notification({ title: t(`notice.${reason}.title`), body: t("notice.body", { apps: apps.join(", ") }) });
    notice.on("click", () => {
      if (!panel?.isVisible()) togglePanel();
    });
    notice.show();
  }
}

/** Shows the panel without taking focus, under the tray. Debug runs only, so a screenshot can be taken without a click. */
function showWithoutFocus(): void {
  if (!panel) return;
  panel.setFocusable(false);
  placeUnderTray(panel, tray);
  panel.showInactive();
}

function hidePanel(): void {
  panel?.hide();
  panel?.setFocusable(true);
}

function togglePanel(): void {
  if (!panel) return;
  if (panel.isVisible()) {
    hidePanel();
    return;
  }
  if (Date.now() - hiddenByBlurAt < REOPEN_GUARD_MS) return;
  panel.setFocusable(true);
  placeUnderTray(panel, tray);
  shownAt = Date.now();
  panel.show();
  panel.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

function menuState(): MenuState {
  return { openAtLogin: login.isOn(), autoUpdate: readSettings().autoUpdate };
}

function run(command: Command): void {
  switch (command) {
    case "usage":
      togglePanel();
      break;
    case "login":
      login.toggle();
      break;
    case "autoUpdate":
      writeSettings({ autoUpdate: !readSettings().autoUpdate });
      break;
    case "about":
      hidePanel();
      showAbout();
      break;
    case "updates":
      hidePanel();
      checkNow();
      break;
    case "help":
      hidePanel();
      void shell.openExternal(ISSUES_URL);
      break;
    case "quit":
      app.quit();
      break;
  }
  refreshLinuxMenu();
}

/** Linux trays only open a menu set beforehand (no click events), so it is rebuilt when its lines change. */
let linuxMenuText = "";
function refreshLinuxMenu(): void {
  if (process.platform !== "linux" || !tray) return;
  const menu = buildMenu(latest, menuState(), run);
  const text = menu.items.map((item) => item.label).join("\n") + JSON.stringify(menuState()) + nativeTheme.shouldUseDarkColors;
  if (text === linuxMenuText) return;
  linuxMenuText = text;
  tray.setContextMenu(menu);
}

/** The reading the panel gets: the newest one plus what only the app knows (paused runners). */
function panelSnapshot(): Snapshot | null {
  const base = DEMO ? latestDemo : latest;
  if (!base) return null;
  const snap: Snapshot = { ...base, runners: base.runners.map((r) => ({ ...r })) };
  const now = Date.now() / 1000;
  for (const [name, until] of paused) {
    if (until <= now) {
      paused.delete(name);
      continue;
    }
    const runner = snap.runners.find((r) => r.name === name);
    if (runner) runner.pausedUntil = until;
    else snap.runners.push({ name, busy: false, pausedUntil: until });
  }
  snap.runners.sort((a, b) => a.name.localeCompare(b.name));
  return snap;
}

async function sampleLoop(): Promise<void> {
  for (;;) {
    const started = Date.now();
    try {
      const snap = JSON.parse(await sampler!.sample()) as Snapshot;
      const { held, level } = trackSlow(snap);
      notifyIfSlow(snap, held);
      latest = snap;
      if (DEMO) {
        const demo = sampler!.demoSnapshot(currentLocale() === "ko");
        latestDemo = demo ? (JSON.parse(demo) as Snapshot) : null;
      }
      // Why: in a demo run the menu-bar icon shows the made-up numbers too, so it matches the panel in a screenshot.
      if (tray) showReading(tray, latestDemo ?? snap, latestDemo ? "warn" : level);
      refreshLinuxMenu();
    } catch (error) {
      console.error("sample:", error);
    }
    await sleep(Math.max(0, REFRESH_MS - (Date.now() - started)));
  }
}

async function cleanupLoop(): Promise<void> {
  const dir = app.getPath("userData");
  const saved = join(dir, CLEANUP_FILE);
  const progress = join(dir, CLEANUP_PROGRESS_FILE);
  // Why: measuring takes minutes, so a restart shows the saved numbers; the Tauri build's file counts too.
  const found = native.cleanupLoad(saved) ?? native.cleanupLoad(join(app.getPath("appData"), "im.runners.monitor", CLEANUP_FILE));
  if (found) {
    const parsed = JSON.parse(found) as CleanupResult;
    latestCleanup = parsed;
    await waitForMeasure(Math.max(0, CLEANUP_EVERY_MS - (native.nowSecs() - parsed.measuredAt) * 1000));
  }
  for (;;) {
    try {
      const json = await native.cleanupMeasure(progress);
      native.cleanupSave(saved, json);
      latestCleanup = JSON.parse(json);
    } catch (error) {
      console.error("cleanup:", error);
    }
    await waitForMeasure(CLEANUP_EVERY_MS);
  }
}

function waitForMeasure(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    measureNow = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

/** Asks before deleting, since the folders skip the Trash, then deletes one kind and takes it off the shown numbers. */
async function emptyCleanup(kind: string): Promise<{ freed: number; skipped: number } | null> {
  const part = latestCleanup?.kinds?.find((item) => item.kind === kind);
  if (!latestCleanup || !part || DEMO) return null;
  const size = `${(part.bytes / 1024 ** 3).toFixed(1)} GB`;
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: t(`empty.confirm.${kind}`, { size }),
    detail: t(`empty.detail.${kind}`),
    buttons: [t("empty.button"), t("empty.cancel")],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return null;
  const done = JSON.parse(await native.cleanupEmpty(kind)) as { freed: number; skipped: number };
  // Why: the next measurement takes minutes, so the freed bytes come off the shown numbers right away.
  latestCleanup = {
    ...latestCleanup,
    total: Math.max(0, latestCleanup.total - done.freed),
    kinds: latestCleanup.kinds?.map((item) => (item.kind === kind ? { ...item, bytes: Math.max(0, item.bytes - done.freed) } : item)),
  };
  measureNow?.();
  return done;
}

function accentColor(): string | null {
  if (process.platform !== "darwin" && process.platform !== "win32") return null;
  const color = systemPreferences.getAccentColor();
  return color ? `#${color.slice(0, 6)}` : null;
}

function registerIpc(): void {
  ipcMain.handle("monitor:snapshot", () => panelSnapshot());
  ipcMain.handle("monitor:cleanup", () => (DEMO ? JSON.parse(native.demoCleanup() ?? "null") : latestCleanup));
  ipcMain.handle("monitor:quitApp", async (_event, name: string) => {
    await sampler!.quitApp(String(name));
  });
  ipcMain.handle("monitor:emptyCleanup", (_event, kind: string) => emptyCleanup(String(kind)));
  ipcMain.handle("monitor:pauseRunner", async (_event, name: string) => {
    const until = Number(await sampler!.pauseRunner(String(name)));
    paused.set(String(name), until);
  });
  ipcMain.handle("monitor:translucent", () => TRANSLUCENT);
  ipcMain.handle("monitor:version", () => displayVersion());
  ipcMain.handle("monitor:accentColor", () => accentColor());
  ipcMain.handle("monitor:menuState", () => menuState());
  ipcMain.handle("monitor:command", (_event, command: Command) => {
    run(command);
    return menuState();
  });
  ipcMain.handle("monitor:openExternal", (_event, url: string) => {
    // Why: only https links are opened, so a page can never launch anything else.
    if (/^https:\/\//.test(String(url))) void shell.openExternal(String(url));
  });
  ipcMain.on("monitor:fitHeight", (event, height: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !Number.isFinite(height) || height <= 0) return;
    const [width] = window.getContentSize();
    window.setContentSize(width, Math.ceil(height));
    // Why: on Windows the panel hangs above the taskbar, so a taller panel must move up to stay attached.
    if (window === panel && process.platform === "win32" && panel.isVisible()) placeUnderTray(panel, tray);
  });
  ipcMain.on("monitor:closeWindow", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("monitor:updateOffer", () => updateOffer());
  ipcMain.on("monitor:answerUpdate", (_event, answer: unknown) => answerUpdate(answer === "install" ? "install" : "later"));
}

/** Debug runs only: `MONITOR_OPEN=panel|about|update` opens that window at launch, so it can be captured without
 *  clicking the tray (`update` / `update-progress` show the update question with the notes in RELEASE_NOTES.md, downloaded or still
 *  downloading, and install nothing), and
 *  `MONITOR_THEME=dark|light` forces the look, and `MONITOR_SOLID=1` turns the blur off so the desktop does not show through. The panel opens without focus, so it stays up. */
function debugHooks(): void {
  const theme = process.env.MONITOR_THEME;
  if (theme === "dark" || theme === "light") nativeTheme.themeSource = theme;
  const which = process.env.MONITOR_OPEN;
  // Why: the tray icon needs a moment before it reports where it sits.
  if (which === "about") setTimeout(showAbout, 1500);
  if (which === "panel") setTimeout(showWithoutFocus, 1500);
  if (which === "update" || which === "update-progress") {
    // Why: the window shows the notes the next release will carry, so screenshots match the real thing.
    const notes = releaseNoteLines(readFileSync(join(app.getAppPath(), "RELEASE_NOTES.md"), "utf8"), currentLocale() === "ko" ? "ko" : "en");
    // Why: `update-progress` shows the menu check's download state, held at a made-up 42%.
    const downloading = which === "update-progress";
    setTimeout(() => {
      const prompt = askUpdate({ version: "2.6.1030.4", notes, downloading, percent: downloading ? 42 : 100 }, false);
      void prompt.answer.then((answer) => console.log("update answer:", answer));
    }, 1500);
  }
}

function start(): void {
  // Why: Monitor lives in the tray only, so it should not take a Dock slot on macOS.
  app.dock?.hide();
  registerIpc();
  login.applyDefault();
  sampler = new native.Sampler();
  panel = createPanel();
  panel.on("blur", () => {
    if (Date.now() - shownAt < BLUR_GRACE_MS) return;
    hiddenByBlurAt = Date.now();
    hidePanel();
  });
  tray = createTray();
  if (process.platform === "linux") refreshLinuxMenu();
  else {
    tray.on("click", togglePanel);
    tray.on("right-click", () => tray?.popUpContextMenu(buildMenu(latest, menuState(), run)));
  }
  nativeTheme.on("updated", () => {
    forgetIcons();
    refreshLinuxMenu();
  });
  void sampleLoop();
  void cleanupLoop();
  startUpdates();
  if (DEV) debugHooks();
}

// Why: a second copy would add a second tray icon; opening it again shows the panel of the running one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (panel && !panel.isVisible()) togglePanel();
  });
  // Why: closing the About window must not quit a tray app.
  app.on("window-all-closed", () => undefined);
  void app.whenReady().then(start);
}
