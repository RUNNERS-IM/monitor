mod about;
mod actions;
mod bars;
mod cleanup;
#[cfg(debug_assertions)]
mod demo;
mod i18n;
mod login;
mod menu;
mod snapshot;
mod update;

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use cleanup::Cleanup;
use snapshot::{Runner, Sampler, Snapshot};
use i18n::t;
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, PhysicalPosition, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};

const TRAY_ID: &str = "monitor";
const ISSUES_URL: &str = "https://github.com/RUNNERS-IM/monitor/issues";
const REFRESH: Duration = Duration::from_secs(3);
const CLEANUP_EVERY: Duration = Duration::from_secs(30 * 60);
const CLEANUP_FILE: &str = "cleanup.json";
const CLEANUP_PROGRESS_FILE: &str = "cleanup-progress.json";
// Why: a slow computer stays slow for a while, so the same warning is repeated at most this often.
const SLOW_NOTICE_EVERY: Duration = Duration::from_secs(30 * 60);
const NOTICE_APPS: usize = 2;
// Why: the tray click that opens the panel also sends it a focus-lost event right away, so blur is ignored this long after opening.
const BLUR_GRACE: Duration = Duration::from_millis(400);
// Why: the bars glide to each new reading and then stop, so the picture costs nothing between readings.
const BARS_ANIMATION: Duration = Duration::from_millis(450);
const BARS_FRAMES: u32 = 14;
// Why: macOS uses the picture as a template (only its shape counts) and tints it for a dark or light menu bar.
// Windows and Linux show the colour as drawn; white suits the usual dark taskbar, a light Linux panel may hide it.
#[cfg(target_os = "macos")]
const BARS_COLOR: [u8; 3] = [0, 0, 0];
#[cfg(not(target_os = "macos"))]
const BARS_COLOR: [u8; 3] = [255, 255, 255];

#[derive(Default)]
struct PanelShownAt(Mutex<Option<Instant>>);

/// The panel opened by itself because the computer turned slow.
#[derive(Default)]
struct Popup(Mutex<PopupState>);

#[derive(Default)]
struct PopupState {
    open: bool,
    /// Reasons the open popup is about, so closing it silences exactly those.
    showing: HashSet<&'static str>,
    last_shown: HashMap<&'static str, Instant>,
    /// Closed by the user; not shown again until that reason has cleared once.
    dismissed: HashSet<&'static str>,
}

/// Whether the OS blurs what is behind the panel; the page draws a solid background when it does not.
struct Translucent(bool);

#[tauri::command]
fn translucent(state: State<'_, Translucent>) -> bool {
    state.0
}

/// macOS gets the same blur as Control Center, Windows gets Acrylic, Linux has no blur and stays solid.
/// `radius` rounds the blur for the borderless panel; a window with a title bar passes `None`.
pub(crate) fn apply_blur(window: &tauri::WebviewWindow, radius: Option<f64>) -> bool {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};
        return window_vibrancy::apply_vibrancy(
            window,
            NSVisualEffectMaterial::Popover,
            Some(NSVisualEffectState::Active),
            radius,
        )
        .is_ok();
    }
    #[cfg(target_os = "windows")]
    {
        return window_vibrancy::apply_acrylic(window, None).is_ok();
    }
    #[allow(unreachable_code)]
    {
        let _ = (window, radius);
        false
    }
}

/// Dark or light forced by `MONITOR_THEME=dark|light` in a debug run, so both looks can be captured
/// without changing the system setting. Always `None` in a release build.
pub(crate) fn debug_theme() -> Option<tauri::Theme> {
    #[cfg(debug_assertions)]
    {
        return match std::env::var("MONITOR_THEME").ok().as_deref() {
            Some("dark") => Some(tauri::Theme::Dark),
            Some("light") => Some(tauri::Theme::Light),
            _ => None,
        };
    }
    #[allow(unreachable_code)]
    None
}

/// Debug runs only: `MONITOR_OPEN=panel|about` opens that window at launch, so it can be captured
/// without clicking the tray. The panel opens like the slow-computer popup (no focus), so it stays up.
#[cfg(debug_assertions)]
fn debug_open(app: &tauri::AppHandle) {
    if let (Some(theme), Some(panel)) = (debug_theme(), app.get_webview_window("main")) {
        let _ = panel.set_theme(Some(theme));
    }
    let Ok(which) = std::env::var("MONITOR_OPEN") else {
        return;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        // Why: the tray icon needs a moment before it reports where it sits.
        std::thread::sleep(Duration::from_millis(1500));
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || match which.as_str() {
            "about" => about::show(&app),
            "panel" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focusable(false);
                    place_under_tray(&app, &window);
                    let _ = window.show();
                }
            }
            _ => {}
        });
    });
}

/// The newest reading. Why: one thread samples for both the tray and the panel, so opening the panel
/// does not take extra readings that would cut CPU averages short and double the history.
#[derive(Default)]
struct Latest(Mutex<Option<Snapshot>>);

#[derive(Default)]
struct LatestCleanup(Mutex<Option<Cleanup>>);

/// Runners paused from the panel, by name, with the Unix time they come back.
/// Why: a paused runner has no process, so without this it would simply vanish from the list.
#[derive(Default)]
struct PausedRunners(Mutex<HashMap<String, u64>>);

#[tauri::command]
fn snapshot(app: tauri::AppHandle, latest: State<'_, Latest>, paused: State<'_, PausedRunners>) -> Option<Snapshot> {
    let mut snap = latest.0.lock().unwrap().clone()?;
    snap.popup = app.state::<Popup>().0.lock().unwrap().open;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let mut paused = paused.0.lock().unwrap();
    paused.retain(|_, until| *until > now);
    for (name, until) in paused.iter() {
        match snap.runners.iter_mut().find(|r| &r.name == name) {
            Some(runner) => runner.paused_until = Some(*until),
            None => snap.runners.push(Runner { name: name.clone(), busy: false, paused_until: Some(*until), dir: Default::default() }),
        }
    }
    snap.runners.sort_by(|a, b| a.name.cmp(&b.name));
    #[cfg(debug_assertions)]
    if demo::enabled() {
        demo::apply(&mut snap);
    }
    Some(snap)
}

#[tauri::command]
fn quit_app(name: String, latest: State<'_, Latest>) -> Result<(), String> {
    let app = latest
        .0
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|snap| snap.top_cpu.iter().chain(&snap.top_memory).find(|a| a.name == name).cloned())
        .ok_or_else(|| format!("{name} is no longer running"))?;
    actions::quit_app(&app)
}

#[tauri::command]
fn pause_runner(name: String, latest: State<'_, Latest>, paused: State<'_, PausedRunners>) -> Result<(), String> {
    let runner = latest
        .0
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|snap| snap.runners.iter().find(|r| r.name == name).cloned())
        .ok_or_else(|| format!("runner {name} is not running"))?;
    let until = actions::pause_runner(&runner)?;
    paused.0.lock().unwrap().insert(name, until);
    Ok(())
}

/// Opens the panel by itself, under the tray, when the computer turns slow, with "why it is slow" on top.
/// Returns false when there is no panel to open, so the caller can fall back to a notification.
fn popup_if_slow(app: &tauri::AppHandle, snap: &Snapshot) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let reasons: [(&'static str, bool); 2] = [("memory", snap.slow_memory), ("cpu", snap.slow_cpu)];
    let popup = app.state::<Popup>();
    let mut state = popup.0.lock().unwrap();
    for (reason, slow) in reasons {
        if !slow {
            state.dismissed.remove(reason);
        }
    }
    let due: Vec<&'static str> = reasons
        .iter()
        .filter(|(reason, slow)| {
            *slow
                && !state.dismissed.contains(reason)
                && !state.last_shown.get(reason).is_some_and(|at| at.elapsed() < SLOW_NOTICE_EVERY)
        })
        .map(|(reason, _)| *reason)
        .collect();
    if due.is_empty() {
        return true;
    }
    for reason in &due {
        state.last_shown.insert(reason, Instant::now());
    }
    // Why: when the user already has the panel open they see the reasons there; nothing more to pop up.
    if window.is_visible().unwrap_or(false) {
        return true;
    }
    state.showing = due.into_iter().collect();
    state.open = true;
    drop(state);
    // Why: the popup must not take keyboard focus, or it would swallow what the user is typing in another app.
    let _ = window.set_focusable(false);
    place_under_tray(app, &window);
    let _ = window.show();
    true
}

/// Puts the panel just under the tray icon (above it on Windows), from the icon's own position.
/// Why: the positioner plugin only knows the tray position after the mouse has touched the icon, which a popup cannot wait for.
fn place_under_tray(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let rect = app.tray_by_id(TRAY_ID).and_then(|tray| tray.rect().ok().flatten());
    let (Some(rect), Ok(size), Ok(scale)) = (rect, window.outer_size(), window.scale_factor()) else {
        let _ = window.move_window(Position::TopRight);
        return;
    };
    let at = rect.position.to_physical::<f64>(scale);
    let icon = rect.size.to_physical::<f64>(scale);
    let x = at.x + icon.width / 2.0 - size.width as f64 / 2.0;
    let y = if cfg!(target_os = "windows") { at.y - size.height as f64 } else { at.y + icon.height };
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Closes a popup and keeps it closed until the computer has recovered from the same reason.
fn dismiss_popup(app: &tauri::AppHandle) {
    let popup = app.state::<Popup>();
    let mut state = popup.0.lock().unwrap();
    if !state.open {
        return;
    }
    state.open = false;
    let showing: Vec<&'static str> = state.showing.drain().collect();
    state.dismissed.extend(showing);
}

#[tauri::command]
fn close_popup(app: tauri::AppHandle) {
    dismiss_popup(&app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = window.set_focusable(true);
    }
}

/// Shows a system notification when the computer turns slow, naming the apps most likely behind it.
/// Why: kept for when there is no panel window to pop up; in a dev run macOS shows it as Terminal's notification.
fn notify_if_slow(app: &tauri::AppHandle, snap: &Snapshot, last: &mut HashMap<&'static str, Instant>) {
    let reasons: [(&'static str, bool); 2] = [("memory", snap.slow_memory), ("cpu", snap.slow_cpu)];
    for (reason, slow) in reasons {
        if !slow || last.get(reason).is_some_and(|at| at.elapsed() < SLOW_NOTICE_EVERY) {
            continue;
        }
        let apps: Vec<String> = if reason == "memory" {
            snap.top_memory.iter().take(NOTICE_APPS).map(|a| format!("{} {:.1} GB", a.name, a.memory as f64 / 1024f64.powi(3))).collect()
        } else {
            snap.top_cpu.iter().take(NOTICE_APPS).map(|a| format!("{} {}%", a.name, a.cpu_percent.round())).collect()
        };
        let _ = app
            .notification()
            .builder()
            .title(t(&format!("notice.{reason}.title"), &[]))
            .body(t("notice.body", &[("apps", &apps.join(", "))]))
            .show();
        last.insert(reason, Instant::now());
    }
}

#[tauri::command]
fn cleanup(latest: State<'_, LatestCleanup>) -> Option<Cleanup> {
    latest.0.lock().unwrap().clone()
}

fn toggle_panel(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        // Why: clicking the tray while the popup is up is the user saying "seen it".
        dismiss_popup(app);
        let _ = window.hide();
        let _ = window.set_focusable(true);
        return;
    }
    let _ = window.set_focusable(true);
    // Why: the tray sits top-right on macOS and bottom-right on Windows; TrayCenter follows it on every OS.
    let _ = window.move_window(Position::TrayCenter);
    *app.state::<PanelShownAt>().0.lock().unwrap() = Some(Instant::now());
    let _ = window.show();
    let _ = window.set_focus();
}

fn bars_image(heights: [f32; 3]) -> Image<'static> {
    Image::new_owned(bars::render(heights, BARS_COLOR), bars::SIZE, bars::SIZE)
}

/// Moves the tray bars from `shown` to the new reading over a short ease-out, then leaves them still.
/// Returns how long it took, so the sampling loop keeps its 3-second rhythm.
fn show_bars(tray: &TrayIcon, shown: &mut [f32; 3], snap: &Snapshot) -> Duration {
    let started = Instant::now();
    let target = [
        bars::bar_height(snap.cpu_percent / 100.0),
        bars::bar_height((snap.memory_percent() / 100.0) as f32),
        bars::bar_height((snap.disk_percent() / 100.0) as f32),
    ];
    let from = *shown;
    let largest = from.iter().zip(&target).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
    // Why: less than one pixel of change is not worth a moving picture; under a hundredth it is not worth redrawing at all.
    let frames = if largest * bars::SIZE as f32 / 24.0 < 1.0 { 1 } else { BARS_FRAMES };
    if largest >= 0.01 {
        for frame in 1..=frames {
            let k = bars::ease_out(frame as f32 / frames as f32);
            let heights = [0, 1, 2].map(|i| from[i] + (target[i] - from[i]) * k);
            let _ = tray.set_icon_with_as_template(Some(bars_image(heights)), true);
            if frame < frames {
                std::thread::sleep(BARS_ANIMATION / frames);
            }
        }
        *shown = target;
    }
    started.elapsed()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(PanelShownAt::default())
        .manage(Popup::default())
        .manage(Latest::default())
        .manage(LatestCleanup::default())
        .manage(PausedRunners::default())
        .invoke_handler(tauri::generate_handler![snapshot, cleanup, quit_app, pause_runner, translucent, close_popup])
        .setup(|app| {
            // Why: Monitor lives in the tray only, so it should not take a Dock slot on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let panel = app.get_webview_window("main").expect("main window is declared in tauri.conf.json");
            app.manage(Translucent(apply_blur(&panel, Some(14.0))));

            login::apply_default(app.handle());
            let menu = menu::build(app, login::is_on(app.handle()))?;
            let start = [bars::bar_height(0.0); 3];
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(bars_image(start))
                .icon_as_template(true)
                .tooltip("Monitor")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "usage" => toggle_panel(app),
                    "login" => menu::show_login(app, login::toggle(app)),
                    "about" => about::show(app),
                    "updates" => update::check_now(app),
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
            let mut sampler = Sampler::new().expect("failed to open system counters");
            let handle = app.handle().clone();
            let mut noticed = HashMap::new();
            let mut shown = start;
            std::thread::spawn(move || loop {
                let snap = sampler.sample();
                if !popup_if_slow(&handle, &snap) {
                    notify_if_slow(&handle, &snap, &mut noticed);
                }
                let mut spent = Duration::ZERO;
                if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                    let value = format!("{}%", snap.memory_percent().round());
                    // Why: the bars picture next to it says what the number is, so the title is only the memory percent.
                    let _ = tray.set_title(Some(&t("tray.title", &[("value", &value)])));
                    let _ = tray.set_tooltip(Some(&t("tray.tooltip", &[("value", &value)])));
                    spent = show_bars(&tray, &mut shown, &snap);
                }
                menu::show_usage(&handle, &snap);
                menu::show_status(&handle, &snap);
                // Why: a backup for the ThemeChanged event, which a hidden panel window may not get on every OS.
                menu::follow_theme(&handle);
                *handle.state::<Latest>().0.lock().unwrap() = Some(snap);
                std::thread::sleep(REFRESH.saturating_sub(spent));
            });

            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir().ok();
            let saved = data_dir.as_ref().map(|dir| dir.join(CLEANUP_FILE));
            let progress = data_dir.map(|dir| dir.join(CLEANUP_PROGRESS_FILE));
            std::thread::spawn(move || {
                cleanup::run_in_background();
                if let Some(found) = saved.as_deref().and_then(cleanup::load) {
                    let age = Duration::from_secs(cleanup::now().saturating_sub(found.measured_at));
                    *handle.state::<LatestCleanup>().0.lock().unwrap() = Some(found);
                    std::thread::sleep(CLEANUP_EVERY.saturating_sub(age));
                }
                loop {
                    let found = cleanup::measure(progress.as_deref());
                    if let Some(file) = &saved {
                        cleanup::save(file, &found);
                    }
                    *handle.state::<LatestCleanup>().0.lock().unwrap() = Some(found);
                    std::thread::sleep(CLEANUP_EVERY);
                }
            });
            // Why: a debug run is not a signed release build, so it has nothing to compare with or install.
            #[cfg(not(debug_assertions))]
            update::start(app.handle());
            #[cfg(debug_assertions)]
            debug_open(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::ThemeChanged(_) = event {
                menu::follow_theme(window.app_handle());
            }
            // Why: the panel behaves like a tray popup and closes as soon as focus moves elsewhere.
            // The About window is an ordinary window and stays open.
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::Focused(false) = event {
                // Why: the popup never takes focus, so a focus change elsewhere must not close it; it has its own close button.
                if window.state::<Popup>().0.lock().unwrap().open {
                    return;
                }
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
