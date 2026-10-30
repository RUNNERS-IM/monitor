//! "Open at login": Monitor starts with the computer so the slow-computer popup is never missed (decided default on).
//! The first release run turns it on once; after that only the menu line changes it, so turning it off sticks.

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

/// Marks that the one-time default was applied, so a later launch never turns it back on.
const DEFAULT_APPLIED: &str = "open-at-login-default";

pub fn is_on(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turns it on the first time a release build runs. Debug runs leave the login items alone.
pub fn apply_default(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let marker = dir.join(DEFAULT_APPLIED);
    if marker.exists() {
        return;
    }
    if app.autolaunch().enable().is_ok() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(marker, b"");
    }
}

/// The menu line: flips the setting and returns what it is now.
pub fn toggle(app: &AppHandle) -> bool {
    let launcher = app.autolaunch();
    let _ = if is_on(app) { launcher.disable() } else { launcher.enable() };
    is_on(app)
}
