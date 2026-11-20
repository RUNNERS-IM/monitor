// Monitor's main process: a tray app that samples this computer every 3 seconds, shows the reading on the tray and
// in a panel under it, colours the tray icon and notifies once a day when the computer turns slow, and measures cleanable folders
// every 30 minutes.
import './error-report-start'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  Notification,
  shell,
  type Tray
} from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as account from './account'
import { currentLocale, setLocale, t } from './i18n'
import { demoAppName } from './demo-names'
import { osSuffix } from '../shared/os-words'
import * as login from './login'
import { buildMenu, forgetIcons, type Command, type MenuState } from './menu'
import { native, type Sampler } from './native'
import { askLoop, askNow, demoPeers, peerList, setFast, topApps, type Usage } from './peers'
import * as relay from './relay'
import { tailnet } from './tailnet'
import { releaseNoteLines } from './runners/release-notes'
import {
  prepareTestShots,
  readTestShots,
  runTestShots,
  type ShotWindow,
  type TestShotPass,
  type TestShotScope
} from './runners/test-shots'
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
  setPageLang,
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
// 시험 촬영 모드(RUNNERS_TEST_SHOTS=<폴더>, kit runners/test-shots.ts). 개발 실행에서만 켠다.
const testShots = DEV ? readTestShots() : null
prepareTestShots(testShots, app.commandLine)
// Why: 시험 촬영은 늘 데모 숫자 · 데모 컴퓨터로 찍는다. 이 맥의 실제 이름이 사진에 남지 않고, 찍을 때마다 같은 화면이 나와 지난 사진과 견줄 수 있다.
const DEMO = DEV && (!!process.env.MONITOR_DEMO || !!testShots)
const DEMO_OS = 'macOS 26.5 Tahoe'
// Why: 시험 실행은 `MONITOR_TEST_PLATFORM=win32|linux` 로 Mac 에서도 다른 운영체제의 글을 띄워 본다. 글만 바꾸고 동작은 그대로다.
const WORDS_PLATFORM = (DEV && process.env.MONITOR_TEST_PLATFORM) || process.platform
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

/** 데모 숫자의 다른 회사 앱 이름(Google Chrome 등)을 앱 언어의 일반 이름으로 바꾼다(demo-names.ts). */
function withDemoNames(snap: Snapshot): Snapshot {
  const rename = (apps: Snapshot['topMemory']) =>
    apps.map((app) => ({ ...app, name: demoAppName(app.name, currentLocale()) }))
  return { ...snap, topMemory: rename(snap.topMemory), topCpu: rename(snap.topCpu) }
}
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
        : t(`notice.body${osSuffix(WORDS_PLATFORM)}`, { apps: apps.join(', ') }),
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
        latestDemo = demo ? withDemoNames(JSON.parse(demo) as Snapshot) : null
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
  ipcMain.handle('monitor:quitApp', (_event, name: string) => {
    return quitApp(String(name))
  })
  ipcMain.handle('monitor:emptyCleanup', (_event, kind: string) => {
    return emptyCleanup(String(kind))
  })
  ipcMain.handle('monitor:pauseRunner', async (_event, name: string) => {
    await pauseRunner(String(name))
  })
  ipcMain.handle('monitor:resumeRunner', (_event, name: string) => {
    return resumeRunner(String(name))
  })
  // Why: demo names follow the page's language (`?lang=` in screenshot runs), not the app's.
  ipcMain.handle('monitor:peers', (event) =>
    DEMO
      ? demoPeers(new URL(event.sender.getURL()).searchParams.get('lang') ?? currentLocale())
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
      if (testShots && !String(deviceId).startsWith('fake-')) {
        throw new Error('test shot runs act only on test computers')
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
  ipcMain.handle('monitor:account', () =>
    // Why: 스토어 사진처럼 로그인한 모습이 필요한 시험 촬영은 진짜 계정 없이 예시 주소로 로그인된 것처럼 그린다.
    testShots?.account === 'signed-in'
      ? { email: 'name@example.com', status: 'connected' }
      : { email: account.current(), status: relay.currentStatus() }
  )
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
    setTimeout(
      () => openSettings((which.split(':')[1] as SettingsTab | undefined) || undefined),
      1500
    )
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

/** 시험 촬영에서 고르지 않은 범위의 화면에 넘기는 자리. 찍지 않으므로 창을 열지 않는다. */
const UNOPENED: ShotWindow = {
  webContents: { capturePage: () => Promise.reject(new Error('unopened')) }
}

/** 시험 촬영 모드가 언어 · 테마마다 찍는 화면. 창은 보이지 않게 열어 찍고 닫는다.
 *  Why: 번호는 이 차례로 붙으므로, 새 화면은 끝에 붙여야 지난 사진과 같은 번호로 견줄 수 있다. */
async function testScenes(pass: TestShotPass): Promise<void> {
  const click = (window: BrowserWindow, code: string) =>
    window.webContents.executeJavaScript(
      `(()=>{const b=${code};b?.click();return !!b})()`
    ) as Promise<boolean>
  const take = async (
    scope: TestShotScope,
    screen: string,
    open: () => BrowserWindow | null,
    settle: number,
    before?: (window: BrowserWindow) => Promise<void>
  ) => {
    if (!pass.wants(scope)) {
      await pass.shot(UNOPENED, scope, screen)
      return
    }
    const window = open()
    if (!window) {
      pass.note(`${screen}: 창이 열리지 않음`)
      // Why: 번호는 그대로 하나 차지해, 뒤 화면 번호가 밀리지 않는다.
      await pass.shot(UNOPENED, scope, screen).catch(() => null)
      return
    }
    await pass.wait(settle)
    await before?.(window)
    await pass.shot(window, scope, screen)
    if (!window.isDestroyed()) {
      window.destroy()
    }
  }
  // 메뉴 막대 창: 접힌 모양과, 끄기 단추가 든 CPU · 메모리 줄, 작업 줄을 연 모양.
  for (const [screen, icon] of [
    ['패널', ''],
    ['패널-CPU', 'lucide-cpu'],
    ['패널-메모리', 'lucide-memory-stick'],
    ['패널-작업', 'lucide-square-terminal']
  ]) {
    await take(
      'menu',
      screen,
      () => hiddenPage('panel', '', 1000),
      2500,
      async (window) => {
        // Why: 줄은 사람이 누르듯 눌러 연다. 창이 보이지 않아 열 때마다 접는 신호가 오지 않으므로 그대로 열려 있다.
        if (
          icon &&
          !(await click(window, `document.querySelector('.summary-row:has(.${icon})')`))
        ) {
          pass.note(`${screen}: 줄이 없음`)
        }
        await pass.wait(900)
      }
    )
  }
  // 모든 컴퓨터 창. Why: 데모는 로그인 전이라 앱 끄기 단추가 없어, 끄기를 묻는 칸은 찍지 않는다.
  await take('main', '모든-컴퓨터', () => hiddenPage('settings', 'tab=computers', 720), 4000)
  // 설정 창 탭. 메뉴 막대 아이콘을 끄면 먼저 묻는 칸도 한 화면이다.
  await take('settings', '일반', () => hiddenPage('settings', 'tab=general', 720), 2500)
  await take(
    'settings',
    '일반-아이콘-끄기-확인',
    () => hiddenPage('settings', 'tab=general', 720),
    2500,
    async (window) => {
      await click(window, `[...document.querySelectorAll('.switch')].at(-1)`)
      await pass.wait(900)
    }
  )
  await take('settings', '계정', () => hiddenPage('settings', 'tab=account', 720), 2500)
  await take('settings', '정보', () => hiddenPage('settings', 'tab=about', 720), 2500)
  // 업데이트를 묻는 창: 다 받은 뒤와 받는 중. 다음 판의 RELEASE_NOTES.md 를 보여 주고 아무것도 설치하지 않는다.
  for (const downloading of [false, true]) {
    let prompt = null as ReturnType<typeof askUpdate> | null
    await take(
      'popups',
      downloading ? '업데이트-받는-중' : '업데이트',
      () => {
        prompt = askUpdate(
          {
            version: '2.6.110701',
            notes: debugNotes(),
            downloading,
            percent: downloading ? 42 : 100
          },
          false
        )
        return updateWindowOpen()
      },
      2500
    )
    prompt?.close()
  }
  // 저절로 깔린 뒤 처음 열 때 한 번 뜨는 알림: 닫힌 채와 「바뀐 점 보기」를 누른 뒤.
  for (const opened of [false, true]) {
    let prompt = null as ReturnType<typeof askUpdate> | null
    await take(
      'popups',
      opened ? '업데이트-완료-바뀐-점' : '업데이트-완료',
      () => {
        prompt = askUpdate(
          {
            version: '2.6.110701',
            notes: debugNotes(),
            downloading: false,
            percent: 100,
            installed: true
          },
          false
        )
        return updateWindowOpen()
      },
      2500,
      opened
        ? async (window) => {
            await click(
              window,
              `document.querySelector('.update-buttons .rw-button:not(.default)')`
            )
            await pass.wait(900)
          }
        : undefined
    )
    prompt?.close()
  }
  // 로그인 시트: 메뉴 막대 창의 계정 줄을 눌렀을 때처럼 모든 컴퓨터 창 위에 뜬다.
  if (pass.account === 'signed-in') {
    pass.note('로그인한 상태는 예시 주소(name@example.com)로 그린다. 로그인 시트도 그 위에 뜬다')
  }
  await take(
    'account',
    '로그인',
    () => {
      signInWanted = true
      return hiddenPage('settings', 'tab=computers', 720)
    },
    4000
  )
}

/** Puts the tray icon up or takes it down, as Settings' "Show in menu bar" says. Left and right click both open the
 *  panel (shared decision 2026-11-07 2A); Linux trays only open a menu set beforehand, so Linux keeps the menu. */
function updateTray(): void {
  // Why: a test shot run lasts a few minutes and shows nothing, so a second menu-bar icon next to the installed Monitor only confuses.
  const wanted = readSettings().showTrayIcon !== false && !testShots
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
  if (!tray && !testShots) {
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
  if (testShots) {
    // Why: 첫 측정 · 데모 숫자가 나온 뒤에 찍는다. 그 전에는 패널이 빈 칸이다.
    setTimeout(
      () =>
        void runTestShots({
          config: testShots,
          app,
          nativeTheme,
          async setLanguage(lang) {
            setLocale(lang)
            setPageLang(lang)
            // Why: 데모 숫자의 이름(앱 · 폴더)은 다음 측정부터 새 언어로 나온다.
            await sleep(REFRESH_MS + 500)
          },
          scenes: testScenes
        }),
      8000
    )
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
  // Why: quitting waits for the folder scan's thread, which held the quit for minutes in the middle of a big folder.
  app.on('will-quit', () => native.cleanupStop())
  void app.whenReady().then(start)
}
