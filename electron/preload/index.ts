// The page's only door to the main process: `window.monitor`. Types are in ./api.ts, which the page imports.
import { contextBridge, ipcRenderer } from "electron";
import type { MonitorApi } from "./api";

const api: MonitorApi = {
  snapshot: () => ipcRenderer.invoke("monitor:snapshot"),
  cleanup: () => ipcRenderer.invoke("monitor:cleanup"),
  quitApp: (name) => ipcRenderer.invoke("monitor:quitApp", name),
  pauseRunner: (name) => ipcRenderer.invoke("monitor:pauseRunner", name),
  translucent: () => ipcRenderer.invoke("monitor:translucent"),
  closePopup: () => ipcRenderer.invoke("monitor:closePopup"),
  fitHeight: (height) => ipcRenderer.send("monitor:fitHeight", height),
  version: () => ipcRenderer.invoke("monitor:version"),
  openExternal: (url) => ipcRenderer.invoke("monitor:openExternal", url),
  accentColor: () => ipcRenderer.invoke("monitor:accentColor"),
  menuState: () => ipcRenderer.invoke("monitor:menuState"),
  command: (command) => ipcRenderer.invoke("monitor:command", command),
  closeWindow: () => ipcRenderer.send("monitor:closeWindow"),
};

contextBridge.exposeInMainWorld("monitor", api);
