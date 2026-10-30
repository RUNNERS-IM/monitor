// What the preload script gives the page as `window.monitor`.

export type MenuCommand = "usage" | "login" | "autoUpdate" | "about" | "updates" | "help" | "quit";

export type MenuState = { openAtLogin: boolean; autoUpdate: boolean };

export type MonitorApi = {
  /** The newest reading (JSON shape in src/types.ts), or null before the first one. */
  snapshot: () => Promise<unknown>;
  /** The last cleanup measurement, or null while the first one runs. */
  cleanup: () => Promise<unknown>;
  /** Asks an app from the last reading to quit like ⌘Q; rejects with the reason when it cannot. */
  quitApp: (name: string) => Promise<void>;
  /** Pauses a GitHub runner for an hour (macOS); rejects with the reason when it cannot. */
  pauseRunner: (name: string) => Promise<void>;
  /** Whether the OS blurs what is behind the window; the page draws a solid background when it does not. */
  translucent: () => Promise<boolean>;
  /** Closes the slow-computer popup and keeps it closed until the computer recovers. */
  closePopup: () => Promise<void>;
  /** Sets the window's content height so it fits the page. */
  fitHeight: (height: number) => void;
  /** App version as people see it (2.6.1030.2). */
  version: () => Promise<string>;
  /** Opens an https link in the default browser. */
  openExternal: (url: string) => Promise<void>;
  /** The system accent colour as #rrggbb, or null where the OS has none. */
  accentColor: () => Promise<string | null>;
  menuState: () => Promise<MenuState>;
  /** Runs a menu line; resolves to the menu state after it. */
  command: (command: MenuCommand) => Promise<MenuState>;
  closeWindow: () => void;
};
