//! The menu-bar picture: a rounded frame with three bars inside, CPU · memory · disk from left to right.
//! Shared RUNNERS spec (decision 4A): drawn on a 24×24 grid, shown at 18 pt, so the image is 36×36 px (2×).
//!
//! Drawn with tiny-skia at the same pinned version as Remote, so every RUNNERS app renders the shared frame
//! with the same pixels.

use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Stroke, Transform};

/// Width and height of the image in pixels: 18 pt at 2×.
pub const SIZE: u32 = 36;
const GRID: f32 = 24.0;

/// Left edge of each bar on the 24 grid: CPU, memory, disk.
const BAR_X: [f32; 3] = [5.5, 10.5, 15.5];
const BAR_WIDTH: f32 = 3.0;
const BAR_BOTTOM: f32 = 17.5;
/// Bar height at 100 %.
const BAR_MAX: f32 = 11.0;
/// Bar height at 0 %, so an idle bar still shows as a sliver instead of disappearing.
const BAR_MIN: f32 = 1.0;
const BAR_RADIUS: f32 = 0.8;

/// The shared frame's centre line and the stroke around it.
const FRAME: (f32, f32, f32, f32) = (2.5, 4.5, 19.0, 15.0);
const FRAME_RADIUS: f32 = 3.0;
const FRAME_STROKE: f32 = 2.0;

/// Height of one bar on the 24 grid for a usage fraction (0.0 – 1.0).
pub fn bar_height(fraction: f32) -> f32 {
    let fraction = if fraction.is_finite() { fraction.clamp(0.0, 1.0) } else { 0.0 };
    BAR_MIN + fraction * (BAR_MAX - BAR_MIN)
}

/// Draws the picture with bars at the given heights (grid units, from [`bar_height`]) as RGBA pixels in `color`.
/// macOS reads it as a template image (only the alpha counts), other systems show the colour as is.
/// Only the tests read raw pixels; the app takes the PNG from [`png`].
#[cfg(test)]
pub fn render(heights: [f32; 3], color: [u8; 3]) -> Vec<u8> {
    // Why: tiny-skia keeps premultiplied colour; plain RGBA is what an image API wants.
    draw(heights, color).take_demultiplied()
}

/// The same picture as a PNG file, which Electron's `nativeImage.createFromBuffer` reads.
pub fn png(heights: [f32; 3], color: [u8; 3]) -> Vec<u8> {
    draw(heights, color).encode_png().unwrap_or_default()
}

fn draw(heights: [f32; 3], color: [u8; 3]) -> Pixmap {
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("tray picture size");
    let mut paint = Paint::default();
    paint.set_color_rgba8(color[0], color[1], color[2], 255);
    paint.anti_alias = true;
    let scale = SIZE as f32 / GRID;
    let grid = Transform::from_scale(scale, scale);

    let (x, y, w, h) = FRAME;
    if let Some(frame) = rounded_rect(x, y, w, h, FRAME_RADIUS) {
        let stroke = Stroke { width: FRAME_STROKE, ..Stroke::default() };
        pixmap.stroke_path(&frame, &paint, &stroke, grid, None);
    }
    for (x, h) in BAR_X.iter().zip(heights) {
        if let Some(bar) = rounded_rect(*x, BAR_BOTTOM - h, BAR_WIDTH, h, BAR_RADIUS) {
            pixmap.fill_path(&bar, &paint, FillRule::Winding, grid, None);
        }
    }
    pixmap
}

/// A rounded rectangle; corners are cubic curves, the usual circle approximation (0.5523 of the radius).
/// The same shape code as Remote's tray picture.
fn rounded_rect(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<tiny_skia::Path> {
    let r = r.min(w / 2.0).min(h / 2.0);
    let k = r * 0.552_284_8;
    let (right, bottom) = (x + w, y + h);
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(right - r, y);
    pb.cubic_to(right - r + k, y, right, y + r - k, right, y + r);
    pb.line_to(right, bottom - r);
    pb.cubic_to(right, bottom - r + k, right - r + k, bottom, right - r, bottom);
    pb.line_to(x + r, bottom);
    pb.cubic_to(x + r - k, bottom, x, bottom - r + k, x, bottom - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
    pb.finish()
}

/// Ease-out: fast at first, slow at the end, so a change catches the eye and then settles.
pub fn ease_out(t: f32) -> f32 {
    1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(3)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Opaque pixels in one bar's column, counted down the middle of the bar.
    fn filled_rows(rgba: &[u8], bar: usize) -> usize {
        let col = ((BAR_X[bar] + BAR_WIDTH / 2.0) * SIZE as f32 / GRID) as u32;
        (0..SIZE).filter(|row| rgba[((row * SIZE + col) * 4 + 3) as usize] > 128).count()
    }

    #[test]
    fn renders_and_bars_grow() {
        let draw = |f: f32| render([bar_height(f); 3], [0, 0, 0]);
        let (empty, half, full) = (draw(0.0), draw(0.5), draw(1.0));
        for image in [&empty, &half, &full] {
            assert_eq!(image.len(), (SIZE * SIZE * 4) as usize);
        }
        for bar in 0..3 {
            let (a, b, c) = (filled_rows(&empty, bar), filled_rows(&half, bar), filled_rows(&full, bar));
            assert!(a < b && b < c, "bar {bar}: {a} < {b} < {c}");
        }
        // The frame's stroke rows (top and bottom) are drawn even with every bar at 0 %.
        assert!(filled_rows(&empty, 0) >= 4);
        // Nothing is drawn in the corner outside the frame.
        assert_eq!(empty[3], 0);
    }

    #[test]
    fn bars_stay_inside_frame() {
        assert_eq!(bar_height(-1.0), BAR_MIN);
        assert_eq!(bar_height(f32::NAN), BAR_MIN);
        assert_eq!(bar_height(2.0), BAR_MAX);
        // The tallest bar ends below the frame's inner edge.
        assert!(BAR_BOTTOM - BAR_MAX > FRAME.1 + FRAME_STROKE / 2.0);
    }

    #[test]
    fn ease_out_ends_where_it_should() {
        assert_eq!(ease_out(0.0), 0.0);
        assert_eq!(ease_out(1.0), 1.0);
        assert!(ease_out(0.5) > 0.5);
    }
}
