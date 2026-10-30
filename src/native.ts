// The page's way to the app: a thin wrapper over `window.monitor`, which the preload script provides
// (electron/preload). Everything the page asks of the main process goes through here.
import type { MenuCommand, MenuState, MonitorApi, UpdateOffer } from "../electron/preload/api";
import type { Cleanup, Snapshot } from "./types";

declare global {
  interface Window {
    monitor: MonitorApi;
  }
}

const api = () => window.monitor;

export type { MenuCommand, MenuState, UpdateOffer };

/** Which window this page is: the tray panel, the About window or the update question. */
export const page: "panel" | "about" | "update" =
  location.hash === "#about" ? "about" : location.hash === "#update" ? "update" : "panel";

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
export const updateOffer = () => api().updateOffer();
export const onUpdateOffer = (listener: (offer: UpdateOffer) => void) => api().onUpdateOffer(listener);
export const answerUpdate = (answer: "install" | "later") => api().answerUpdate(answer);

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
