// What the preload script gives the page as `window.monitor`.

export type MenuCommand = "usage" | "login" | "autoUpdate" | "about" | "updates" | "help" | "quit";

export type MenuState = { openAtLogin: boolean; autoUpdate: boolean };

export type CleanupKind = "cache" | "packages" | "build" | "trash" | "docker" | "simulators" | "wallpapers" | "vms" | "models";

/** What emptying did: bytes freed and recently used folders it kept. */
export type Emptied = { freed: number; skipped: number };

/** The update window's content: new version as people see it, the "What's new" lines (null hides the box) and the
 *  download's progress (0–100) while it runs. */
export type UpdateOffer = { version: string; notes: string[] | null; downloading: boolean; percent: number };

export type MonitorApi = {
  /** The newest reading (JSON shape in src/types.ts), or null before the first one. */
  snapshot: () => Promise<unknown>;
  /** The last cleanup measurement, or null while the first one runs. */
  cleanup: () => Promise<unknown>;
  /** Asks an app from the last reading to quit like ⌘Q; rejects with the reason when it cannot. */
  quitApp: (name: string) => Promise<void>;
  /** Asks first, then deletes the cleanable folders of one kind; null when the person said no. */
  emptyCleanup: (kind: CleanupKind) => Promise<Emptied | null>;
  /** Pauses a GitHub runner for an hour (macOS); rejects with the reason when it cannot. */
  pauseRunner: (name: string) => Promise<void>;
  /** Whether the OS blurs what is behind the window; the page draws a solid background when it does not. */
  translucent: () => Promise<boolean>;
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
  /** What the update window shows, or null when no update is being offered. */
  updateOffer: () => Promise<UpdateOffer | null>;
  /** Calls back with the new offer whenever the download moves on; returns a function that stops it. */
  onUpdateOffer: (listener: (offer: UpdateOffer) => void) => () => void;
  /** The update window's answer; Later closes the window, Install Now keeps it up until the app quits. */
  answerUpdate: (answer: "install" | "later") => void;
};
