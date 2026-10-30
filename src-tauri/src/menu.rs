//! The right-click tray menu, in the order shared by Split, Prompt and Monitor
//! (`_docs/작업 가이드/공통.md`, "메뉴바 메뉴와 아이콘"): status line, app feature, about / updates / settings / help, quit.
//! Monitor puts one more line on top that reads out the three tray bars (CPU · memory · disk).

use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{IconMenuItem, Menu, PredefinedMenuItem};
use tauri::{App, AppHandle, Manager, Theme, Wry};

use crate::i18n::t;
use crate::snapshot::{Pressure, Snapshot};

/// How the computer is doing, the same three levels the panel shows.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    Fine,
    Warn,
    Bad,
}

impl Status {
    /// Why: mirrors the panel badge, which is red when memory pressure is critical and orange/yellow for any other slowness.
    fn of(snap: &Snapshot) -> Self {
        if !(snap.slow_memory || snap.slow_cpu) {
            Status::Fine
        } else if matches!(snap.memory_pressure, Pressure::Critical) {
            Status::Bad
        } else {
            Status::Warn
        }
    }

    fn key(self) -> &'static str {
        match self {
            Status::Fine => "menu.status.fine",
            Status::Warn => "menu.status.warn",
            Status::Bad => "menu.status.bad",
        }
    }

    fn dot(self) -> Image<'static> {
        match self {
            Status::Fine => tauri::include_image!("icons/menu/dot-green.png"),
            Status::Warn => tauri::include_image!("icons/menu/dot-yellow.png"),
            Status::Bad => tauri::include_image!("icons/menu/dot-red.png"),
        }
    }
}

/// Lucide icon in black for light menus or white for dark menus.
/// Why: Tauri 2.12 / muda 0.20 cannot mark a custom menu image as a macOS template image,
/// so the colour is picked here and swapped when the system switches between dark and light.
fn icon(name: &str, dark: bool) -> Image<'static> {
    match (name, dark) {
        ("chart-column", false) => tauri::include_image!("icons/menu/chart-column-black.png"),
        ("chart-column", true) => tauri::include_image!("icons/menu/chart-column-white.png"),
        ("info", false) => tauri::include_image!("icons/menu/info-black.png"),
        ("info", true) => tauri::include_image!("icons/menu/info-white.png"),
        ("refresh-cw", false) => tauri::include_image!("icons/menu/refresh-cw-black.png"),
        ("refresh-cw", true) => tauri::include_image!("icons/menu/refresh-cw-white.png"),
        ("settings", false) => tauri::include_image!("icons/menu/settings-black.png"),
        ("settings", true) => tauri::include_image!("icons/menu/settings-white.png"),
        ("circle-help", false) => tauri::include_image!("icons/menu/circle-help-black.png"),
        ("circle-help", true) => tauri::include_image!("icons/menu/circle-help-white.png"),
        ("square-x", false) => tauri::include_image!("icons/menu/square-x-black.png"),
        ("square-check", false) => tauri::include_image!("icons/menu/square-check-black.png"),
        ("square-check", true) => tauri::include_image!("icons/menu/square-check-white.png"),
        ("square", false) => tauri::include_image!("icons/menu/square-black.png"),
        ("square", true) => tauri::include_image!("icons/menu/square-white.png"),
        _ => tauri::include_image!("icons/menu/square-x-white.png"),
    }
}

/// Menu lines that change after the menu is built.
pub struct TrayMenu {
    /// "CPU 12% · Memory 83% · Disk 40%", the numbers behind the tray bars.
    readout: IconMenuItem<Wry>,
    readout_text: Mutex<String>,
    status: IconMenuItem<Wry>,
    shown: Mutex<Option<Status>>,
    /// Lines with a Lucide icon, and the icon's name.
    icons: Vec<(IconMenuItem<Wry>, &'static str)>,
    /// "Open at login", whose Lucide box is checked or empty; kept apart from `icons` because its icon changes.
    login: IconMenuItem<Wry>,
    login_on: Mutex<bool>,
    dark: Mutex<bool>,
}

/// Why: muda's check items cannot carry an icon, and every line has a Lucide icon (shared spec), so a checked or
/// empty Lucide square stands in for the check mark.
fn login_icon(on: bool) -> &'static str {
    if on { "square-check" } else { "square" }
}

fn is_dark(app: &AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.theme().ok()).is_some_and(|theme| theme == Theme::Dark)
}

pub fn build(app: &App, open_at_login: bool) -> tauri::Result<Menu<Wry>> {
    let dark = is_dark(app.handle());
    let line = |id: &str, key: &str, name: &'static str, enabled: bool, accelerator: Option<&str>| {
        IconMenuItem::with_id(app, id, t(key, &[]), enabled, Some(icon(name, dark)), accelerator).map(|item| (item, name))
    };

    // Why: the tray picture is three bars without labels, so the first line names them with their values.
    // It only reports, so it is disabled; it carries the "usage" icon from the shared table.
    let dash = "–";
    let readout_text = t("menu.readout", &[("cpu", dash), ("memory", dash), ("disk", dash)]);
    let readout = line("readout", "menu.readout", "chart-column", false, None)?;
    readout.0.set_text(&readout_text)?;
    // Why: the line only reports; it starts as "fine" and is corrected on the first reading 3 seconds later.
    let status = IconMenuItem::with_id(
        app,
        "status",
        t(Status::Fine.key(), &[("name", &sysinfo::System::host_name().unwrap_or_default())]),
        false,
        Some(Status::Fine.dot()),
        None::<&str>,
    )?;
    let usage = line("usage", "menu.showUsage", "chart-column", true, None)?;
    let login = line("login", "menu.openAtLogin", login_icon(open_at_login), true, None)?.0;
    // Why: opens Monitor's own About window (src/about.rs) on every OS, which also holds the RUNNERS app cards.
    let about = line("about", "menu.about", "info", true, None)?;
    let updates = line("updates", "menu.checkUpdates", "refresh-cw", true, None)?;
    // Why: there is no settings screen yet, so it stays visible but disabled to keep the shared order.
    let settings = line("settings", "menu.settings", "settings", false, Some("CmdOrCtrl+,"))?;
    let help = line("help", "menu.help", "circle-help", true, None)?;
    let quit = line("quit", "menu.quit", "square-x", true, Some("CmdOrCtrl+Q"))?;

    let menu = Menu::with_items(
        app,
        &[
            &readout.0,
            &status,
            &PredefinedMenuItem::separator(app)?,
            &usage.0,
            &login,
            &PredefinedMenuItem::separator(app)?,
            &about.0,
            &updates.0,
            &settings.0,
            &help.0,
            &PredefinedMenuItem::separator(app)?,
            &quit.0,
        ],
    )?;
    let readout_item = readout.0.clone();
    app.manage(TrayMenu {
        readout: readout_item,
        readout_text: Mutex::new(readout_text),
        status,
        shown: Mutex::new(Some(Status::Fine)),
        icons: vec![readout, usage, about, updates, settings, help, quit],
        login,
        login_on: Mutex::new(open_at_login),
        dark: Mutex::new(dark),
    });
    Ok(menu)
}

/// Puts the newest CPU, memory and disk percentages in the first line; skips the update when the text is unchanged.
pub fn show_usage(app: &AppHandle, snap: &Snapshot) {
    let menu = app.state::<TrayMenu>();
    let percent = |value: f64| format!("{}%", value.round());
    let text = t(
        "menu.readout",
        &[
            ("cpu", &percent(snap.cpu_percent as f64)),
            ("memory", &percent(snap.memory_percent())),
            ("disk", &percent(snap.disk_percent())),
        ],
    );
    let mut shown = menu.readout_text.lock().unwrap();
    if *shown == text {
        return;
    }
    let _ = menu.readout.set_text(&text);
    *shown = text;
}

/// Puts the newest reading in the status line; does nothing while the level stays the same.
pub fn show_status(app: &AppHandle, snap: &Snapshot) {
    let menu = app.state::<TrayMenu>();
    let status = Status::of(snap);
    let mut shown = menu.shown.lock().unwrap();
    if *shown == Some(status) {
        return;
    }
    let _ = menu.status.set_text(t(status.key(), &[("name", &snap.host)]));
    let _ = menu.status.set_icon(Some(status.dot()));
    *shown = Some(status);
}

/// Swaps the icons to white or black when the system turns dark or light.
pub fn follow_theme(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let dark = is_dark(app);
    let mut current = menu.dark.lock().unwrap();
    if *current == dark {
        return;
    }
    for (item, name) in &menu.icons {
        let _ = item.set_icon(Some(icon(name, dark)));
    }
    let _ = menu.login.set_icon(Some(icon(login_icon(*menu.login_on.lock().unwrap()), dark)));
    *current = dark;
}

/// Checks or empties the "Open at login" box after the menu line was used.
pub fn show_login(app: &AppHandle, on: bool) {
    let menu = app.state::<TrayMenu>();
    *menu.login_on.lock().unwrap() = on;
    let _ = menu.login.set_icon(Some(icon(login_icon(on), *menu.dark.lock().unwrap())));
}
