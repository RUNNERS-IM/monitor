// The right-click tray menu, in the order shared by Split, Prompt and Monitor: the readout and status lines, the
// app's own lines, about / updates / settings / help, quit. The left-click panel holds the same commands.
// Icons are the Lucide PNGs from scripts/menu-icons.sh (resources/menu/).
import { app, Menu, MenuItem, nativeImage, nativeTheme } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "./i18n";
import { diskPercent, memoryPercent, type Snapshot } from "./types";

import type { MenuCommand as Command, MenuState } from "../preload/api";

export type { Command, MenuState };

const icons = new Map<string, Electron.NativeImage>();

/** Lucide icon: a template image on macOS (the menu tints it), black or white by theme elsewhere. */
function icon(name: string): Electron.NativeImage {
  const dot = name.startsWith("dot-");
  const file = dot ? name : `${name}-${process.platform !== "darwin" && nativeTheme.shouldUseDarkColors ? "white" : "black"}`;
  let image = icons.get(file);
  if (!image) {
    // Why: 36 px drawn for an 18 pt slot, so the image is read at 2x.
    image = nativeImage.createFromBuffer(readFileSync(join(app.getAppPath(), "resources", "menu", `${file}.png`)), {
      scaleFactor: 2,
    });
    if (process.platform === "darwin" && !dot) image.setTemplateImage(true);
    icons.set(file, image);
  }
  return image;
}

/** How the computer is doing, the same three levels the panel shows. */
function status(snap: Snapshot & { level?: "fine" | "warn" | "bad" }): { key: string; dot: string } {
  // Why: the same held level as the icon and the panel badge (red when memory pressure is critical, orange otherwise).
  const level = snap.level ?? (!(snap.slowMemory || snap.slowCpu) ? "fine" : snap.memoryPressure === "critical" ? "bad" : "warn");
  if (level === "fine") return { key: "menu.status.fine", dot: "dot-green" };
  if (level === "bad") return { key: "menu.status.bad", dot: "dot-red" };
  return { key: "menu.status.warn", dot: "dot-yellow" };
}

export function buildMenu(snap: Snapshot | null, state: MenuState, run: (command: Command) => void): Menu {
  const percent = (value: number) => `${Math.round(value)}%`;
  const dash = "–";
  // Why: the tray picture is three bars without labels, so the first line names them with their values.
  const readout = snap
    ? t("menu.readout", { cpu: percent(snap.cpuPercent), memory: percent(memoryPercent(snap)), disk: percent(diskPercent(snap)) })
    : t("menu.readout", { cpu: dash, memory: dash, disk: dash });
  const level = snap ? status(snap) : { key: "menu.status.fine", dot: "dot-green" };
  const line = (id: Command, key: string, iconName: string, accelerator?: string) =>
    new MenuItem({
      id,
      label: t(key),
      icon: icon(iconName),
      accelerator,
      registerAccelerator: false,
      click: () => run(id),
    });
  const toggle = (id: Command, key: string, checked: boolean) =>
    new MenuItem({ id, label: t(key), type: "checkbox", checked, click: () => run(id) });
  const separator = () => new MenuItem({ type: "separator" });
  return Menu.buildFromTemplate([
    { label: readout, icon: icon("chart-column"), enabled: false },
    { label: t(level.key, { name: snap?.host ?? "" }), icon: icon(level.dot), enabled: false },
    separator(),
    line("usage", "menu.showUsage", "chart-column"),
    line("phone", "menu.phone", "smartphone"),
    // Why: on/off lines use the system check mark, as every RUNNERS app's native menu does (shared decision 2A);
    // a native check cannot sit next to an icon, so these two have none.
    toggle("login", "menu.openAtLogin", state.openAtLogin),
    toggle("autoUpdate", "menu.autoUpdate", state.autoUpdate),
    separator(),
    line("about", "menu.about", "info"),
    line("updates", "menu.checkUpdates", "refresh-cw"),
    // Why: there is no settings screen yet, so it stays visible but disabled to keep the shared order.
    { label: t("menu.settings"), icon: icon("settings"), enabled: false, accelerator: "CmdOrCtrl+,", registerAccelerator: false },
    line("help", "menu.help", "circle-help"),
    separator(),
    line("quit", "menu.quit", "square-x", "CmdOrCtrl+Q"),
  ]);
}

export function forgetIcons(): void {
  icons.clear();
}
