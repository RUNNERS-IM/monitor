//! The menu-bar picture: a rounded frame with three bars inside, CPU · memory · disk from left to right.
//! Shared RUNNERS spec (decision 4A): drawn on a 24×24 grid, shown at 18 pt, so the image is 36×36 px (2×).
//!
//! Drawn with tiny-skia at the same pinned version as Remote, so every RUNNERS app renders the shared frame
//! with the same pixels.

use std::sync::OnceLock;

use ab_glyph::{Font, FontVec, PxScale, ScaleFont, VariableFont};
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, PixmapPaint, Stroke, Transform};

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

/// The system font the label is drawn in; `None` where it cannot be read (then the app keeps a plain title).
const LABEL_FONT: &str = "/System/Library/Fonts/SFNS.ttf";
/// Label size in pixels at 2×: 13 pt, the menu bar's own title size.
const LABEL_PX: f32 = 26.0;
/// Medium weight: a coloured number needs a little more ink than black text to read as well.
const LABEL_WEIGHT: f32 = 510.0;
/// Space between the picture's frame and the label, and after the label, in pixels.
const LABEL_GAP: f32 = 3.0;
const LABEL_TRAIL: f32 = 2.0;

fn label_font() -> Option<&'static FontVec> {
    static FONT: OnceLock<Option<FontVec>> = OnceLock::new();
    FONT.get_or_init(|| {
        let mut font = FontVec::try_from_vec(std::fs::read(LABEL_FONT).ok()?).ok()?;
        font.set_variation(b"wght", LABEL_WEIGHT);
        Some(font)
    })
    .as_ref()
}

/// Whether [`png_with_label`] can draw text on this computer.
pub fn can_label() -> bool {
    label_font().is_some()
}

/// The picture followed by `label` (the memory percent), both in `color`, as one PNG.
/// Why: one picture keeps the icon and the number the same colour; macOS cannot tint a picture and colour a title alike.
/// Digits take the widest digit's width so the label does not shift as the number changes.
pub fn png_with_label(heights: [f32; 3], color: [u8; 3], label: &str) -> Vec<u8> {
    let Some(font) = label_font() else { return png(heights, color) };
    let font = font.as_scaled(PxScale::from(LABEL_PX));
    let digit = ('0'..='9').map(|c| font.h_advance(font.glyph_id(c))).fold(0.0, f32::max);
    let advance = |c: char| if c.is_ascii_digit() { digit } else { font.h_advance(font.glyph_id(c)) };
    let start = SIZE as f32 * (FRAME.0 + FRAME.2 + FRAME_STROKE / 2.0) / GRID + LABEL_GAP;
    let width = (start + label.chars().map(advance).sum::<f32>() + LABEL_TRAIL).ceil() as u32;
    let Some(mut pixmap) = Pixmap::new(width, SIZE) else { return png(heights, color) };
    pixmap.draw_pixmap(0, 0, draw(heights, color).as_ref(), &PixmapPaint::default(), Transform::identity(), None);

    // Why: centre the digits' height (not ascent + descent) on the frame, which is how the menu bar's own titles sit.
    let cap = font.outline_glyph(font.scaled_glyph('0')).map(|g| g.px_bounds().height()).unwrap_or(LABEL_PX * 0.7);
    let baseline = SIZE as f32 * (FRAME.1 + FRAME.3 / 2.0) / GRID + cap / 2.0;
    let mut x = start;
    let data = pixmap.data_mut();
    for c in label.chars() {
        let step = advance(c);
        let mut glyph = font.scaled_glyph(c);
        // Why: a narrow digit sits in the middle of its widest-digit cell, like tabular figures.
        let own = font.h_advance(glyph.id);
        glyph.position = ab_glyph::point(x + (step - own).max(0.0) / 2.0, baseline);
        if let Some(outline) = font.outline_glyph(glyph) {
            let bounds = outline.px_bounds();
            outline.draw(|gx, gy, coverage| {
                let (px, py) = (bounds.min.x as i32 + gx as i32, bounds.min.y as i32 + gy as i32);
                if px < 0 || py < 0 || px >= width as i32 || py >= SIZE as i32 {
                    return;
                }
                let i = ((py as u32 * width + px as u32) * 4) as usize;
                let alpha = (coverage.clamp(0.0, 1.0) * 255.0).round() as u8;
                // Premultiplied, as tiny-skia stores it; glyphs never overlap the frame, so a plain max is enough.
                if alpha > data[i + 3] {
                    for (k, channel) in color.iter().enumerate() {
                        data[i + k] = ((*channel as u16 * alpha as u16 + 127) / 255) as u8;
                    }
                    data[i + 3] = alpha;
                }
            });
        }
        x += step;
    }
    pixmap.encode_png().unwrap_or_default()
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
    fn label_widens_the_picture_and_keeps_width_across_digits() {
        if !can_label() {
            return;
        }
        let size = |label: &str| {
            let png = png_with_label([bar_height(0.5); 3], [200, 35, 30], label);
            let pixmap = Pixmap::decode_png(&png).expect("png");
            (pixmap.width(), pixmap.height())
        };
        let (w11, h) = size("11%");
        assert_eq!(h, SIZE);
        assert!(w11 > SIZE + 20, "label adds width: {w11}");
        assert_eq!(size("88%").0, w11, "same width whatever the digits");
        assert!(size("100%").0 > w11);
    }

    #[test]
    fn ease_out_ends_where_it_should() {
        assert_eq!(ease_out(0.0), 0.0);
        assert_eq!(ease_out(1.0), 1.0);
        assert!(ease_out(0.5) > 0.5);
    }
}
