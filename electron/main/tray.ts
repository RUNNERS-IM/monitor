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
// Why: macOS uses the picture as a template (only its shape counts) and tints it for a dark or light menu bar.
// Windows and Linux show the colour as drawn; white suits the usual dark taskbar, a light Linux panel may hide it.
const COLOR: [number, number, number] = process.platform === "darwin" ? [0, 0, 0] : [255, 255, 255];

let shown: [number, number, number] = [0, 0, 0];
let timer: NodeJS.Timeout | null = null;

function barsImage(heights: [number, number, number]): Electron.NativeImage {
  const image = nativeImage.createFromBuffer(native.barsPng(...heights, ...COLOR), { scaleFactor: 2 });
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image;
}

export function createTray(): Tray {
  const start = native.barHeight(0);
  shown = [start, start, start];
  const tray = new Tray(barsImage(shown));
  tray.setToolTip("Monitor");
  return tray;
}

/** Puts the newest reading on the tray: memory percent as the title, and the bars moved over a short ease-out. */
export function showReading(tray: Tray, snap: Snapshot): void {
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
  if (largest < 0.01) return;
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
