//! Keeps Monitor up to date by itself: checks the GitHub release's `latest.json` shortly after launch and every few
//! hours, installs a newer signed build and restarts. Why: without it every fix meant reinstalling on each office Mac.

// Why: debug runs skip the background checks (lib.rs), which leaves `start` and its helpers unused there.
#![cfg_attr(debug_assertions, allow(dead_code))]

use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use crate::i18n::t;

/// Wait after launch so a login start is not slowed down by the check.
const FIRST_CHECK: Duration = Duration::from_secs(60);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// Starts the background checks. Quiet unless there is an update or an error worth telling.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio_sleep(FIRST_CHECK).await;
        loop {
            let _ = check(&app, false).await;
            tokio_sleep(CHECK_EVERY).await;
        }
    });
}

/// "Check for updates…" in the menu: same check, but also says when Monitor is already up to date.
pub fn check_now(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = check(&app, true).await {
            notify(&app, &t("update.failed", &[("error", &error)]));
        }
    });
}

async fn check(app: &AppHandle, asked: bool) -> Result<(), String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        if asked {
            notify(app, &t("update.latest", &[("version", &app.package_info().version.to_string())]));
        }
        return Ok(());
    };
    notify(app, &t("update.installing", &[("version", &update.version)]));
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    // Why: Monitor holds no unsaved work, so restarting right away is safe and puts the new build in place at once.
    app.restart();
}

fn notify(app: &AppHandle, body: &str) {
    let _ = app.notification().builder().title("Monitor").body(body).show();
}

async fn tokio_sleep(duration: Duration) {
    // Why: a plain thread sleep would block the async runtime that also serves the panel's commands.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}
