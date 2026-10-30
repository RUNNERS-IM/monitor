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
function status(snap: Snapshot): { key: string; dot: string } {
  // Why: mirrors the panel badge, which is red when memory pressure is critical and orange for any other slowness.
  if (!(snap.slowMemory || snap.slowCpu)) return { key: "menu.status.fine", dot: "dot-green" };
  if (snap.memoryPressure === "critical") return { key: "menu.status.bad", dot: "dot-red" };
  return { key: "menu.status.warn", dot: "dot-yellow" };
}

/** Why: a native check mark cannot sit next to an icon, and every line has a Lucide icon (shared spec), so a
 *  checked or empty Lucide square stands in for it. */
function box(on: boolean): string {
  return on ? "square-check" : "square";
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
  const separator = () => new MenuItem({ type: "separator" });
  return Menu.buildFromTemplate([
    { label: readout, icon: icon("chart-column"), enabled: false },
    { label: t(level.key, { name: snap?.host ?? "" }), icon: icon(level.dot), enabled: false },
    separator(),
    line("usage", "menu.showUsage", "chart-column"),
    line("login", "menu.openAtLogin", box(state.openAtLogin)),
    line("autoUpdate", "menu.autoUpdate", box(state.autoUpdate)),
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
