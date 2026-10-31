// The windows: the tray panel (frameless, OS blur, closes when focus leaves), the About window and the update question.
import { app, BrowserWindow, nativeTheme, screen, type Tray } from "electron";
import { join } from "node:path";
import { t } from "./i18n";

export const PANEL_WIDTH = 300;
const ABOUT_WIDTH = 520;
/** First height only; the page then fits the window to its content. */
const ABOUT_HEIGHT = 560;
const UPDATE_WIDTH = 400;
/** Buttons and keys in the update window do nothing this long after it appears. */
const UPDATE_GUARD_MS = 1000;
/** Space between the menu bar (or taskbar) and the panel. */
const GAP = 4;

/** Dev only: `MONITOR_SOLID=1` turns the blur off so screenshots do not show the desktop behind the window. */
const SOLID = !app.isPackaged && process.env.MONITOR_SOLID === "1";

/** Whether the OS blurs what is behind the panel; the page draws a solid background when it does not. */
export const TRANSLUCENT = !SOLID && (process.platform === "darwin" || process.platform === "win32");

function load(window: BrowserWindow, page: "panel" | "about" | "update"): void {
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${page}`);
  else void window.loadFile(join(__dirname, "../renderer/index.html"), { hash: page });
}

const preload = join(__dirname, "../preload/index.js");

/** macOS gets the menu material Split's menu has, Windows gets Acrylic, Linux has no blur and stays solid. */
function blur(): Electron.BrowserWindowConstructorOptions {
  if (SOLID) return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#2a2a2a" : "#ececec" };
  if (process.platform === "darwin") return { vibrancy: "menu", visualEffectState: "active", backgroundColor: "#00000000" };
  if (process.platform === "win32") return { backgroundMaterial: "acrylic", backgroundColor: "#00000000" };
  return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#2a2a2a" : "#ececec" };
}

export function createPanel(): BrowserWindow {
  const panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 360,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    title: "Monitor",
    ...blur(),
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  // Why: a menu shows over full-screen apps and on every Space, so the panel does too.
  panel.setAlwaysOnTop(true, "pop-up-menu");
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  load(panel, "panel");
  return panel;
}

/** Puts the panel just under the tray icon (above it on Windows), kept inside the screen the icon is on. */
export function placeUnderTray(panel: BrowserWindow, tray: Tray | null): void {
  const [width, height] = panel.getSize();
  const icon = tray && !tray.isDestroyed() ? tray.getBounds() : null;
  // Why: Linux trays do not report where the icon is, so the panel goes to the top-right corner there.
  const anchor = icon && icon.width > 0 ? icon : null;
  const display = anchor ? screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }) : screen.getPrimaryDisplay();
  const area = display.workArea;
  let x: number;
  let y: number;
  if (anchor) {
    x = Math.round(anchor.x + anchor.width / 2 - width / 2);
    y = process.platform === "win32" ? anchor.y - height - GAP : anchor.y + anchor.height + GAP;
  } else {
    x = area.x + area.width - width - GAP;
    y = area.y + GAP;
  }
  x = Math.min(Math.max(x, area.x + GAP), area.x + area.width - width - GAP);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  panel.setPosition(x, y, false);
}

let about: BrowserWindow | null = null;

/** Opens the About window, or brings the open one to the front. An ordinary window with a title bar. */
export function showAbout(): void {
  if (about && !about.isDestroyed()) {
    about.show();
    about.focus();
    return;
  }
  about = new BrowserWindow({
    width: ABOUT_WIDTH,
    height: ABOUT_HEIGHT,
    useContentSize: true,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: t("about.title"),
    ...(process.platform === "darwin"
      ? { vibrancy: "under-window" as const, visualEffectState: "active" as const, backgroundColor: "#00000000" }
      : process.platform === "win32"
        ? { backgroundMaterial: "acrylic" as const, backgroundColor: "#00000000" }
        : {}),
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  about.setMenu(null);
  // Why: the page's <title> is "Monitor"; the window keeps its own localized "About Monitor".
  about.on("page-title-updated", (event) => event.preventDefault());
  about.once("ready-to-show", () => {
    about?.center();
    about?.show();
    // Why: Monitor has no Dock icon, so without focus the window can open behind the app in front.
    about?.focus();
  });
  about.on("closed", () => {
    about = null;
  });
  load(about, "about");
}

/** What the update window shows: the new version (as people see it), its "What's new" lines (null hides the box) and,
 *  while it is still being downloaded, how far along it is (0–100). */
export type UpdateOffer = { version: string; notes: string[] | null; downloading: boolean; percent: number };
export type UpdateAnswer = "install" | "later";

/** An open update window: its answer once a button is pressed (closing it is Later), and a way to change its state. */
export type UpdatePrompt = { answer: Promise<UpdateAnswer>; set: (change: Partial<UpdateOffer>) => void; close: () => void };

let update: { window: BrowserWindow; offer: UpdateOffer; answer: (answer: UpdateAnswer) => void } | null = null;

/** Asks whether to install, in a small window drawn like the menu: title, one line, "What's new", a progress bar while
 *  downloading, [Later] [Install Now]. Why a window and not a message box: the native box can hold neither a list that
 *  scrolls nor a progress bar. Closing it counts as Later.
 *  `focus` is for the menu's "Check for Updates…", where the person is waiting for it. The daily check shows the
 *  window without taking focus, so a Return typed into another app never lands on Install Now. */
export function askUpdate(offer: UpdateOffer, focus: boolean): UpdatePrompt {
  if (update && !update.window.isDestroyed()) update.window.close();
  let resolve!: (answer: UpdateAnswer) => void;
  const answerPromise = new Promise<UpdateAnswer>((done) => {
    resolve = done;
  });
  const window = new BrowserWindow({
    width: UPDATE_WIDTH,
    height: 200,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    roundedCorners: true,
    alwaysOnTop: true,
    title: "Monitor",
    ...blur(),
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  const current = { window, offer: { ...offer }, answer: (_: UpdateAnswer) => {} };
  let answered = false;
  let shownAt = Number.POSITIVE_INFINITY;
  current.answer = (value: UpdateAnswer) => {
    // Why: a Return or click meant for something else must not answer a window that just appeared (a test window
    // was answered Install Now this way while someone was typing). Closing the window is still Later at any time.
    if (Date.now() - shownAt < UPDATE_GUARD_MS) return;
    // Why: Install Now cannot be chosen before the download is done; the button is off then, this guards Return too.
    if (answered || (value === "install" && current.offer.downloading)) return;
    answered = true;
    resolve(value);
    // Why: after Install Now the window stays up showing "Installing…" until the app quits.
    if (value === "later" && !window.isDestroyed()) window.close();
  };
  update = current;
  window.on("page-title-updated", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    window.center();
    shownAt = Date.now();
    if (!focus) {
      window.showInactive();
      return;
    }
    app.focus({ steal: true });
    window.show();
    window.focus();
  });
  window.on("closed", () => {
    if (update === current) update = null;
    // Why: closing is Later, also within the first second and while still downloading.
    if (!answered) {
      answered = true;
      resolve("later");
    }
  });
  load(window, "update");
  return {
    answer: answerPromise,
    set: (change) => {
      // Why: the buttons appear only when the download is done, so the one-second guard starts again then.
      if (current.offer.downloading && change.downloading === false) shownAt = Date.now();
      current.offer = { ...current.offer, ...change };
      if (!window.isDestroyed()) window.webContents.send("monitor:updateOffer", current.offer);
    },
    close: () => {
      if (!window.isDestroyed()) window.close();
    },
  };
}

/** The offer for the update page, so the page can draw it. */
export function updateOffer(): UpdateOffer | null {
  return update?.offer ?? null;
}

/** The button the update page's reader pressed. */
export function answerUpdate(value: UpdateAnswer): void {
  update?.answer(value);
}
