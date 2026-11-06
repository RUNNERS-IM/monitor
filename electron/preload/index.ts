// The page's only door to the main process: `window.monitor`. Types are in ./api.ts, which the page imports.
import { contextBridge, ipcRenderer } from "electron";
import type { AccountState, MonitorApi, UpdateOffer } from "./api";

const api: MonitorApi = {
  snapshot: () => ipcRenderer.invoke("monitor:snapshot"),
  cleanup: () => ipcRenderer.invoke("monitor:cleanup"),
  cleanupOpened: () => ipcRenderer.invoke("monitor:cleanupOpened"),
  quitApp: (name) => ipcRenderer.invoke("monitor:quitApp", name),
  emptyCleanup: (kind) => ipcRenderer.invoke("monitor:emptyCleanup", kind),
  pauseRunner: (name) => ipcRenderer.invoke("monitor:pauseRunner", name),
  resumeRunner: (name) => ipcRenderer.invoke("monitor:resumeRunner", name),
  peers: () => ipcRenderer.invoke("monitor:peers"),
  selfUsage: () => ipcRenderer.invoke("monitor:selfUsage"),
  openComputers: (signIn) => ipcRenderer.invoke("monitor:openComputers", signIn === true),
  onShown: (listener) => {
    const relay = () => listener();
    ipcRenderer.on("monitor:shown", relay);
    return () => ipcRenderer.off("monitor:shown", relay);
  },
  onHidden: (listener) => {
    const relay = () => listener();
    ipcRenderer.on("monitor:hidden", relay);
    return () => ipcRenderer.off("monitor:hidden", relay);
  },
  translucent: () => ipcRenderer.invoke("monitor:translucent"),
  fitHeight: (height) => ipcRenderer.send("monitor:fitHeight", height),
  version: () => ipcRenderer.invoke("monitor:version"),
  openExternal: (url) => ipcRenderer.invoke("monitor:openExternal", url),
  accentColor: () => ipcRenderer.invoke("monitor:accentColor"),
  menuState: () => ipcRenderer.invoke("monitor:menuState"),
  command: (command) => ipcRenderer.invoke("monitor:command", command),
  closeWindow: () => ipcRenderer.send("monitor:closeWindow"),
  updateOffer: () => ipcRenderer.invoke("monitor:updateOffer"),
  onUpdateOffer: (listener) => {
    const relay = (_event: Electron.IpcRendererEvent, offer: UpdateOffer) => listener(offer);
    ipcRenderer.on("monitor:updateOffer", relay);
    return () => ipcRenderer.off("monitor:updateOffer", relay);
  },
  answerUpdate: (answer) => ipcRenderer.send("monitor:answerUpdate", answer),
  account: () => ipcRenderer.invoke("monitor:account"),
  onAccount: (listener) => {
    const relay = (_event: Electron.IpcRendererEvent, state: AccountState) => listener(state);
    ipcRenderer.on("monitor:account", relay);
    return () => ipcRenderer.off("monitor:account", relay);
  },
  signIn: (mode, email, password) => ipcRenderer.invoke("monitor:signIn", mode, email, password),
  takeSignIn: () => ipcRenderer.invoke("monitor:takeSignIn"),
  onSignIn: (listener) => {
    const relay = () => listener();
    ipcRenderer.on("monitor:signIn", relay);
    return () => ipcRenderer.off("monitor:signIn", relay);
  },
  signOut: () => ipcRenderer.invoke("monitor:signOut"),
  reconnect: () => ipcRenderer.invoke("monitor:reconnect"),
};

contextBridge.exposeInMainWorld("monitor", api);
