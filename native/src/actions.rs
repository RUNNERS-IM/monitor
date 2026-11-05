//! Things the panel can do to this computer when it is slow. Only ever run by a button press.

use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{Pid, ProcessStatus, ProcessesToUpdate, System};

use crate::snapshot::{runners_home, service_plist, AppUse, QuitKind, Runner};

pub const RUNNER_PAUSE: Duration = Duration::from_secs(60 * 60);

/// What happened after Quit: whether everything ended within `QUIT_WAIT`, and what was not asked.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuitReport {
    pub gone: bool,
    /// Processes that had ended on their own before the signal reached them.
    pub already_gone: u32,
    /// Processes the signal could not be sent to, with the reason.
    pub failed: Vec<String>,
}

// Why: a program cleans up within a second or two; one still running after this is likely asking to save.
const QUIT_WAIT: Duration = Duration::from_secs(3);

/// Asks an app to quit the way ⌘Q does, so it can save work first, or sends a dev server SIGTERM. Never force-kills.
/// Every process is asked even when one fails, then it waits up to `QUIT_WAIT` to see whether they ended.
pub fn quit_app(app: &AppUse) -> Result<QuitReport, String> {
    let kind = app.quit.ok_or_else(|| format!("{} cannot be quit from Monitor", app.name))?;
    let mut report = QuitReport { gone: false, already_gone: 0, failed: Vec::new() };
    #[cfg(target_os = "macos")]
    if let (QuitKind::App, Some(id)) = (kind, &app.bundle_id) {
        quit_mac_app(id)?;
        report.gone = wait_gone(&app.pids);
        return Ok(report);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = kind;
    for pid in &app.pids {
        match terminate(pid.as_u32()) {
            Ok(()) => {}
            #[cfg(unix)]
            Err(e) if e.raw_os_error() == Some(libc::ESRCH) => report.already_gone += 1,
            Err(e) => report.failed.push(format!("{pid}: {e}")),
        }
    }
    if report.failed.len() == app.pids.len() {
        return Err(report.failed.join(", "));
    }
    report.gone = wait_gone(&app.pids);
    Ok(report)
}

/// Waits up to `QUIT_WAIT` for every process to end.
fn wait_gone(pids: &[Pid]) -> bool {
    let started = Instant::now();
    let Ok(mut system) = System::new() else { return false };
    loop {
        system.refresh_processes(ProcessesToUpdate::Some(pids), true);
        // Why: an ended process stays a zombie until its parent collects it, but it no longer holds memory.
        let running = pids.iter().any(|pid| system.process(*pid).is_some_and(|p| p.status() != ProcessStatus::Zombie));
        if !running {
            return true;
        }
        if started.elapsed() >= QUIT_WAIT {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(target_os = "macos")]
fn quit_mac_app(id: &str) -> Result<(), String> {
    // Why: the bundle id names exactly this app even when two apps share a display name. Not waiting for the app's
    // answer keeps the button from hanging while the app asks whether to save.
    let script = format!("ignoring application responses\ntell application id \"{}\" to quit\nend ignoring", id.replace('"', ""));
    run(Command::new("osascript").arg("-e").arg(script))
}

#[cfg(unix)]
fn terminate(pid: u32) -> std::io::Result<()> {
    // Why: SIGTERM lets a program clean up and exit; SIGKILL could lose work, so it is never used.
    if unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn terminate(pid: u32) -> std::io::Result<()> {
    // Why: taskkill without /F sends a close request, the Windows counterpart of SIGTERM.
    run(Command::new("taskkill").arg("/PID").arg(pid.to_string())).map_err(std::io::Error::other)
}

/// Stops a runner's launchd job and starts it again after `RUNNER_PAUSE`. Returns the Unix time it comes back.
///
/// The restart is a separate `sh` process, so it still happens when Monitor quits; it is lost only if the
/// computer restarts or logs out within the hour, and then launchd starts the runner at login anyway.
#[cfg(target_os = "macos")]
pub fn pause_runner(runner: &Runner) -> Result<u64, String> {
    if runner.off {
        return Err(format!("{} is turned off on this computer", runner.name));
    }
    // Why: `svc.sh install` writes the plist path into `.service`; reading it avoids guessing launchd labels.
    let (plist, label) =
        service_plist(&runner.dir).ok_or_else(|| format!("{} is not installed as a service", runner.name))?;
    let domain = format!("gui/{}", unsafe { libc::getuid() });

    run(Command::new("launchctl").arg("bootout").arg(format!("{domain}/{label}")))?;
    let mut restart = Command::new("/bin/sh");
    // Why: someone may turn the runner off (`launchctl disable`) during the hour; starting it then would undo that.
    restart
        .arg("-c")
        .arg("sleep \"$1\"; launchctl print-disabled \"$2\" | grep -qF \"\\\"$4\\\" => disabled\" || launchctl bootstrap \"$2\" \"$3\"")
        .arg("sh")
        .arg(RUNNER_PAUSE.as_secs().to_string())
        .arg(&domain)
        .arg(&plist)
        .arg(&label);
    // Why: its own process group keeps it alive when Monitor quits and its group is signalled.
    std::os::unix::process::CommandExt::process_group(&mut restart, 0);
    let mut child = restart.spawn().map_err(|e| e.to_string())?;
    std::thread::spawn(move || child.wait());

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    Ok((now + RUNNER_PAUSE).as_secs())
}

/// Starts a paused runner now instead of waiting out the hour. The sleeping restart later finds it running and does nothing.
#[cfg(target_os = "macos")]
pub fn resume_runner(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.starts_with('.') {
        return Err(format!("no runner named {name}"));
    }
    let dir = runners_home().ok_or("no home folder")?.join(name);
    let (plist, _) = service_plist(&dir).ok_or_else(|| format!("{name} is not installed as a service"))?;
    let domain = format!("gui/{}", unsafe { libc::getuid() });
    run(Command::new("launchctl").arg("bootstrap").arg(domain).arg(plist))
}

#[cfg(not(target_os = "macos"))]
pub fn resume_runner(name: &str) -> Result<(), String> {
    Err(format!("resuming {name} is only supported on macOS for now"))
}

#[cfg(not(target_os = "macos"))]
pub fn pause_runner(runner: &Runner) -> Result<u64, String> {
    Err(format!("pausing {} is only supported on macOS for now", runner.name))
}

fn run(command: &mut Command) -> Result<(), String> {
    let out = command.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::snapshot::AppKind;

    fn server(pids: Vec<Pid>) -> AppUse {
        AppUse {
            name: "vite".into(),
            cpu_percent: 0.0,
            memory: 0,
            quit: Some(QuitKind::Process),
            kind: AppKind::DevServer,
            bundle_id: None,
            quittable: true,
            sessions: None,
            folder: None,
            running_secs: None,
            pids,
            bundle: None,
        }
    }

    #[test]
    fn quits_every_process_even_when_one_already_ended() {
        let mut running = Command::new("sleep").arg("30").spawn().unwrap();
        let mut ended = Command::new("true").spawn().unwrap();
        ended.wait().unwrap();
        let pids = vec![Pid::from_u32(ended.id()), Pid::from_u32(running.id())];
        let report = quit_app(&server(pids)).unwrap();
        assert!(report.gone);
        assert_eq!(report.already_gone, 1);
        assert!(report.failed.is_empty());
        running.wait().unwrap();
    }

    #[test]
    fn says_still_running_when_the_program_ignores_the_signal() {
        let mut stubborn = Command::new("/bin/sh").arg("-c").arg("trap '' TERM; sleep 6").spawn().unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let report = quit_app(&server(vec![Pid::from_u32(stubborn.id())])).unwrap();
        assert!(!report.gone);
        stubborn.kill().unwrap();
        stubborn.wait().unwrap();
    }

    #[test]
    fn refuses_an_entry_without_quit() {
        let mut app = server(Vec::new());
        app.quit = None;
        assert!(quit_app(&app).is_err());
    }
}
