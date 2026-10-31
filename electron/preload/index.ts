// The page's only door to the main process: `window.monitor`. Types are in ./api.ts, which the page imports.
import { contextBridge, ipcRenderer } from "electron";
import type { MonitorApi, UpdateOffer } from "./api";

const api: MonitorApi = {
  snapshot: () => ipcRenderer.invoke("monitor:snapshot"),
  cleanup: () => ipcRenderer.invoke("monitor:cleanup"),
  quitApp: (name) => ipcRenderer.invoke("monitor:quitApp", name),
  emptyCleanup: (kind) => ipcRenderer.invoke("monitor:emptyCleanup", kind),
  pauseRunner: (name) => ipcRenderer.invoke("monitor:pauseRunner", name),
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
};

contextBridge.exposeInMainWorld("monitor", api);
