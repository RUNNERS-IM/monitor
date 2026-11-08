// The page's only door to the main process: `window.monitor`. Types are in ./api.ts, which the page imports.
import { contextBridge, ipcRenderer } from 'electron'
import type { AccountState, MonitorApi, SettingsTab, UpdateOffer } from './api'

const api: MonitorApi = {
  snapshot: () => ipcRenderer.invoke('monitor:snapshot'),
  cleanup: () => ipcRenderer.invoke('monitor:cleanup'),
  cleanupOpened: () => ipcRenderer.invoke('monitor:cleanupOpened'),
  quitApp: (name) => ipcRenderer.invoke('monitor:quitApp', name),
  emptyCleanup: (kind) => ipcRenderer.invoke('monitor:emptyCleanup', kind),
  pauseRunner: (name) => ipcRenderer.invoke('monitor:pauseRunner', name),
  resumeRunner: (name) => ipcRenderer.invoke('monitor:resumeRunner', name),
  peers: () => ipcRenderer.invoke('monitor:peers'),
  selfUsage: () => ipcRenderer.invoke('monitor:selfUsage'),
  computerCommand: (deviceId, name, args) =>
    ipcRenderer.invoke('monitor:computerCommand', deviceId, name, args),
  openComputers: (signIn) => ipcRenderer.invoke('monitor:openComputers', signIn === true),
  onSettingsTab: (listener) => {
    const relay = (_event: Electron.IpcRendererEvent, tab: SettingsTab) => listener(tab)
    ipcRenderer.on('monitor:settingsTab', relay)
    return () => ipcRenderer.off('monitor:settingsTab', relay)
  },
  onShown: (listener) => {
    const relay = () => listener()
    ipcRenderer.on('monitor:shown', relay)
    return () => ipcRenderer.off('monitor:shown', relay)
  },
  onHidden: (listener) => {
    const relay = () => listener()
    ipcRenderer.on('monitor:hidden', relay)
    return () => ipcRenderer.off('monitor:hidden', relay)
  },
  translucent: () => ipcRenderer.invoke('monitor:translucent'),
  fitHeight: (height) => ipcRenderer.send('monitor:fitHeight', height),
  version: () => ipcRenderer.invoke('monitor:version'),
  openExternal: (url) => ipcRenderer.invoke('monitor:openExternal', url),
  menuState: () => ipcRenderer.invoke('monitor:menuState'),
  command: (command) => ipcRenderer.invoke('monitor:command', command),
  closeWindow: () => ipcRenderer.send('monitor:closeWindow'),
  updateOffer: () => ipcRenderer.invoke('monitor:updateOffer'),
  onUpdateOffer: (listener) => {
    const relay = (_event: Electron.IpcRendererEvent, offer: UpdateOffer) => listener(offer)
    ipcRenderer.on('monitor:updateOffer', relay)
    return () => ipcRenderer.off('monitor:updateOffer', relay)
  },
  answerUpdate: (answer) => ipcRenderer.send('monitor:answerUpdate', answer),
  account: () => ipcRenderer.invoke('monitor:account'),
  onAccount: (listener) => {
    const relay = (_event: Electron.IpcRendererEvent, state: AccountState) => listener(state)
    ipcRenderer.on('monitor:account', relay)
    return () => ipcRenderer.off('monitor:account', relay)
  },
  signIn: (mode, email, password, code) =>
    ipcRenderer.invoke('monitor:signIn', mode, email, password, code),
  sendCode: (purpose, email) => ipcRenderer.invoke('monitor:sendCode', purpose, email),
  resetPassword: (email, code, password) =>
    ipcRenderer.invoke('monitor:resetPassword', email, code, password),
  takeSignIn: () => ipcRenderer.invoke('monitor:takeSignIn'),
  onSignIn: (listener) => {
    const relay = () => listener()
    ipcRenderer.on('monitor:signIn', relay)
    return () => ipcRenderer.off('monitor:signIn', relay)
  },
  usageConsent: () => ipcRenderer.invoke('monitor:usageConsent'),
  setUsageConsent: (granted) => ipcRenderer.invoke('monitor:setUsageConsent', granted),
  signOut: () => ipcRenderer.invoke('monitor:signOut'),
  reconnect: () => ipcRenderer.invoke('monitor:reconnect')
}

contextBridge.exposeInMainWorld('monitor', api)
