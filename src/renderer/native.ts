// The page's way to the app: a thin wrapper over `window.monitor`, which the preload script provides
// (src/preload). Everything the page asks of the main process goes through here.
import type {
  AccountState,
  CleanupKind,
  Emptied,
  MenuCommand,
  MenuState,
  MonitorApi,
  Peer,
  PeerSuggestion,
  PeerUsage,
  QuitReport,
  SettingsTab,
  UpdateOffer
} from '../preload/api'
import type { Cleanup, Snapshot } from './types'

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- 전역 Window 에 더하려면 interface 여야 한다
  interface Window {
    monitor: MonitorApi
  }
}

const api = () => window.monitor

export type {
  AccountState,
  CleanupKind,
  Emptied,
  MenuCommand,
  MenuState,
  Peer,
  PeerSuggestion,
  PeerUsage,
  QuitReport,
  SettingsTab,
  UpdateOffer
}

/** Which window this page is: the tray panel, Settings or the update question. `computers` is the Computers tab on
 *  its own, for the homepage pictures and the capture runs. */
export const page: 'panel' | 'settings' | 'update' | 'computers' =
  location.hash === '#settings'
    ? 'settings'
    : location.hash === '#update'
      ? 'update'
      : location.hash === '#computers'
        ? 'computers'
        : 'panel'

export const snapshot = () => api().snapshot() as Promise<Snapshot | null>
export const cleanup = () => api().cleanup() as Promise<Cleanup | null>
export const cleanupOpened = () => api().cleanupOpened()
export const quitApp = (name: string) => api().quitApp(name)
export const emptyCleanup = (kind: CleanupKind) => api().emptyCleanup(kind)
export const pauseRunner = (name: string) => api().pauseRunner(name)
export const resumeRunner = (name: string) => api().resumeRunner(name)
export const peers = () => api().peers()
export const selfUsage = () => api().selfUsage()
export const computerCommand = (
  deviceId: string | null,
  name: string,
  args: Record<string, unknown>
) => api().computerCommand(deviceId, name, args)
export const openComputers = (signIn?: boolean) => api().openComputers(signIn)
export const onSettingsTab = (listener: (tab: SettingsTab) => void) => api().onSettingsTab(listener)
export const onShown = (listener: () => void) => api().onShown(listener)
export const onHidden = (listener: () => void) => api().onHidden(listener)
export const fitHeight = (height: number) => api().fitHeight(height)
export const version = () => api().version()
export const openExternal = (url: string) => api().openExternal(url)
export const menuState = () => api().menuState()
export const command = (name: MenuCommand) => api().command(name)
export const closeWindow = () => api().closeWindow()
export const updateOffer = () => api().updateOffer()
export const onUpdateOffer = (listener: (offer: UpdateOffer) => void) =>
  api().onUpdateOffer(listener)
export const answerUpdate = (answer: 'install' | 'later') => api().answerUpdate(answer)
export const account = () => api().account()
export const onAccount = (listener: (state: AccountState) => void) => api().onAccount(listener)
export const signIn = (mode: 'login' | 'signup', email: string, password: string, code?: string) =>
  api().signIn(mode, email, password, code)
export const sendCode = (purpose: 'signup' | 'reset', email: string) =>
  api().sendCode(purpose, email)
export const resetPassword = (email: string, code: string, password: string) =>
  api().resetPassword(email, code, password)
export const takeSignIn = () => api().takeSignIn()
export const onSignIn = (listener: () => void) => api().onSignIn(listener)
export const signOut = () => api().signOut()
export const reconnect = () => api().reconnect()

/** Marks the page see-through where the OS blurs behind the window, and takes the system accent colour. */
export function applyWindowLook(): void {
  void api()
    .translucent()
    .then((on) => {
      document.documentElement.dataset.translucent = String(on)
    })
  void api()
    .accentColor()
    .then((color) => {
      if (!color) {
        return
      }
      // Why: the menu look (runners-menu.css) and the window look (runners-window.css) both follow the OS accent.
      document.documentElement.style.setProperty('--rm-accent', color)
      document.documentElement.style.setProperty('--rw-accent', color)
    })
}
