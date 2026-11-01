// The menu-bar / tray icon: three bars (CPU · memory · disk) drawn by the native module, and the memory percent
// next to them on macOS, both in the level's colour.
import { nativeImage, nativeTheme, Tray } from "electron";
import { native } from "./native";
import { t } from "./i18n";
import { diskPercent, memoryPercent, type Snapshot } from "./types";

// Why: the bars glide to each new reading and then stop, so the picture costs nothing between readings.
const BARS_ANIMATION_MS = 450;
const BARS_FRAMES = 14;
/** Image width in pixels (18 pt at 2x) over the 24-unit drawing grid. */
const PIXELS_PER_UNIT = 36 / 24;
// Why: macOS uses the picture as a template (only its shape counts) and tints it for a dark or light menu bar.
// Windows and Linux show the colour as drawn; white suits the usual dark taskbar, a light Linux panel may hide it.
const COLOR: [number, number, number] = process.platform === "darwin" ? [0, 0, 0] : [255, 255, 255];
/** How the computer is doing: green, orange (slow) or red (memory pressure critical), the panel badge colours.
 *  Why: the panel no longer opens by itself, so the number next to the icon is where a slow computer shows. */
export type Level = "fine" | "warn" | "bad";
type Rgb = [number, number, number];
// Why: the icon and the number change colour together, and in deep shades: the bright ANSI title yellow
// (#ffff00) could hardly be read on a light menu bar. A dark menu bar gets the lighter system shades instead.
const LEVEL_COLORS: Record<"light" | "dark", Record<Level, Rgb>> = {
  light: { fine: [31, 138, 59], warn: [199, 106, 0], bad: [200, 35, 30] },
  dark: { fine: [50, 215, 75], warn: [255, 159, 10], bad: [255, 69, 58] },
};
// Why: the number is drawn into the picture (a title cannot take these colours); without the system font it stays a plain title.
const labelled = process.platform === "darwin" && native.canLabel();

let shown: Rgb = [0, 0, 0];
let timer: NodeJS.Timeout | null = null;
let label = "";
let level: Level = "fine";

function barsImage(heights: Rgb): Electron.NativeImage {
  if (labelled) {
    const colour = LEVEL_COLORS[nativeTheme.shouldUseDarkColors ? "dark" : "light"][level];
    return nativeImage.createFromBuffer(native.barsLabelPng(...heights, ...colour, label), { scaleFactor: 2 });
  }
  const image = nativeImage.createFromBuffer(native.barsPng(...heights, ...COLOR), { scaleFactor: 2 });
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image;
}

export function createTray(): Tray {
  const start = native.barHeight(0);
  shown = [start, start, start];
  const tray = new Tray(barsImage(shown));
  tray.setToolTip("Monitor");
  // Why: the shades follow the menu bar, so switching between light and dark redraws at once.
  nativeTheme.on("updated", () => {
    if (!tray.isDestroyed()) tray.setImage(barsImage(shown));
  });
  return tray;
}

/** Puts the newest reading on the tray: memory percent next to the bars in the level's colour, the bars moved over a short ease-out. */
export function showReading(tray: Tray, snap: Snapshot, now: Level): void {
  const value = `${Math.round(memoryPercent(snap))}%`;
  // Why: the bars picture next to it says what the number is, so the label is only the memory percent.
  const text = t("tray.title", { value });
  const changed = text !== label || now !== level;
  label = text;
  level = now;
  if (process.platform === "darwin" && !labelled) tray.setTitle(text, { fontType: "monospacedDigit" });
  tray.setToolTip(t("tray.tooltip", { value }));

  const target: [number, number, number] = [
    native.barHeight(snap.cpuPercent / 100),
    native.barHeight(memoryPercent(snap) / 100),
    native.barHeight(diskPercent(snap) / 100),
  ];
  if (timer) clearTimeout(timer);
  const from = shown;
  const largest = Math.max(...from.map((h, i) => Math.abs(h - target[i])));
  // Why: less than one pixel of change is not worth a moving picture; under a hundredth it is not worth redrawing at all,
  // unless the number or its colour changed.
  if (largest < 0.01) {
    if (changed && labelled && !tray.isDestroyed()) tray.setImage(barsImage(shown));
    return;
  }
  const frames = largest * PIXELS_PER_UNIT < 1 ? 1 : BARS_FRAMES;
  let frame = 0;
  const step = () => {
    frame += 1;
    const k = native.easeOut(frame / frames);
    shown = from.map((h, i) => h + (target[i] - h) * k) as [number, number, number];
    if (!tray.isDestroyed()) tray.setImage(barsImage(shown));
    timer = frame < frames ? setTimeout(step, BARS_ANIMATION_MS / frames) : null;
  };
  step();
}
