// Monitor's main process: a tray app that samples this computer every 3 seconds, shows the reading on the tray and
// in a panel under it, pops the panel up by itself when the computer turns slow, and measures cleanable folders
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
import { createTray, showReading } from "./tray";
import type { Snapshot } from "./types";
import { checkNow, displayVersion, startUpdates } from "./updates";
import { answerUpdate, askUpdate, createPanel, placeUnderTray, showAbout, TRANSLUCENT, updateOffer } from "./windows";

const ISSUES_URL = "https://github.com/RUNNERS-IM/monitor/issues";
const REFRESH_MS = 3000;
const CLEANUP_EVERY_MS = 30 * 60 * 1000;
const CLEANUP_FILE = "cleanup.json";
const CLEANUP_PROGRESS_FILE = "cleanup-progress.json";
// Why: a slow computer stays slow for a while, so the same warning is repeated at most this often.
const SLOW_NOTICE_EVERY_MS = 30 * 60 * 1000;
// Why: memory pressure flips to warning and back within seconds on a busy Mac, so the popup waits until it has stayed
// short this long. The native CPU flag already means a full minute above the limit.
const SLOW_MEMORY_FOR_MS = 60 * 1000;
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

/** The panel opened by itself because the computer turned slow. */
const popup = {
  open: false,
  /** Reasons the open popup is about, so closing it silences exactly those. */
  showing: new Set<Reason>(),
  lastShown: new Map<Reason, number>(),
  /** Closed by the user, with the day it was closed on; not shown again for that reason that day. */
  dismissed: new Map<Reason, string>(),
  /** When each reason turned slow, cleared when it recovers. */
  slowSince: new Map<Reason, number>(),
};
const noticed = new Map<Reason, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function reasons(snap: Snapshot): [Reason, boolean][] {
  return [
    ["memory", snap.slowMemory],
    ["cpu", snap.slowCpu],
  ];
}

const today = () => new Date().toDateString();

function recently(at: number | undefined): boolean {
  return at !== undefined && Date.now() - at < SLOW_NOTICE_EVERY_MS;
}

/** Shows the panel without taking focus, under the tray. Why: a popup must not swallow what the user is typing. */
function showWithoutFocus(): void {
  if (!panel) return;
  panel.setFocusable(false);
  placeUnderTray(panel, tray);
  panel.showInactive();
}

/** Opens the panel by itself when the computer turns slow, with "why it is slow" on top.
 *  Returns false when there is no panel to open, so the caller can fall back to a notification. */
function popupIfSlow(snap: Snapshot): boolean {
  if (!panel || panel.isDestroyed()) return false;
  const now = Date.now();
  const slowNow = new Set(reasons(snap).filter(([, slow]) => slow).map(([reason]) => reason));
  for (const reason of ["memory", "cpu"] as Reason[]) {
    if (!slowNow.has(reason)) popup.slowSince.delete(reason);
    else if (!popup.slowSince.has(reason)) popup.slowSince.set(reason, now);
  }
  // Why: once the computer has recovered the popup has nothing left to say, so it closes itself.
  if (popup.open && ![...popup.showing].some((reason) => slowNow.has(reason))) {
    popup.open = false;
    popup.showing.clear();
    hidePanel();
  }
  const longEnough = (reason: Reason) => reason === "cpu" || now - (popup.slowSince.get(reason) ?? now) >= SLOW_MEMORY_FOR_MS;
  const due = [...slowNow].filter(
    (reason) => longEnough(reason) && popup.dismissed.get(reason) !== today() && !recently(popup.lastShown.get(reason)),
  );
  if (due.length === 0) return true;
  for (const reason of due) popup.lastShown.set(reason, now);
  // Why: when the user already has the panel open they see the reasons there; nothing more to pop up.
  if (panel.isVisible()) return true;
  popup.showing = new Set(due);
  popup.open = true;
  showWithoutFocus();
  return true;
}

/** Closes a popup and keeps it closed for the same reason for the rest of the day. */
function dismissPopup(): void {
  if (!popup.open) return;
  popup.open = false;
  for (const reason of popup.showing) popup.dismissed.set(reason, today());
  popup.showing.clear();
}

function hidePanel(): void {
  panel?.hide();
  panel?.setFocusable(true);
}

/** Shows a system notification when the computer turns slow, naming the apps most likely behind it.
 *  Why: kept for when there is no panel window to pop up. */
function notifyIfSlow(snap: Snapshot): void {
  for (const [reason, slow] of reasons(snap)) {
    if (!slow || recently(noticed.get(reason))) continue;
    const apps =
      reason === "memory"
        ? snap.topMemory.slice(0, NOTICE_APPS).map((a) => `${a.name} ${(a.memory / 1024 ** 3).toFixed(1)} GB`)
        : snap.topCpu.slice(0, NOTICE_APPS).map((a) => `${a.name} ${Math.round(a.cpuPercent)}%`);
    new Notification({ title: t(`notice.${reason}.title`), body: t("notice.body", { apps: apps.join(", ") }) }).show();
    noticed.set(reason, Date.now());
  }
}

function togglePanel(): void {
  if (!panel) return;
  if (panel.isVisible()) {
    // Why: clicking the tray while the popup is up is the user saying "seen it".
    dismissPopup();
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

/** The reading the panel gets: the newest one plus what only the app knows (popup, paused runners). */
function panelSnapshot(): Snapshot | null {
  const base = DEMO ? latestDemo : latest;
  if (!base) return null;
  const snap: Snapshot = { ...base, runners: base.runners.map((r) => ({ ...r })), popup: popup.open };
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
      if (!popupIfSlow(snap)) notifyIfSlow(snap);
      latest = snap;
      if (DEMO) {
        const demo = sampler!.demoSnapshot(currentLocale() === "ko");
        latestDemo = demo ? (JSON.parse(demo) as Snapshot) : null;
      }
      // Why: in a demo run the menu-bar icon shows the made-up numbers too, so it matches the panel in a screenshot.
      if (tray) showReading(tray, latestDemo ?? snap);
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
  ipcMain.handle("monitor:closePopup", () => {
    dismissPopup();
    hidePanel();
  });
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
 *  `MONITOR_THEME=dark|light` forces the look, and `MONITOR_SOLID=1` turns the blur off so the desktop does not show through. The panel opens like the popup (no focus), so it stays up. */
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
    // Why: the popup never takes focus, so a focus change elsewhere must not close it; it has its own close button.
    if (popup.open || Date.now() - shownAt < BLUR_GRACE_MS) return;
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
