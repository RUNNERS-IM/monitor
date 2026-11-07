// Monitor's main process: a tray app that samples this computer every 3 seconds, shows the reading on the tray and
// in a panel under it, colours the tray icon and notifies once a day when the computer turns slow, and measures cleanable folders
// every 30 minutes.
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  Notification,
  screen,
  shell,
  systemPreferences,
  type Tray
} from 'electron'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as account from './account'
import { currentLocale, t } from './i18n'
import * as login from './login'
import { buildMenu, forgetIcons, type Command, type MenuState } from './menu'
import { native, type Sampler } from './native'
import { askLoop, askNow, demoPeers, peerList, setFast, topApps, type Usage } from './peers'
import * as relay from './relay'
import { tailnet } from './tailnet'
import { releaseNoteLines } from './runners/release-notes'
import { readSettings, writeSettings } from './settings'
import { noteCpu, noteFrontApp, suggestions, type Suggestion } from './suggest'
import { createTray, showReading, type Level } from './tray'
import type { Emptied, QuitReport, SettingsTab } from '../preload/api'
import { diskPercent, type Snapshot } from './types'
import { checkNow, startUpdates } from './updates'
import {
  answerUpdate,
  askUpdate,
  createPanel,
  placeUnderTray,
  showSettings,
  hiddenPage,
  updateWindowOpen,
  TRANSLUCENT,
  updateOffer
} from './windows'

const ISSUES_URL = 'https://github.com/RUNNERS-IM/monitor/issues'
const REFRESH_MS = 3000
// Why: measuring walks every cache folder on the disk; every 30 min it kept a slow Mac's disk busy almost all the time
// (2026-11-04, m3-pro-1: the measuring thread in lstat for whole samples). Six hours is enough for numbers that change slowly.
const CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000
/** Why: a nearly full disk is when the numbers matter, so they are kept fresher then. */
const CLEANUP_FULL_DISK_MS = 30 * 60 * 1000
const CLEANUP_FULL_DISK_PERCENT = 85
/** Opening the cleanup row measures again when the shown numbers are older than this. */
const CLEANUP_STALE_SECS = 30 * 60
/** Why: on a Mac that is always short of memory, measuring is put off only this long, so the numbers never go missing. */
const CLEANUP_MAX_PUT_OFF_SECS = 24 * 60 * 60
const CLEANUP_RECHECK_MS = 60 * 1000
const CLEANUP_FILE = 'cleanup.json'
const CLEANUP_PROGRESS_FILE = 'cleanup-progress.json'
// Why: memory pressure flips to warning and back within seconds on a busy Mac, so a slow reading still counts until
// it has been gone this long; otherwise the icon would flicker and a notice could never see a full minute.
const SLOW_HOLD_MS = 60 * 1000
// Why: a notice is for a computer that has stayed slow, not a short spike. The native CPU flag already means a full minute.
const SLOW_NOTICE_AFTER_MS = 60 * 1000
const NOTICE_APPS = 2
// Why: the tray click that opens the panel can also send it a focus-lost event right away, so blur is ignored this long after opening.
const BLUR_GRACE_MS = 400
// Why: clicking the tray while the panel is open first takes focus from the panel (which hides it); a click that
// lands this soon after is the same click and must not open it again.
const REOPEN_GUARD_MS = 300

/** Debug runs only: everything below that reads MONITOR_* is ignored in a packaged app. */
const DEV = !app.isPackaged
const DEMO = DEV && !!process.env.MONITOR_DEMO
const DEMO_OS = 'macOS 26.5 Tahoe'
const DEMO_VERSION = '2.6.1102'
// Why: a debug run keeps its own data folder, so it runs next to the installed Monitor (which holds the
// single-instance lock on the shared folder) and never signs it in or out.
if (DEV) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}
// Why: the windows read their language from navigator.language, which follows Chromium's --lang switch.
if (DEV && process.env.MONITOR_LANG) {
  app.commandLine.appendSwitch('lang', process.env.MONITOR_LANG)
}

type Reason = 'memory' | 'cpu'
/** What the panel gets: the reading plus what only the app knows. */
type PanelSnapshot = Snapshot & { suggestions: Suggestion[]; level: Level }

let tray: Tray | null = null
let panel: BrowserWindow | null = null
let sampler: Sampler | null = null
/** The newest reading. Why: one loop samples for both the tray and the panel, so opening the panel does not take
 *  extra readings that would cut CPU averages short and double the history. */
let latest: Snapshot | null = null
/** The slow reasons and icon level as held for a minute (trackSlow). Why: the icon held them while the panel badge,
 *  the Linux tray menu and the phone read the moment's value, so the four disagreed on a Mac near the line. */
let heldNow: { held: Reason[]; level: Level } = { held: [], level: 'fine' }

/** This computer's Tailscale name (m2-pro-1), learned in the background; null without Tailscale. */
let tailnetName: string | null = null

/** The reading with its slow flags replaced by the held ones, plus the level, for everything that shows them; and the
 *  Tailscale name as the host, the name the Computers tab and the phones use (the system name otherwise). */
function held(snap: Snapshot): Snapshot & { level: Level } {
  if (DEMO) {
    return { ...snap, level: snap.slowMemory || snap.slowCpu ? 'warn' : 'fine' }
  }
  return {
    ...snap,
    host: tailnetName ?? snap.host,
    slowMemory: heldNow.held.includes('memory'),
    slowCpu: heldNow.held.includes('cpu'),
    level: heldNow.level
  }
}
/** Debug runs only: the same reading with made-up names, shown in the panel for public screenshots. */
let latestDemo: Snapshot | null = null
type CleanupResult = {
  total: number
  kinds?: { kind: string; bytes: number }[]
  measuredAt: number
}
let latestCleanup: CleanupResult | null = null
/** Ends the cleanup loop's wait early, so a measurement right after emptying shows what is left. */
let measureNow: (() => void) | null = null
/** Set by measureNow: measure at the next chance instead of waiting for the six hours. */
let measureWanted = false
let shownAt = 0
let hiddenByBlurAt = 0
/** Runners paused from the panel, by name, with the Unix time they come back.
 *  Why: a paused runner has no process, so without this it would simply vanish from the list. */
const paused = new Map<string, number>(Object.entries(readSettings().pausedRunners ?? {}))

/** Keeps `paused` in settings, dropping pauses whose hour is over. */
function savePaused(): void {
  const now = Date.now() / 1000
  for (const [name, until] of paused) {
    if (until <= now) {
      paused.delete(name)
    }
  }
  if (
    JSON.stringify(readSettings().pausedRunners ?? {}) !==
    JSON.stringify(Object.fromEntries(paused))
  ) {
    writeSettings({ pausedRunners: Object.fromEntries(paused) })
  }
}

async function pauseRunner(name: string): Promise<number> {
  const until = Number(await sampler!.pauseRunner(name))
  paused.set(name, until)
  savePaused()
  return until
}

async function resumeRunner(name: string): Promise<void> {
  await sampler!.resumeRunner(name)
  paused.delete(name)
  savePaused()
}

/** When each reason was last read as slow, and since when it has stayed slow (allowing the short gaps above). */
const slow = {
  lastAt: new Map<Reason, number>(),
  since: new Map<Reason, number>(),
  /** When memory pressure was last critical. */
  criticalAt: 0
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function reasons(snap: Snapshot): [Reason, boolean][] {
  return [
    ['memory', snap.slowMemory],
    ['cpu', snap.slowCpu]
  ]
}

const today = () => new Date().toDateString()

/** Reasons that are slow now, holding each for SLOW_HOLD_MS after its last slow reading. Also returns the icon level. */
function trackSlow(snap: Snapshot): { held: Reason[]; level: Level } {
  const now = Date.now()
  if (snap.memoryPressure === 'critical') {
    slow.criticalAt = now
  }
  const held: Reason[] = []
  for (const [reason, isSlow] of reasons(snap)) {
    if (isSlow) {
      slow.lastAt.set(reason, now)
    }
    if (now - (slow.lastAt.get(reason) ?? -Infinity) < SLOW_HOLD_MS) {
      held.push(reason)
      if (!slow.since.has(reason)) {
        slow.since.set(reason, now)
      }
    } else {
      slow.since.delete(reason)
    }
  }
  const level: Level =
    now - slow.criticalAt < SLOW_HOLD_MS ? 'bad' : held.length > 0 ? 'warn' : 'fine'
  return { held, level }
}

/** Shows a system notification once a day per reason when the computer has stayed slow, naming the apps most likely
 *  behind it. Clicking it opens the panel. Why: the panel no longer opens by itself (it kept reopening on Macs that
 *  hover at the warning level), and the day is saved so a restart does not repeat it. */
function notifyIfSlow(snap: Snapshot, held: Reason[], suggested: Suggestion[]): void {
  const now = Date.now()
  for (const reason of held) {
    // Why: the native side turns CPU slow only after a full minute at 80%, so waiting another minute made the
    // "busy for over a minute" notice come after two.
    const wait = reason === 'cpu' ? 0 : SLOW_NOTICE_AFTER_MS
    if (now - (slow.since.get(reason) ?? now) < wait) {
      continue
    }
    const noticedOn = readSettings().noticedOn
    if (noticedOn[reason] === today()) {
      continue
    }
    writeSettings({ noticedOn: { ...noticedOn, [reason]: today() } })
    const apps =
      reason === 'memory'
        ? snap.topMemory
            .slice(0, NOTICE_APPS)
            .map((a) => `${a.name} ${(a.memory / 1024 ** 3).toFixed(1)} GB`)
        : snap.topCpu.slice(0, NOTICE_APPS).map((a) => `${a.name} ${Math.round(a.cpuPercent)}%`)
    // Why: the first thing worth doing for this reason rides on the notice as a button, so it can be done right there.
    const first = suggested.find((s) => s.action === 'quit' && s.reason === reason)
    const offer = first?.action === 'quit' ? first : null
    const notice = new Notification({
      title: t(`notice.${reason}.title`),
      body: offer
        ? t('notice.suggest', {
            name: offer.name,
            size: `${(offer.bytes / 1024 ** 3).toFixed(1)} GB`
          })
        : t('notice.body', { apps: apps.join(', ') }),
      actions: offer ? [{ type: 'button', text: t('notice.quit', { name: offer.name }) }] : []
    })
    notice.on('click', () => {
      if (!panel?.isVisible()) {
        togglePanel()
      }
    })
    notice.on('action', () => {
      if (offer) {
        void quitApp(offer.name).catch((error) => console.error('quit:', error))
      }
    })
    notice.show()
    // Why: the phone app gets the same notice, named after this computer, even when nobody is at it.
    void computerName().then((name) =>
      relay.sendAlert(`${name} · ${t(`notice.${reason}.title`)}`, notice.body)
    )
  }
}

/** Shows the panel without taking focus, under the tray. Debug runs only, so a screenshot can be taken without a click. */
function showWithoutFocus(): void {
  if (!panel) {
    return
  }
  panel.setFocusable(false)
  placeUnderTray(panel, tray)
  panel.showInactive()
}

function hidePanel(): void {
  panel?.hide()
  panel?.setFocusable(true)
}

function togglePanel(): void {
  if (!panel) {
    return
  }
  if (panel.isVisible()) {
    hidePanel()
    return
  }
  if (Date.now() - hiddenByBlurAt < REOPEN_GUARD_MS) {
    return
  }
  panel.setFocusable(true)
  placeUnderTray(panel, tray)
  shownAt = Date.now()
  // Why: the panel opens with every row folded (shared decision 2026-11-02 "[MONITOR] 패널 나누기" 1A), so it never
  // reaches the bottom of the screen on its own; the page keeps its state between opens, so it is told to fold.
  panel.webContents.send('monitor:shown')
  panel.show()
  panel.focus()
  if (process.platform === 'darwin') {
    app.focus({ steal: true })
  }
}

function menuState(): MenuState {
  const settings = readSettings()
  return {
    openAtLogin: login.isOn(),
    autoUpdate: settings.autoUpdate,
    trayIcon: settings.showTrayIcon !== false,
    canHideIcon: process.platform === 'darwin'
  }
}

function openSettings(tab?: SettingsTab): void {
  hidePanel()
  showSettings(tab, setFast)
}

function run(command: Command): void {
  switch (command) {
    case 'usage':
      togglePanel()
      break
    case 'login':
      login.toggle()
      break
    case 'autoUpdate':
      writeSettings({ autoUpdate: !readSettings().autoUpdate })
      break
    case 'trayIcon':
      writeSettings({ showTrayIcon: readSettings().showTrayIcon === false })
      updateTray()
      break
    case 'settings':
      openSettings()
      break
    case 'updates':
      hidePanel()
      checkNow()
      break
    case 'help':
      hidePanel()
      void shell.openExternal(ISSUES_URL)
      break
    case 'quit':
      app.quit()
      break
  }
  refreshLinuxMenu()
}

/** Linux trays only open a menu set beforehand (no click events), so it is rebuilt when its lines change. */
let linuxMenuText = ''
function refreshLinuxMenu(): void {
  if (process.platform !== 'linux' || !tray) {
    return
  }
  const menu = buildMenu(latest && held(latest), run)
  const text =
    menu.items.map((item) => item.label).join('\n') +
    JSON.stringify(menuState()) +
    nativeTheme.shouldUseDarkColors
  if (text === linuxMenuText) {
    return
  }
  linuxMenuText = text
  tray.setContextMenu(menu)
}

/** The reading the panel gets: the newest one plus what only the app knows (paused runners). */
function panelSnapshot(): PanelSnapshot | null {
  const base = DEMO ? latestDemo : latest
  if (!base) {
    return null
  }
  const snap: PanelSnapshot = {
    ...held(base),
    runners: base.runners.map((r) => ({ ...r })),
    suggestions: suggestions(
      base,
      DEMO ? JSON.parse(native.demoCleanup() ?? 'null') : latestCleanup,
      DEMO
    ),
    // Why: an older native module's demo reading keeps the real system name; screenshots show the made-up one.
    ...(DEMO ? { os: DEMO_OS } : {})
  }
  for (const [name, until] of paused) {
    const runner = snap.runners.find((r) => r.name === name)
    if (runner) {
      runner.pausedUntil = until
    } else {
      snap.runners.push({ name, busy: false, pausedUntil: until })
    }
  }
  snap.runners.sort((a, b) => a.name.localeCompare(b.name))
  return snap
}

async function sampleLoop(): Promise<void> {
  for (;;) {
    const started = Date.now()
    try {
      const snap = JSON.parse(await sampler!.sample()) as Snapshot
      heldNow = trackSlow(snap)
      void tailnet()
        .then((net) => (tailnetName = net?.self.name ?? null))
        .catch(() => undefined)
      const { held: slowNow, level } = heldNow
      noteFrontApp()
      noteCpu(snap)
      // Why: the phones and the other computers read `paused` too, not only the panel when it opens.
      if ([...paused.values()].some((until) => until <= Date.now() / 1000)) {
        savePaused()
      }
      notifyIfSlow(snap, slowNow, suggestions(snap, latestCleanup))
      latest = snap
      if (DEMO) {
        const demo = sampler!.demoSnapshot(currentLocale() === 'ko')
        latestDemo = demo ? (JSON.parse(demo) as Snapshot) : null
      }
      // Why: in a demo run the menu-bar icon shows the made-up numbers too, so it matches the panel in a screenshot.
      if (tray) {
        showReading(tray, latestDemo ?? snap, latestDemo ? 'warn' : level)
      }
      refreshLinuxMenu()
    } catch (error) {
      console.error('sample:', error)
    }
    await sleep(Math.max(0, REFRESH_MS - (Date.now() - started)))
  }
}

async function cleanupLoop(): Promise<void> {
  const dir = app.getPath('userData')
  const saved = join(dir, CLEANUP_FILE)
  const progress = join(dir, CLEANUP_PROGRESS_FILE)
  // Why: measuring takes minutes, so a restart shows the saved numbers; the Tauri build's file counts too.
  const found =
    native.cleanupLoad(saved) ??
    native.cleanupLoad(join(app.getPath('appData'), 'im.runners.monitor', CLEANUP_FILE))
  if (found) {
    latestCleanup = JSON.parse(found) as CleanupResult
  }
  for (;;) {
    await waitForMeasure()
    measureWanted = false
    try {
      const json = await native.cleanupMeasure(progress)
      native.cleanupSave(saved, json)
      latestCleanup = JSON.parse(json)
    } catch (error) {
      console.error('cleanup:', error)
    }
  }
}

/** Waits until a measurement is due (six hours, half an hour on a nearly full disk, or asked for) and memory is not
 *  short. Why: measuring reads the whole disk, which a Mac that is already swapping can least afford. */
async function waitForMeasure(): Promise<void> {
  for (;;) {
    const age = latestCleanup ? native.nowSecs() - latestCleanup.measuredAt : Infinity
    const every =
      latest && diskPercent(latest) >= CLEANUP_FULL_DISK_PERCENT
        ? CLEANUP_FULL_DISK_MS
        : CLEANUP_EVERY_MS
    const due = measureWanted || age * 1000 >= every
    const calm = !latest || latest.memoryPressure === 'normal'
    if (due && (calm || age >= CLEANUP_MAX_PUT_OFF_SECS)) {
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CLEANUP_RECHECK_MS)
      measureNow = () => {
        measureWanted = true
        clearTimeout(timer)
        resolve()
      }
    })
  }
}

/** Asks before deleting, since the folders skip the Trash, then deletes one kind and takes it off the shown numbers. */
async function emptyCleanup(kind: string): Promise<Emptied | null> {
  const part = latestCleanup?.kinds?.find((item) => item.kind === kind)
  if (!latestCleanup || !part || DEMO) {
    return null
  }
  const size = `${(part.bytes / 1024 ** 3).toFixed(1)} GB`
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: t(`empty.confirm.${kind}`, { size }),
    detail: t(`empty.detail.${kind}`),
    buttons: [t('empty.button'), t('empty.cancel')],
    defaultId: 1,
    cancelId: 1
  })
  if (response !== 0) {
    return null
  }
  return emptyKind(kind)
}

/** Deletes one kind and takes it off the shown numbers. The phone app comes straight here: it asks on the phone. */
async function emptyKind(kind: string): Promise<Emptied> {
  if (!latestCleanup?.kinds?.some((item) => item.kind === kind)) {
    throw new Error('nothing to empty')
  }
  const done = JSON.parse(await native.cleanupEmpty(kind)) as Emptied
  // Why: the next measurement takes minutes, so the freed bytes come off the shown numbers right away.
  latestCleanup = latestCleanup && {
    ...latestCleanup,
    total: Math.max(0, latestCleanup.total - done.freed),
    kinds: latestCleanup.kinds?.map((item) =>
      item.kind === kind ? { ...item, bytes: Math.max(0, item.bytes - done.freed) } : item
    )
  }
  measureNow?.()
  return done
}

function accentColor(): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return null
  }
  const color = systemPreferences.getAccentColor()
  return color ? `#${color.slice(0, 6)}` : null
}

/** What this computer tells the account's other Monitors: names and numbers only. */
function usage(from: Snapshot | null = latest): Usage | null {
  if (!from) {
    return null
  }
  const snap = held(from) as Snapshot & { level: Level; os?: string; claudeSessions?: unknown[] }
  const running = snap.runners.filter((r) => !paused.has(r.name) && !r.off)
  return {
    host: snap.host,
    os: DEMO ? DEMO_OS : (snap.os ?? ''),
    version: DEMO ? DEMO_VERSION : app.getVersion(),
    cpuPercent: snap.cpuPercent,
    memoryUsed: snap.memoryUsed,
    memoryTotal: snap.memoryTotal,
    memoryPressure: snap.memoryPressure,
    diskUsed: snap.diskUsed,
    diskTotal: snap.diskTotal,
    slowMemory: snap.slowMemory,
    slowCpu: snap.slowCpu,
    level: snap.level,
    topMemory: topApps(snap.topMemory),
    claudeSessions: snap.claudeSessions?.length ?? 0,
    runnersBusy: running.filter((r) => r.busy).length,
    runnersIdle: running.filter((r) => !r.busy).length,
    cleanable: latestCleanup?.total ?? null
  }
}

/** The name the other computers and the phones show: the Tailscale name (m1-pro-2) when there is one. */
async function computerName(): Promise<string> {
  const net = await tailnet().catch(() => null)
  return net?.self.name ?? latest?.host ?? ''
}

/** What the phone app shows for this computer: the same numbers as the Computers tab, plus what can be
 *  emptied by kind and the runners by name, so the phone can offer those commands. */
function phoneState(): unknown {
  const mine = usage()
  if (!mine || !latest) {
    return null
  }
  return {
    ...mine,
    // Why: the phone offers Quit only where this panel does, and says whether the app asks to save first.
    topMemory: mine.topMemory.map((a, i) => ({ ...a, quit: latest!.topMemory[i]?.quit ?? null })),
    topCpu: latest.topCpu
      .slice(0, 5)
      .map((a) => ({ name: a.name, cpuPercent: a.cpuPercent, quit: a.quit })),
    // Why: the Computers tab of another computer offers commands only to a Monitor that takes them (4A).
    hostCommands: true,
    // Why: another computer shows what this panel would suggest; the folder is left out, since no path leaves the computer.
    suggestions: suggestions(latest, latestCleanup).map((s) =>
      s.action === 'quit' ? { ...s, folder: undefined } : s
    ),
    cleanupKinds: latestCleanup?.kinds ?? [],
    runners: latest.runners.map((r) => ({
      name: r.name,
      busy: r.busy,
      off: r.off ?? false,
      pausedUntil: paused.get(r.name) ?? null
    }))
  }
}

/** Quits the app named `name` in the last reading and says whether it ended within a few seconds. */
async function quitApp(name: string): Promise<QuitReport> {
  return JSON.parse(await sampler!.quitApp(name)) as QuitReport
}

/** The commands of the phone app and of the account's other computers (runners-app-kit docs/relay.md, "앱별 명령"). */
const phoneCommands: Record<string, relay.Handler> = {
  'usage.get': async () => phoneState(),
  'app.quit': async (args) => quitApp(String(args.name ?? '')),
  'cleanup.empty': async (args) => emptyKind(String(args.kind ?? '')),
  'runner.pause': async (args) => ({ until: await pauseRunner(String(args.name ?? '')) }),
  'runner.resume': async (args) => {
    await resumeRunner(String(args.name ?? ''))
    return {}
  }
}

const COMPUTER_COMMANDS = new Set(['app.quit', 'cleanup.empty', 'runner.pause', 'runner.resume'])
/** How long the other computer has to say it took a command; the kit then waits on for the result. */
/** 공통 로그인 창이 원인별로 보여 주는 오류 코드(kit runners-account.tsx 의 SignInProblem). */
const SIGN_IN_PROBLEMS = ['bad', 'none', 'format', 'exists', 'code', 'many']
const COMMAND_ANSWER_MS = 20 * 1000

/** Set when Settings is opened to sign in, and taken by its Computers tab once it has loaded. */
let signInWanted = false

function openComputers(signIn = false): void {
  hidePanel()
  if (signIn) {
    signInWanted = true
    // Why: when the window is already open it has loaded and will not ask again, so it is told directly.
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('monitor:signIn')
    }
  }
  openSettings('computers')
}

function registerIpc(): void {
  ipcMain.handle('monitor:snapshot', () => panelSnapshot())
  ipcMain.handle('monitor:cleanup', () =>
    DEMO ? JSON.parse(native.demoCleanup() ?? 'null') : latestCleanup
  )
  // Why: someone opening the cleanup row wants today's numbers, not ones from hours ago.
  ipcMain.handle('monitor:cleanupOpened', () => {
    if (
      DEMO ||
      (latestCleanup && native.nowSecs() - latestCleanup.measuredAt < CLEANUP_STALE_SECS)
    ) {
      return
    }
    measureNow?.()
  })
  ipcMain.handle('monitor:quitApp', (_event, name: string) => quitApp(String(name)))
  ipcMain.handle('monitor:emptyCleanup', (_event, kind: string) => emptyCleanup(String(kind)))
  ipcMain.handle('monitor:pauseRunner', async (_event, name: string) => {
    await pauseRunner(String(name))
  })
  ipcMain.handle('monitor:resumeRunner', (_event, name: string) => resumeRunner(String(name)))
  // Why: demo names follow the page's language (`?lang=` in screenshot runs), not the app's.
  ipcMain.handle('monitor:peers', (event) =>
    DEMO
      ? demoPeers(
          (new URL(event.sender.getURL()).searchParams.get('lang') ?? currentLocale()) === 'ko'
        )
      : peerList()
  )
  // Why: the window's buttons send what a phone sends: to the computer chosen, or to this one's own commands (null).
  ipcMain.handle(
    'monitor:computerCommand',
    async (_event, deviceId: unknown, name: unknown, args: unknown) => {
      const command = String(name)
      if (!COMPUTER_COMMANDS.has(command)) {
        throw new Error('unknown command')
      }
      // Safety: screenshot runs act only on test computers (`fake-…`), never on this one or a real one.
      if (process.env.MONITOR_CAPTURE && !String(deviceId).startsWith('fake-')) {
        throw new Error('capture runs act only on test computers')
      }
      const given = (args ?? {}) as Record<string, unknown>
      const result =
        deviceId === null
          ? await phoneCommands[command](given)
          : await relay.ask(String(deviceId), command, given, COMMAND_ANSWER_MS)
      askNow()
      return result
    }
  )
  // Why: the cards are named as Tailscale names the computers (m1-pro-2), not by the system host name.
  ipcMain.handle('monitor:selfUsage', async () => {
    if (DEMO) {
      return usage(latestDemo)
    }
    const mine = phoneState() as Usage | null
    const net = await tailnet()
    return mine && net ? { ...mine, host: net.self.name } : mine
  })
  ipcMain.handle('monitor:openComputers', (_event, signIn: unknown) =>
    openComputers(signIn === true)
  )
  ipcMain.handle('monitor:translucent', () => TRANSLUCENT)
  ipcMain.handle('monitor:version', () => app.getVersion())
  ipcMain.handle('monitor:accentColor', () => accentColor())
  ipcMain.handle('monitor:menuState', () => menuState())
  ipcMain.handle('monitor:command', (_event, command: Command) => {
    run(command)
    return menuState()
  })
  ipcMain.handle('monitor:openExternal', (_event, url: string) => {
    // Why: only https links are opened, so a page can never launch anything else.
    if (String(url).startsWith('https://')) {
      void shell.openExternal(String(url))
    }
  })
  ipcMain.on('monitor:fitHeight', (event, height: number) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || !Number.isFinite(height) || height <= 0) {
      return
    }
    const [width] = window.getContentSize()
    window.setContentSize(width, Math.ceil(height))
    // Why: on Windows the panel hangs above the taskbar, so a taller panel must move up to stay attached.
    if (window === panel && process.platform === 'win32' && panel.isVisible()) {
      placeUnderTray(panel, tray)
    }
  })
  ipcMain.on('monitor:closeWindow', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle('monitor:updateOffer', () => updateOffer())
  ipcMain.handle('monitor:account', () => ({
    email: account.current(),
    status: relay.currentStatus()
  }))
  // Why: IPC 로 던진 오류는 메시지 앞에 꼬리가 붙어, 로그인 창이 읽는 코드만 답으로 돌려준다.
  const signInProblem = async (work: () => Promise<unknown>) => {
    try {
      await work()
      return null
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      return SIGN_IN_PROBLEMS.includes(code) ? code : 'network'
    }
  }
  ipcMain.handle(
    'monitor:signIn',
    (_event, mode: unknown, email: unknown, password: unknown, code: unknown) =>
      signInProblem(() =>
        account.signIn(
          mode === 'signup' ? 'signup' : 'login',
          String(email),
          String(password),
          typeof code === 'string' && code ? code : undefined
        )
      )
  )
  ipcMain.handle('monitor:sendCode', (_event, purpose: unknown, email: unknown) =>
    signInProblem(() =>
      account.sendCode(purpose === 'reset' ? 'reset' : 'signup', String(email), currentLocale())
    )
  )
  ipcMain.handle(
    'monitor:resetPassword',
    (_event, email: unknown, code: unknown, password: unknown) =>
      signInProblem(() => account.resetPassword(String(email), String(code), String(password)))
  )
  ipcMain.handle('monitor:takeSignIn', () => {
    const wanted = signInWanted
    signInWanted = false
    return wanted
  })
  ipcMain.handle('monitor:signOut', () => account.signOut())
  ipcMain.handle('monitor:reconnect', () => relay.reconnect())
  ipcMain.on('monitor:answerUpdate', (_event, answer: unknown) =>
    answerUpdate(answer === 'install' ? 'install' : 'later')
  )
}

/** Debug runs only: `MONITOR_OPEN=panel|settings[:tab]|update` opens that window at launch, so it can be captured without
 *  clicking the tray (`update` / `update-progress` show the update question with the notes in RELEASE_NOTES.md, downloaded or still
 *  downloading, and install nothing), and
 *  `MONITOR_THEME=dark|light` forces the look, and `MONITOR_SOLID=1` turns the blur off so the desktop does not show through. The panel opens without focus, so it stays up. */
function debugHooks(): void {
  const theme = process.env.MONITOR_THEME
  if (theme === 'dark' || theme === 'light') {
    nativeTheme.themeSource = theme
  }
  // `MONITOR_CAPTURE=<folder>` saves the panel and every Settings tab as PNGs without ever showing them, then quits.
  // Why: screenshots for review must not pop windows up on the screen of the person working at this computer.
  const captureTo = process.env.MONITOR_CAPTURE
  if (captureTo) {
    setTimeout(() => void captureHidden(captureTo), 8000)
  }
  // `MONITOR_DEMO=1 MONITOR_SHOTS=<folder>` saves the homepage pictures for every homepage language in both looks,
  // never showing a window: popup (panel folded, "Worth doing now" on top), sessions (Jobs open) and computers.
  const shotsTo = process.env.MONITOR_SHOTS
  if (shotsTo && DEMO) {
    setTimeout(() => void homepageShots(shotsTo), 8000)
  }
  // `MONITOR_ACCOUNT=<email>:<password>` signs in at launch, so the relay can be tried against relay-dev
  // (monitor-app/scripts/relay-dev.mjs) without typing into a window.
  const signInAs = process.env.MONITOR_ACCOUNT
  if (signInAs && !account.current()) {
    const at = signInAs.indexOf(':')
    void account
      .signIn('login', signInAs.slice(0, at), signInAs.slice(at + 1))
      .catch((error) => console.error('sign in:', error))
  }
  const which = process.env.MONITOR_OPEN
  // Why: the tray icon needs a moment before it reports where it sits.
  // Why: `settings:general` (or another tab) opens Settings on that tab, `settings` on the first one.
  if (which?.startsWith('settings')) {
    setTimeout(() => openSettings((which.split(':')[1] as SettingsTab | undefined) || undefined), 1500)
  }
  if (which === 'panel') {
    setTimeout(showWithoutFocus, 1500)
  }
  if (which === 'update' || which === 'update-progress') {
    const notes = debugNotes()
    // Why: `update-progress` shows the menu check's download state, held at a made-up 42%.
    const downloading = which === 'update-progress'
    setTimeout(() => {
      const prompt = askUpdate(
        { version: '2.6.1030.4', notes, downloading, percent: downloading ? 42 : 100 },
        false
      )
      void prompt.answer.then((answer) => console.log('update answer:', answer))
    }, 1500)
  }
}

/** Why: the window shows the notes the next release will carry, so screenshots match the real thing. */
function debugNotes(): string[] | null {
  return releaseNoteLines(
    readFileSync(join(app.getAppPath(), 'RELEASE_NOTES.md'), 'utf8'),
    currentLocale() === 'ko' ? 'ko' : 'en'
  )
}

const HOMEPAGE_LANGS = [
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'th',
  'vi',
  'zh'
]

async function homepageShots(folder: string): Promise<void> {
  const shots: [string, 'panel' | 'computers', string][] = [
    ['popup', 'panel', ''],
    ['sessions', 'panel', '&expand=work'],
    ['computers', 'computers', '']
  ]
  for (const theme of ['dark', 'light'] as const) {
    nativeTheme.themeSource = theme
    for (const lang of HOMEPAGE_LANGS) {
      // Why: the homepage says "zh" for simplified Chinese.
      const code = lang === 'zh' ? 'zh-Hans' : lang
      for (const [name, page, extra] of shots.filter(
        ([n]) => !process.env.MONITOR_SHOTS_ONLY || n === process.env.MONITOR_SHOTS_ONLY
      )) {
        const window = hiddenPage(page, `lang=${code}${extra}`)
        await sleep(page === 'computers' ? 2500 : 1800)
        const image = await window.webContents.capturePage(undefined, { stayHidden: true })
        writeFileSync(join(folder, `${name}-${lang}-${theme}.png`), image.toPNG())
        window.destroy()
      }
    }
  }
  app.quit()
}

type CaptureStep =
  | { card: string }
  | { act: string }
  | { go: true }
  | { cancel: true }
  | { type: [selector: string, text: string] }
  | { press: string }
  | { wait: number }
  | { shot: string }

/** Presses buttons on a hidden Computers page, one step at a time (see MONITOR_CAPTURE_STEPS). */
async function captureSteps(
  steps: CaptureStep[],
  save: (window: BrowserWindow, name: string) => Promise<void>
): Promise<void> {
  setFast(true)
  await sleep(6000)
  const page = hiddenPage('computers', '', 900)
  await sleep(3500)
  const run = (code: string) => page.webContents.executeJavaScript(code) as Promise<unknown>
  for (const step of steps) {
    if ('card' in step) {
      await run(
        `[...document.querySelectorAll('.c-card')].find(c=>c.querySelector('.c-name').textContent.startsWith(${JSON.stringify(step.card)}))?.click()`
      )
    } else if ('act' in step) {
      console.log(
        'press',
        step.act,
        await run(
          `(()=>{const b=document.querySelector(${JSON.stringify(`.c-detail [data-act="${step.act}"]`)});b?.click();return !!b})()`
        )
      )
    } else if ('go' in step) {
      await run(`document.querySelector('.c-confirm-go')?.click()`)
    } else if ('cancel' in step) {
      await run(`document.querySelector('.c-confirm-cancel')?.click()`)
    } else if ('type' in step) {
      // Why: React reads the value through the input's own setter, so a plain assignment would not reach the form.
      await run(
        `(()=>{const f=document.querySelector(${JSON.stringify(step.type[0])});if(!f)return;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,${JSON.stringify(step.type[1])});f.dispatchEvent(new Event('input',{bubbles:true}))})()`
      )
    } else if ('press' in step) {
      // Why: the sign-in sheet's buttons come first, since the window behind it has its own Sign In button.
      console.log(
        'press',
        step.press,
        await run(
          `(()=>{const b=[...document.querySelectorAll('.ra-sheet button'),...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(step.press)});b?.click();return !!b})()`
        )
      )
    } else if ('wait' in step) {
      await sleep(step.wait)
    } else {
      await save(page, step.shot)
    }
    await sleep(400)
  }
  page.destroy()
}

async function captureHidden(folder: string): Promise<void> {
  const save = async (window: BrowserWindow | null, name: string) => {
    if (!window) {
      return
    }
    const image = await window.webContents.capturePage(undefined, { stayHidden: true })
    writeFileSync(join(folder, `${name}.png`), image.toPNG())
  }
  panel?.webContents.send('monitor:shown')
  await sleep(1500)
  await save(panel, 'panel')
  // Why: the Quit buttons sit inside the CPU and memory rows, so those are captured open as well.
  for (const section of ['cpu', 'memory']) {
    const page = hiddenPage('panel', `expand=${section}`, 1000)
    await sleep(2500)
    await save(page, `panel-${section}`)
    page.destroy()
  }
  // `MONITOR_CAPTURE_MENU=1` pops the tray menu up near the top right for a moment and photographs that part of the
  // screen, since a native menu cannot be captured like a page. It shows on screen for about a second.
  if (process.env.MONITOR_CAPTURE_MENU) {
    const { width } = screen.getPrimaryDisplay().bounds
    const [x, y] = [width - 460, 60]
    const spot = new BrowserWindow({ x, y, width: 1, height: 1, frame: false, transparent: true })
    await sleep(400)
    const menu = buildMenu(latest && held(latest), run)
    menu.popup({ window: spot, x: 0, y: 0 })
    await sleep(700)
    execFileSync('screencapture', ['-x', `-R${x - 10},${y - 10},440,420`, join(folder, 'menu.png')])
    menu.closePopup(spot)
    spot.destroy()
  }
  // `MONITOR_CAPTURE_SIGNIN=1` captures the window with the sign-in sheet up, as the panel's account line opens it.
  if (process.env.MONITOR_CAPTURE_SIGNIN) {
    signInWanted = true
  }
  // `MONITOR_CAPTURE_STEPS=<json>` presses the Computers tab's buttons on a test computer and captures each step.
  const stepsFile = process.env.MONITOR_CAPTURE_STEPS
  if (stepsFile) {
    await captureSteps(JSON.parse(readFileSync(stepsFile, 'utf8')) as CaptureStep[], save)
    app.quit()
    return
  }
  // Why: every Settings tab is captured, since each holds what used to be its own window or panel line.
  for (const tab of ['computers', 'general', 'account', 'about']) {
    const page = hiddenPage('settings', `tab=${tab}`, 720)
    await sleep(tab === 'computers' ? 4000 : 2500)
    await save(page, `settings-${tab}`)
    // Why: turning the menu-bar icon off asks first, and that question is a screen of its own.
    if (tab === 'general') {
      await page.webContents.executeJavaScript(
        `[...document.querySelectorAll('.switch')].at(-1)?.click()`
      )
      await sleep(600)
      await save(page, 'settings-general-hide')
    }
    page.destroy()
  }
  for (const downloading of [false, true]) {
    const prompt = askUpdate(
      { version: '2.6.110701', notes: debugNotes(), downloading, percent: downloading ? 42 : 100 },
      false
    )
    await sleep(2500)
    await save(updateWindowOpen(), downloading ? 'update-progress' : 'update')
    prompt.close()
  }
  app.quit()
}

/** Puts the tray icon up or takes it down, as Settings' "Show in menu bar" says. Left and right click both open the
 *  panel (shared decision 2026-11-07 2A); Linux trays only open a menu set beforehand, so Linux keeps the menu. */
function updateTray(): void {
  // Why: a capture run lasts about a minute and shows nothing, so a second menu-bar icon next to the installed Monitor only confuses.
  const wanted = readSettings().showTrayIcon !== false && !(DEV && process.env.MONITOR_CAPTURE)
  if (!wanted) {
    tray?.destroy()
    tray = null
    linuxMenuText = ''
    return
  }
  if (tray) {
    return
  }
  const icon = createTray()
  tray = icon
  if (latest) {
    showReading(icon, latest, held(latest).level)
  }
  if (process.platform === 'linux') {
    refreshLinuxMenu()
  } else {
    icon.on('click', togglePanel)
    icon.on('right-click', togglePanel)
  }
}

/** Opening Monitor while it runs shows the panel, or Settings when the icon is hidden and the panel has nowhere to sit. */
function openedAgain(): void {
  if (!tray) {
    openSettings()
  } else if (panel && !panel.isVisible()) {
    togglePanel()
  }
}

function start(): void {
  // Why: Monitor lives in the tray only, so it should not take a Dock slot on macOS.
  app.dock?.hide()
  registerIpc()
  login.applyDefault()
  sampler = new native.Sampler()
  panel = createPanel()
  panel.on('hide', () => panel?.webContents.send('monitor:hidden'))
  panel.on('blur', () => {
    if (Date.now() - shownAt < BLUR_GRACE_MS) {
      return
    }
    hiddenByBlurAt = Date.now()
    hidePanel()
  })
  updateTray()
  // Why: with the icon hidden nothing else on screen leads to Monitor, so launching it shows Settings (as Split does).
  if (!tray && !(DEV && process.env.MONITOR_CAPTURE)) {
    openSettings()
  }
  nativeTheme.on('updated', () => {
    forgetIcons()
    refreshLinuxMenu()
  })
  void sampleLoop()
  void cleanupLoop()
  if (!DEMO) {
    void askLoop()
    relay.startRelay({ state: phoneState, name: computerName, commands: phoneCommands })
  }
  // Why: the panel's account line and Settings show whether this computer is on the relay as it
  // changes, and the other computers are asked as soon as it joins rather than up to 30 seconds later.
  relay.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('monitor:account', { email: account.current(), status })
    }
    if (status === 'connected') {
      askNow()
    }
  })
  startUpdates()
  if (DEV) {
    debugHooks()
  }
}

// Why: a second copy would add a second tray icon; opening it again shows the panel of the running one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', openedAgain)
  // Why: macOS sends this, not second-instance, when Monitor is opened again from Finder or Spotlight.
  app.on('activate', openedAgain)
  // Why: closing Settings must not quit a tray app.
  app.on('window-all-closed', () => undefined)
  void app.whenReady().then(start)
}
