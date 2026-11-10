// The windows: the tray panel (frameless, OS blur, closes when focus leaves), Settings and the update question.
import { app, BrowserWindow, nativeTheme, screen, type Tray } from 'electron'
import { join } from 'node:path'
import { t } from './i18n'
import type { SettingsTab } from '../preload/api'
import { createUpdateWindow } from './runners/update-window'

export const PANEL_WIDTH = 300
const UPDATE_WIDTH = 400
/** Space between the menu bar (or taskbar) and the panel. */
const GAP = 4

/** Dev only: `MONITOR_SOLID=1` turns the blur off so screenshots do not show the desktop behind the window. */
const SOLID = !app.isPackaged && process.env.MONITOR_SOLID === '1'

/** Whether the OS blurs what is behind the panel; the page draws a solid background when it does not. */
export const TRANSLUCENT = !SOLID && (process.platform === 'darwin' || process.platform === 'win32')

function load(window: BrowserWindow, page: 'panel' | 'settings' | 'update', query = ''): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query ? `?${query}` : ''}#${page}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: page, search: query })
  }
}

const preload = join(__dirname, '../preload/index.js')

/** macOS gets the menu material Split's menu has, Windows gets Acrylic, Linux has no blur and stays solid. */
function blur(): Electron.BrowserWindowConstructorOptions {
  if (SOLID) {
    return { backgroundColor: nativeTheme.shouldUseDarkColors ? '#2a2a2a' : '#ececec' }
  }
  if (process.platform === 'darwin') {
    return { vibrancy: 'menu', visualEffectState: 'active', backgroundColor: '#00000000' }
  }
  if (process.platform === 'win32') {
    return { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
  }
  return { backgroundColor: nativeTheme.shouldUseDarkColors ? '#2a2a2a' : '#ececec' }
}

/** 설정 · 업데이트 창의 바탕색. runners-window.css 의 --rw-window-bg 와 같은 값이라 페이지가 그려지기 전에도 색이 튀지 않는다. */
function solidWindow(): string {
  return nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff'
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
    title: 'Monitor',
    ...blur(),
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  // Why: a menu shows over full-screen apps and on every Space, so the panel does too.
  panel.setAlwaysOnTop(true, 'pop-up-menu')
  panel.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })
  load(panel, 'panel')
  return panel
}

/** Puts the panel just under the tray icon (above it on Windows), kept inside the screen the icon is on. */
export function placeUnderTray(panel: BrowserWindow, tray: Tray | null): void {
  const [width, height] = panel.getSize()
  const icon = tray && !tray.isDestroyed() ? tray.getBounds() : null
  // Why: Linux trays do not report where the icon is, so the panel goes to the top-right corner there.
  const anchor = icon && icon.width > 0 ? icon : null
  const display = anchor
    ? screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
    : screen.getPrimaryDisplay()
  const area = display.workArea
  let x: number
  let y: number
  if (anchor) {
    x = Math.round(anchor.x + anchor.width / 2 - width / 2)
    y = process.platform === 'win32' ? anchor.y - height - GAP : anchor.y + anchor.height + GAP
  } else {
    x = area.x + area.width - width - GAP
    y = area.y + GAP
  }
  x = Math.min(Math.max(x, area.x + GAP), area.x + area.width - width - GAP)
  y = Math.min(Math.max(y, area.y), area.y + area.height - height)
  panel.setPosition(x, y, false)
}

let settings: BrowserWindow | null = null
// Why: the Computers tab needs room for its cards and the chosen computer's two columns, so wider than Split's 656.
const SETTINGS_WIDTH = 760
const SETTINGS_HEIGHT = 720

/** Debug runs only: a page in a window that is never shown, at the panel's width or the Settings window's size,
 *  in one language (`?lang=`), for the homepage screenshots (MONITOR_SHOTS) and the capture runs (MONITOR_CAPTURE).
 *  `computers` is the Computers tab on its own page. */
export function hiddenPage(
  page: 'panel' | 'computers' | 'settings',
  query: string,
  height?: number
): BrowserWindow {
  const window = new BrowserWindow({
    width: page === 'panel' ? PANEL_WIDTH : SETTINGS_WIDTH,
    // Why: taller than the real window, so no language's last box is cut; the picture is trimmed afterwards.
    height: height ?? (page === 'panel' ? 360 : SETTINGS_HEIGHT + 400),
    useContentSize: true,
    show: false,
    frame: page === 'computers',
    backgroundColor:
      page === 'panel' ? (nativeTheme.shouldUseDarkColors ? '#2a2a2a' : '#ececec') : solidWindow(),
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  const url = process.env.ELECTRON_RENDERER_URL
  if (url) {
    void window.loadURL(`${url}?${query}#${page}`)
  }
  return window
}

/** Opens Settings on `tab` (the first tab when none is named), or brings the open window forward on it.
 *  `onOpen(true)` while it is open, so the other computers are asked more often only then. */
export function showSettings(tab: SettingsTab | undefined, onOpen: (open: boolean) => void): void {
  if (settings && !settings.isDestroyed()) {
    if (tab) {
      settings.webContents.send('monitor:settingsTab', tab)
    }
    settings.show()
    settings.focus()
    // Why: Monitor has no Dock icon, so without this the window can stay behind the app in front.
    app.focus({ steal: true })
    return
  }
  settings = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    minWidth: 656,
    minHeight: 420,
    show: false,
    maximizable: false,
    fullscreenable: false,
    title: t('settings.title'),
    // Why: like Split's Settings, macOS keeps only the window buttons and the page draws the title centred above the tabs.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 10 } }
      : {}),
    backgroundColor: solidWindow(),
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true }
  })
  settings.setMenu(null)
  settings.on('page-title-updated', (event) => event.preventDefault())
  settings.once('ready-to-show', () => {
    settings?.center()
    settings?.show()
    settings?.focus()
    app.focus({ steal: true })
  })
  onOpen(true)
  settings.on('closed', () => {
    settings = null
    onOpen(false)
  })
  load(settings, 'settings', tab ? `tab=${tab}` : '')
}

export type { UpdateOffer } from './runners/updates'

/** 업데이트를 묻는 작은 창: 제목, 한 줄, 새 소식, 받는 동안 진행 막대, [나중에] [지금 설치].
 *  운영체제 알림창에는 스크롤되는 목록도 진행 막대도 넣을 수 없어 창으로 만든다. 답을 받는 규칙은 kit 부품이 맡는다. */
let openUpdate: BrowserWindow | null = null

const updateWindow = createUpdateWindow({
  create() {
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
      title: 'Monitor',
      backgroundColor: solidWindow(),
      webPreferences: { preload, sandbox: true, contextIsolation: true }
    })
    window.on('page-title-updated', (event) => event.preventDefault())
    load(window, 'update')
    openUpdate = window
    // Why: 찍는 실행은 일하는 사람 화면에 창을 띄우지 않는다(MONITOR_CAPTURE).
    if (!app.isPackaged && process.env.MONITOR_CAPTURE) {
      window.show = () => undefined
      window.showInactive = () => undefined
      window.focus = () => undefined
    }
    return window
  },
  focusApp: () => app.focus({ steal: true }),
  channel: 'monitor:updateOffer'
})

/** 개발 실행에서 찍을 때 쓴다. */
export const updateWindowOpen = () => openUpdate

export const askUpdate = updateWindow.askUpdate
export const updateOffer = updateWindow.offer
export const answerUpdate = updateWindow.answer
