// The menu-bar / tray icon: three bars (CPU · memory · disk) drawn by the native module, and the memory percent
// next to them on macOS.
import { nativeImage, Tray } from "electron";
import { native } from "./native";
import { t } from "./i18n";
import { diskPercent, memoryPercent, type Snapshot } from "./types";

// Why: the bars glide to each new reading and then stop, so the picture costs nothing between readings.
const BARS_ANIMATION_MS = 450;
const BARS_FRAMES = 14;
/** Image width in pixels (18 pt at 2x) over the 24-unit drawing grid. */
const PIXELS_PER_UNIT = 36 / 24;
/** How the computer is doing: green, orange (slow) or red (memory pressure critical), the panel badge colours.
 *  Why: the panel no longer opens by itself, so the icon is where a slow computer shows. */
export type Level = "fine" | "warn" | "bad";
// Why: the system green, orange and red, readable on both a dark and a light menu bar.
const COLORS: Record<Level, [number, number, number]> = { fine: [52, 199, 89], warn: [255, 159, 10], bad: [255, 59, 48] };

let shown: [number, number, number] = [0, 0, 0];
let colour: Level = "fine";
let timer: NodeJS.Timeout | null = null;

function barsImage(heights: [number, number, number]): Electron.NativeImage {
  return nativeImage.createFromBuffer(native.barsPng(...heights, ...COLORS[colour]), { scaleFactor: 2 });
}

export function createTray(): Tray {
  const start = native.barHeight(0);
  shown = [start, start, start];
  const tray = new Tray(barsImage(shown));
  tray.setToolTip("Monitor");
  return tray;
}

/** Puts the newest reading on the tray: memory percent as the title, and the bars in the level's colour moved over a short ease-out. */
export function showReading(tray: Tray, snap: Snapshot, level: Level): void {
  const recolour = level !== colour;
  colour = level;
  const value = `${Math.round(memoryPercent(snap))}%`;
  // Why: the bars picture next to it says what the number is, so the title is only the memory percent.
  if (process.platform === "darwin") tray.setTitle(t("tray.title", { value }), { fontType: "monospacedDigit" });
  tray.setToolTip(t("tray.tooltip", { value }));

  const target: [number, number, number] = [
    native.barHeight(snap.cpuPercent / 100),
    native.barHeight(memoryPercent(snap) / 100),
    native.barHeight(diskPercent(snap) / 100),
  ];
  if (timer) clearTimeout(timer);
  const from = shown;
  const largest = Math.max(...from.map((h, i) => Math.abs(h - target[i])));
  // Why: less than one pixel of change is not worth a moving picture; under a hundredth it is not worth redrawing at all.
  if (largest < 0.01) {
    if (recolour && !tray.isDestroyed()) tray.setImage(barsImage(shown));
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
