//! Things the panel can do to this computer when it is slow. Only ever run by a button press.

use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::snapshot::{AppUse, Runner};

pub const RUNNER_PAUSE: Duration = Duration::from_secs(60 * 60);

/// Asks an app to quit the way ⌘Q does, so it can save work first. Never force-kills.
pub fn quit_app(app: &AppUse) -> Result<(), String> {
    if !app.quittable {
        return Err(format!("{} cannot be quit from Monitor", app.name));
    }
    #[cfg(target_os = "macos")]
    if let Some(bundle) = &app.bundle {
        return quit_mac_app(bundle);
    }
    for pid in &app.pids {
        terminate(pid.as_u32())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn quit_mac_app(bundle: &Path) -> Result<(), String> {
    // Why: the bundle id names exactly this app even when two apps share a display name.
    let id = Command::new("defaults")
        .arg("read")
        .arg(bundle.join("Contents/Info"))
        .arg("CFBundleIdentifier")
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .ok_or_else(|| format!("no bundle id in {}", bundle.display()))?;
    let script = format!("tell application id \"{}\" to quit", id.replace('"', ""));
    run(Command::new("osascript").arg("-e").arg(script))
}

#[cfg(unix)]
fn terminate(pid: u32) -> Result<(), String> {
    // Why: SIGTERM lets a program clean up and exit; SIGKILL could lose work, so it is never used.
    if unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}

#[cfg(windows)]
fn terminate(pid: u32) -> Result<(), String> {
    // Why: taskkill without /F sends a close request, the Windows counterpart of SIGTERM.
    run(Command::new("taskkill").arg("/PID").arg(pid.to_string()))
}

/// Stops a runner's launchd job and starts it again after `RUNNER_PAUSE`. Returns the Unix time it comes back.
///
/// The restart is a separate `sh` process, so it still happens when Monitor quits; it is lost only if the
/// computer restarts or logs out within the hour, and then launchd starts the runner at login anyway.
#[cfg(target_os = "macos")]
pub fn pause_runner(runner: &Runner) -> Result<u64, String> {
    // Why: `svc.sh install` writes the plist path into `.service`; reading it avoids guessing launchd labels.
    let plist = std::fs::read_to_string(runner.dir.join(".service"))
        .map_err(|e| format!("{} is not installed as a service: {e}", runner.name))?;
    let plist = plist.trim();
    let label = Path::new(plist)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .ok_or("bad .service file")?;
    let domain = format!("gui/{}", unsafe { libc::getuid() });

    run(Command::new("launchctl").arg("bootout").arg(format!("{domain}/{label}")))?;
    let mut restart = Command::new("/bin/sh");
    restart
        .arg("-c")
        .arg("sleep \"$1\"; launchctl bootstrap \"$2\" \"$3\"")
        .arg("sh")
        .arg(RUNNER_PAUSE.as_secs().to_string())
        .arg(&domain)
        .arg(plist);
    // Why: its own process group keeps it alive when Monitor quits and its group is signalled.
    std::os::unix::process::CommandExt::process_group(&mut restart, 0);
    let mut child = restart.spawn().map_err(|e| e.to_string())?;
    std::thread::spawn(move || child.wait());

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    Ok((now + RUNNER_PAUSE).as_secs())
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
