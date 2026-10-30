//! The "About Monitor" window: icon, name, version, RUNNERS, license line and the RUNNERS app cards.
//! Why: the native macOS about panel cannot hold the cards the shared spec asks for
//! (`_docs/작업 가이드/공통.md`, "계정 칸과 다른 앱 추천"), so every OS gets this small webview window instead.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::i18n::t;

pub const LABEL: &str = "about";
const WIDTH: f64 = 360.0;
/// First height only; the page then fits the window to its content (src/About.tsx).
const HEIGHT: f64 = 560.0;

/// Opens the About window, or brings the open one to the front.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title(t("about.title", &[]))
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        // Why: see-through so the macOS blur behind the page shows, like the tray panel.
        .transparent(true)
        .visible(false)
        .build();
    let Ok(window) = built else {
        return;
    };
    crate::apply_blur(&window, None);
    if let Some(theme) = crate::debug_theme() {
        let _ = window.set_theme(Some(theme));
    }
    let _ = window.show();
    // Why: Monitor has no Dock icon, so without focus the window can open behind the app in front;
    // on macOS focusing also activates the app.
    let _ = window.set_focus();
}
