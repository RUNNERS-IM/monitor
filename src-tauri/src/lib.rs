mod i18n;
mod snapshot;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use snapshot::{Sampler, Snapshot};
use i18n::t;
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};

const TRAY_ID: &str = "monitor";
const ISSUES_URL: &str = "https://github.com/RUNNERS-IM/monitor/issues";
const REFRESH: Duration = Duration::from_secs(3);
// Why: the tray click that opens the panel also sends it a focus-lost event right away, so blur is ignored this long after opening.
const BLUR_GRACE: Duration = Duration::from_millis(400);

#[derive(Default)]
struct PanelShownAt(Mutex<Option<Instant>>);

/// Whether the OS blurs what is behind the panel; the page draws a solid background when it does not.
struct Translucent(bool);

#[tauri::command]
fn translucent(state: State<'_, Translucent>) -> bool {
    state.0
}

/// macOS gets the same blur as Control Center, Windows gets Acrylic, Linux has no blur and stays solid.
fn apply_blur(window: &tauri::WebviewWindow) -> bool {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};
        return window_vibrancy::apply_vibrancy(
            window,
            NSVisualEffectMaterial::Popover,
            Some(NSVisualEffectState::Active),
            Some(14.0),
        )
        .is_ok();
    }
    #[cfg(target_os = "windows")]
    {
        return window_vibrancy::apply_acrylic(window, None).is_ok();
    }
    #[allow(unreachable_code)]
    {
        let _ = window;
        false
    }
}

#[tauri::command]
fn snapshot(sampler: State<'_, Mutex<Sampler>>) -> Snapshot {
    sampler.lock().unwrap().sample()
}

fn toggle_panel(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    // Why: the tray sits top-right on macOS and bottom-right on Windows; TrayCenter follows it on every OS.
    let _ = window.move_window(Position::TrayCenter);
    *app.state::<PanelShownAt>().0.lock().unwrap() = Some(Instant::now());
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PanelShownAt::default())
        .manage(Mutex::new(Sampler::new().expect("failed to open system counters")))
        .invoke_handler(tauri::generate_handler![snapshot, translucent])
        .setup(|app| {
            // Why: Monitor lives in the tray only, so it should not take a Dock slot on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let panel = app.get_webview_window("main").expect("main window is declared in tauri.conf.json");
            app.manage(Translucent(apply_blur(&panel)));

            // Why: Split, Prompt and Monitor share this menu order: about, updates, app feature, settings, help, quit.
            let about = PredefinedMenuItem::about(
                app,
                Some(&t("menu.about", &[])),
                Some(
                    AboutMetadataBuilder::new()
                        .name(Some("Monitor"))
                        .version(Some(app.package_info().version.to_string()))
                        .copyright(Some("RUNNERS"))
                        .build(),
                ),
            )?;
            // Why: there is no updater or settings screen yet, so these stay visible but disabled to keep the shared order.
            let updates = MenuItem::with_id(app, "updates", t("menu.checkUpdates", &[]), false, None::<&str>)?;
            let usage = MenuItem::with_id(app, "usage", t("menu.showUsage", &[]), true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", t("menu.settings", &[]), false, Some("CmdOrCtrl+,"))?;
            let help = MenuItem::with_id(app, "help", t("menu.help", &[]), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", t("menu.quit", &[]), true, Some("CmdOrCtrl+Q"))?;
            let menu = Menu::with_items(
                app,
                &[
                    &about,
                    &updates,
                    &PredefinedMenuItem::separator(app)?,
                    &usage,
                    &PredefinedMenuItem::separator(app)?,
                    &settings,
                    &help,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;
            let tray = TrayIconBuilder::with_id(TRAY_ID);
            // Why: on macOS the menu bar shows only the memory number, like Stats; other trays need a picture to be visible.
            #[cfg(not(target_os = "macos"))]
            let tray = tray.icon(app.default_window_icon().unwrap().clone());
            tray.tooltip("Monitor")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "usage" => toggle_panel(app),
                    "help" => {
                        let _ = app.opener().open_url(ISSUES_URL, None::<&str>);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_panel(tray.app_handle());
                    }
                })
                .build(app)?;

            // Why: the tray text is the at-a-glance view, so it refreshes even while the panel is closed.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                let snap = handle.state::<Mutex<Sampler>>().lock().unwrap().sample();
                if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                    let text = format!("{}%", snap.memory_percent().round());
                    let _ = tray.set_title(Some(&text));
                    let _ = tray.set_tooltip(Some(&t("tray.tooltip", &[("value", &text)])));
                }
                std::thread::sleep(REFRESH);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Why: the panel behaves like a tray popup and closes as soon as focus moves elsewhere.
            if let WindowEvent::Focused(false) = event {
                let shown_at = *window.state::<PanelShownAt>().0.lock().unwrap();
                if shown_at.is_some_and(|at| at.elapsed() < BLUR_GRACE) {
                    return;
                }
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
