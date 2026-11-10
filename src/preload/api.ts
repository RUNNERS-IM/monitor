// What the preload script gives the page as `window.monitor`.

/** What a sign-in call answers: null when it worked, otherwise the sign-in sheet's problem code. */
export type SignInAnswer = 'bad' | 'none' | 'format' | 'exists' | 'code' | 'many' | 'network' | null

export type MenuCommand =
  | 'usage'
  | 'login'
  | 'autoUpdate'
  | 'trayIcon'
  | 'settings'
  | 'updates'
  | 'help'
  | 'quit'

/** The Settings window's tabs, in their order: the most used screen first (shared decision 2026-11-07, Monitor 1A). */
export type SettingsTab = 'computers' | 'releases' | 'general' | 'account' | 'about'

/** 그 앱의 마지막 출시 빌드. 기록이 없으면 null. */
export type ReleaseBuild = {
  result: 'success' | 'failure' | 'cancelled' | 'running'
  at: number
} | null

export type ReleaseApp = {
  name: string
  /** 최신 판. 아직 출시하지 않았으면 null. */
  latest: string | null
  /** false 면 GitHub 에 닿지 못해 최신 판을 모른다. */
  checked: boolean
  /** 직원 계정에만 있다. */
  build?: ReleaseBuild
}

export type ReleaseStatus = {
  apps: ReleaseApp[]
  /** 맨 앞이 이 컴퓨터다. versions 가 null 이면 그 컴퓨터의 깔린 판을 모른다. */
  computers: { name: string; self: boolean; versions: Record<string, string | null> | null }[]
}

/** The RUNNERS account this computer is signed in with, and whether it is on the relay (for the account's other
 *  computers and the phone app). */
export type AccountState = {
  email: string | null
  status: 'signedOut' | 'connecting' | 'connected' | 'elsewhere'
}

/** `canHideIcon`: only macOS offers to hide the menu-bar icon, since its hint and question speak of the Mac. */
export type MenuState = {
  openAtLogin: boolean
  autoUpdate: boolean
  trayIcon: boolean
  canHideIcon: boolean
}

export type CleanupKind =
  | 'cache'
  | 'packages'
  | 'build'
  | 'trash'
  | 'docker'
  | 'simulators'
  | 'wallpapers'
  | 'vms'
  | 'models'

/** What Quit did (native/src/actions.rs QuitReport): whether it ended within a few seconds, how many of its
 *  processes had already ended, and the ones that could not be asked. */
export type QuitReport = { gone: boolean; alreadyGone: number; failed: string[] }

/** What emptying did: bytes freed, and the parts it kept (how many, their size, and why). */
export type Emptied = {
  freed: number
  skipped: number
  kept: number
  keptReason: 'recent' | 'inUse' | null
}

/** The update window's content: new version as people see it, the "What's new" lines (null hides the box) and the
 *  download's progress (0–100) while it runs. */
export type UpdateOffer = {
  version: string
  notes: string[] | null
  downloading: boolean
  percent: number
}

/** Another computer on the tailnet (src/main/peers.ts). */
export type PeerUsage = {
  host: string
  os: string
  version: string
  cpuPercent: number
  memoryUsed: number
  memoryTotal: number
  memoryPressure: 'normal' | 'warn' | 'critical'
  diskUsed: number
  diskTotal: number
  slowMemory: boolean
  slowCpu: boolean
  topMemory: { name: string; memory: number; quit?: 'app' | 'process' | null }[]
  claudeSessions: number
  runnersBusy: number
  runnersIdle: number
  cleanable: number | null
  /** Set by a Monitor that takes commands from other computers; an older one only answers the numbers. */
  hostCommands?: boolean
  cleanupKinds?: { kind: CleanupKind; bytes: number }[]
  runners?: { name: string; busy: boolean; off: boolean; pausedUntil: number | null }[]
  suggestions?: PeerSuggestion[]
}
/** What a computer's own panel suggests, as it tells the others (no folder paths). */
export type PeerSuggestion =
  | {
      action: 'quit'
      reason: 'memory' | 'cpu'
      name: string
      quit: 'app' | 'process'
      devServer: boolean
      runningSecs: number | null
      bytes: number
      cpuPercent: number
    }
  | { action: 'empty'; reason: 'disk'; kind: CleanupKind; bytes: number }
export type Peer = {
  /** Where commands for this computer go. */
  deviceId: string
  name: string
  state: 'ok' | 'noAnswer' | 'offline'
  usage: PeerUsage | null
  at: number | null
}

export type MonitorApi = {
  /** The newest reading (JSON shape in src/renderer/types.ts), or null before the first one. */
  snapshot: () => Promise<unknown>
  /** The last cleanup measurement, or null while the first one runs. */
  cleanup: () => Promise<unknown>
  /** The cleanup row was opened: measures again if the numbers are more than half an hour old. */
  cleanupOpened: () => Promise<void>
  /** Asks an app from the last reading to quit like ⌘Q; rejects with the reason when it cannot. */
  quitApp: (name: string) => Promise<QuitReport>
  /** Asks first, then deletes the cleanable folders of one kind; null when the person said no. */
  emptyCleanup: (kind: CleanupKind) => Promise<Emptied | null>
  /** Pauses a GitHub runner for an hour (macOS); rejects with the reason when it cannot. */
  pauseRunner: (name: string) => Promise<void>
  /** Starts a paused runner now instead of at the end of its hour. */
  resumeRunner: (name: string) => Promise<void>
  /** The other computers on the tailnet, slow ones first; empty when Tailscale is off. */
  peers: () => Promise<Peer[]>
  releases: () => Promise<ReleaseStatus>
  /** This computer in the same shape, for the first card of the Computers tab. */
  selfUsage: () => Promise<PeerUsage | null>
  /** Sends a command to another computer (`deviceId`) or to this one (null) and resolves to its answer. */
  computerCommand: (
    deviceId: string | null,
    name: string,
    args: Record<string, unknown>
  ) => Promise<unknown>
  /** Opens Settings on the Computers tab (and closes the panel); `signIn` opens it with the sign-in sheet up. */
  openComputers: (signIn?: boolean) => Promise<void>
  /** Calls back when the open Settings window is asked to show another tab. */
  onSettingsTab: (listener: (tab: SettingsTab) => void) => () => void
  /** Calls back each time the panel is about to show; returns a function that stops it. */
  onShown: (listener: () => void) => () => void
  /** The panel was hidden; it stops asking for readings until it is shown again. */
  onHidden: (listener: () => void) => () => void
  /** Whether the OS blurs what is behind the window; the page draws a solid background when it does not. */
  translucent: () => Promise<boolean>
  /** Sets the window's content height so it fits the page. */
  fitHeight: (height: number) => void
  /** App version as people see it (2.6.1030.2). */
  version: () => Promise<string>
  /** Opens an https link in the default browser. */
  openExternal: (url: string) => Promise<void>
  menuState: () => Promise<MenuState>
  /** Runs a menu line; resolves to the menu state after it. */
  command: (command: MenuCommand) => Promise<MenuState>
  closeWindow: () => void
  /** What the update window shows, or null when no update is being offered. */
  updateOffer: () => Promise<UpdateOffer | null>
  /** Calls back with the new offer whenever the download moves on; returns a function that stops it. */
  onUpdateOffer: (listener: (offer: UpdateOffer) => void) => () => void
  /** The update window's answer; Later closes the window, Install Now keeps it up until the app quits. */
  answerUpdate: (answer: 'install' | 'later') => void
  account: () => Promise<AccountState>
  /** Calls back when the sign-in or the relay connection changes; returns a function that stops it. */
  onAccount: (listener: (state: AccountState) => void) => () => void
  /** Signs in or makes the account (`code` is the number mailed for a new account). Null when signed in, otherwise
   *  the sign-in sheet's problem code: "bad" wrong password, "none" no account with that email, "format" a password
   *  that is not 6-20 letters and digits, "exists" the email already has an account, "code" a wrong mailed number,
   *  "many" too many tries, "network" when the server could not be reached. */
  signIn: (
    mode: 'login' | 'signup',
    email: string,
    password: string,
    code?: string
  ) => Promise<SignInAnswer>
  /** Mails a six-digit number: "signup" to make the account, "reset" to choose a new password. */
  sendCode: (purpose: 'signup' | 'reset', email: string) => Promise<SignInAnswer>
  /** Sets a new password with the mailed number and signs in with it. */
  resetPassword: (email: string, code: string, password: string) => Promise<SignInAnswer>
  /** True once when Settings was opened to sign in (the panel's account line while signed out). */
  takeSignIn: () => Promise<boolean>
  /** Calls back when the open Settings window is asked to show the sign-in sheet. */
  onSignIn: (listener: () => void) => () => void
  /** 사용 통계를 아직 묻지 않았는가(ask)와 동의했는가(granted). */
  signOut: () => Promise<void>
  /** Joins the relay again after another connection with this computer's id took its place. */
  reconnect: () => Promise<void>
}
