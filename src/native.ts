// The page's way to the app: a thin wrapper over `window.monitor`, which the preload script provides
// (electron/preload). Everything the page asks of the main process goes through here.
import type { MenuCommand, MenuState, MonitorApi } from "../electron/preload/api";
import type { Cleanup, Snapshot } from "./types";

declare global {
  interface Window {
    monitor: MonitorApi;
  }
}

const api = () => window.monitor;

export type { MenuCommand, MenuState };

/** Which window this page is: the tray panel or the About window. */
export const page: "panel" | "about" = location.hash === "#about" ? "about" : "panel";

export const snapshot = () => api().snapshot() as Promise<Snapshot | null>;
export const cleanup = () => api().cleanup() as Promise<Cleanup | null>;
export const quitApp = (name: string) => api().quitApp(name);
export const pauseRunner = (name: string) => api().pauseRunner(name);
export const closePopup = () => api().closePopup();
export const fitHeight = (height: number) => api().fitHeight(height);
export const version = () => api().version();
export const openExternal = (url: string) => api().openExternal(url);
export const menuState = () => api().menuState();
export const command = (name: MenuCommand) => api().command(name);
export const closeWindow = () => api().closeWindow();

/** Marks the page see-through where the OS blurs behind the window, and takes the system accent colour. */
export function applyWindowLook(): void {
  void api()
    .translucent()
    .then((on) => {
      document.documentElement.dataset.translucent = String(on);
    });
  void api()
    .accentColor()
    .then((color) => {
      if (color) document.documentElement.style.setProperty("--rm-accent", color);
    });
}
