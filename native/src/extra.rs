//! Cleanable things that are not plain cache or build folders: the Trash, unused Docker images, shut-down simulators,
//! wallpaper videos, lima virtual machines and ollama models. Only part of each may go (a running simulator, the video
//! on screen, a model used last week), so each kind has its own rule, checked again right before deleting.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::cleanup::{disk_bytes, folder_size, now, remove, Emptied};

/// The kinds this file handles, in the order the panel lists them when sizes tie.
pub const KINDS: &[&str] = &["trash", "docker", "simulators", "wallpapers", "vms", "models"];

/// A virtual machine or model with no file changed in this many days counts as unused.
pub const UNUSED_DAYS: u64 = 30;

/// Why: an erased simulator or an empty Docker setup still holds a little, and a part that small is not worth a line.
pub const MIN_SHOWN: u64 = 256 * 1024 * 1024;

const WALLPAPERS: &str = "Library/Application Support/com.apple.wallpaper";
const SIMULATORS: &str = "Library/Developer/CoreSimulator/Devices";

/// The path the panel shows for a kind, with the home folder as `~`. Docker keeps its files inside its own disk image.
pub fn shown_path(kind: &str) -> &'static str {
    match kind {
        "trash" => "~/.Trash",
        "docker" => "Docker",
        "simulators" => "~/Library/Developer/CoreSimulator/Devices",
        "wallpapers" => "~/Library/Application Support/com.apple.wallpaper/aerials/videos",
        "vms" => "~/.lima",
        _ => "~/.ollama/models",
    }
}

pub fn kind_of(path: &str) -> Option<&'static str> {
    KINDS.iter().copied().find(|kind| shown_path(kind) == path)
}

/// Bytes that emptying `kind` would free now.
pub fn measure(kind: &str, home: &Path) -> u64 {
    match kind {
        "trash" if cfg!(target_os = "macos") => folder_size(&home.join(".Trash")),
        "docker" => docker_reclaimable().unwrap_or(0),
        "simulators" => simulators(home).iter().filter(|d| !d.booted).map(|d| folder_size(&d.data)).sum(),
        "wallpapers" => wallpaper_videos(home).iter().filter(|v| !v.keep).map(|v| v.bytes).sum(),
        "vms" => lima_machines(home).iter().filter(|m| m.unused && !m.running).map(|m| folder_size(&m.folder)).sum(),
        "models" if ollama_unused(home) => folder_size(&home.join(".ollama/models")),
        _ => 0,
    }
}

/// Deletes what `kind` may lose now; `skipped` counts the parts left because they were in use.
pub fn empty(kind: &str, home: &Path) -> Emptied {
    let mut done = Emptied { freed: 0, skipped: 0 };
    match kind {
        "trash" if cfg!(target_os = "macos") => done.freed = remove_inside(&home.join(".Trash")),
        "docker" => {
            let before = docker_reclaimable().unwrap_or(0);
            if let Some(docker) = docker() {
                // Why: only images and build cache no container uses; containers and volumes may hold someone's data.
                run(&docker, &["image", "prune", "-a", "-f"], 900);
                run(&docker, &["builder", "prune", "-a", "-f"], 900);
            }
            done.freed = before.saturating_sub(docker_reclaimable().unwrap_or(before));
        }
        "simulators" => {
            for device in simulators(home) {
                if device.booted {
                    done.skipped += 1;
                    continue;
                }
                let before = folder_size(&device.data);
                if run(Path::new("/usr/bin/xcrun"), &["simctl", "erase", &device.udid], 120).is_some() {
                    done.freed += before.saturating_sub(folder_size(&device.data));
                }
            }
        }
        "wallpapers" => {
            for video in wallpaper_videos(home) {
                if video.keep {
                    done.skipped += 1;
                } else {
                    done.freed += remove(&video.path);
                }
            }
        }
        "vms" => {
            for machine in lima_machines(home) {
                if machine.running {
                    done.skipped += 1;
                } else if machine.unused {
                    done.freed += remove(&machine.folder);
                }
            }
        }
        "models" => {
            if ollama_running() {
                done.skipped += 1;
            } else if ollama_unused(home) {
                done.freed = remove_inside(&home.join(".ollama/models"));
            }
        }
        _ => {}
    }
    done
}

fn remove_inside(folder: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(folder) else { return 0 };
    entries.flatten().map(|entry| remove(&entry.path())).sum()
}

/// Runs a program with no input and returns what it printed, or None when it failed or ran past `secs`.
fn run(program: &Path, args: &[&str], secs: u64) -> Option<String> {
    let mut child = Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    // Why: a long output fills the pipe and stops the program, so it is read while waiting.
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let text = reader.join().ok()?;
                return status.success().then_some(text);
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// The newest change time of any file in `folder`, as Unix seconds.
fn newest_change(folder: &Path) -> u64 {
    let mut newest = 0;
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.path().symlink_metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else if let Some(secs) = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()) {
                newest = newest.max(secs.as_secs());
            }
        }
    }
    newest
}

fn unused_since(folder: &Path) -> bool {
    newest_change(folder) < now().saturating_sub(UNUSED_DAYS * 86_400)
}

// Docker

/// The Docker command, found where Docker Desktop, OrbStack and Homebrew put it (an app does not get the shell's PATH).
fn docker() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    [
        PathBuf::from("/opt/homebrew/bin/docker"),
        PathBuf::from("/usr/local/bin/docker"),
        PathBuf::from("/usr/bin/docker"),
        home.join(".orbstack/bin/docker"),
        home.join(".docker/bin/docker"),
        PathBuf::from("/Applications/Docker.app/Contents/Resources/bin/docker"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

/// Space unused images and build cache take, or None when Docker is not installed or not running (it is never started).
fn docker_reclaimable() -> Option<u64> {
    let docker = docker()?;
    let table = run(&docker, &["system", "df", "--format", "{{.Type}}\t{{.Reclaimable}}"], 60)?;
    Some(
        table
            .lines()
            .filter_map(|line| line.split_once('\t'))
            .filter(|(kind, _)| *kind == "Images" || *kind == "Build Cache")
            .filter_map(|(_, size)| docker_size(size))
            .sum(),
    )
}

/// Reads a Docker size such as `19.4GB (80%)` or `512.3MB`. Docker counts in powers of 1000.
fn docker_size(text: &str) -> Option<u64> {
    let size = text.split_whitespace().next()?;
    let split = size.find(|c: char| c.is_ascii_alphabetic())?;
    let (number, unit) = size.split_at(split);
    let scale = match unit.to_ascii_uppercase().as_str() {
        "B" => 1.0,
        "KB" => 1e3,
        "MB" => 1e6,
        "GB" => 1e9,
        "TB" => 1e12,
        _ => return None,
    };
    Some((number.parse::<f64>().ok()? * scale).round() as u64)
}

// Simulators

struct Simulator {
    udid: String,
    data: PathBuf,
    booted: bool,
}

/// iOS simulators on this Mac. Asks `simctl` only when the simulator folder exists, since without Xcode the
/// `xcrun` stub offers to install the developer tools instead.
fn simulators(home: &Path) -> Vec<Simulator> {
    if !cfg!(target_os = "macos") || !home.join(SIMULATORS).is_dir() {
        return Vec::new();
    }
    let Some(json) = run(Path::new("/usr/bin/xcrun"), &["simctl", "list", "devices", "-j"], 30) else { return Vec::new() };
    let Ok(list) = serde_json::from_str::<serde_json::Value>(&json) else { return Vec::new() };
    let Some(runtimes) = list["devices"].as_object() else { return Vec::new() };
    runtimes
        .values()
        .filter_map(|devices| devices.as_array())
        .flatten()
        .filter_map(|device| {
            Some(Simulator {
                udid: device["udid"].as_str()?.to_owned(),
                data: PathBuf::from(device["dataPath"].as_str()?),
                booted: device["state"].as_str() != Some("Shutdown"),
            })
        })
        .collect()
}

// Wallpaper videos

struct Video {
    path: PathBuf,
    bytes: u64,
    /// The video set as wallpaper or open in some program (the one on screen now).
    keep: bool,
}

fn wallpaper_videos(home: &Path) -> Vec<Video> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let base = home.join(WALLPAPERS);
    let Ok(entries) = fs::read_dir(base.join("aerials/videos")) else { return Vec::new() };
    let files: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "mov")).collect();
    if files.is_empty() {
        return Vec::new();
    }
    let chosen = fs::read(base.join("Store/Index.plist")).map(|bytes| uuids(&bytes)).unwrap_or_default();
    let mut args = vec!["-Fn".to_owned(), "--".to_owned()];
    args.extend(files.iter().map(|p| p.display().to_string()));
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    // Why: lsof exits 1 when some files are not open, which is the usual case, so its output is read either way.
    let open = Command::new("/usr/sbin/lsof").args(&args).stdin(Stdio::null()).stderr(Stdio::null()).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    files
        .into_iter()
        .filter_map(|path| {
            let id = path.file_stem()?.to_string_lossy().to_ascii_uppercase();
            let in_use = open.lines().any(|line| line.strip_prefix('n') == Some(&path.display().to_string()));
            Some(Video { bytes: path.symlink_metadata().map(|m| disk_bytes(&m)).unwrap_or(0), keep: in_use || chosen.contains(&id), path })
        })
        .collect()
}

/// Every UUID written in `bytes`, in capitals. The wallpaper settings keep the chosen video's id inside nested data.
fn uuids(bytes: &[u8]) -> Vec<String> {
    let dash = [8, 13, 18, 23];
    bytes
        .windows(36)
        .filter(|w| w.iter().enumerate().all(|(i, b)| if dash.contains(&i) { *b == b'-' } else { b.is_ascii_hexdigit() }))
        .map(|w| String::from_utf8_lossy(w).to_ascii_uppercase())
        .collect()
}

// lima virtual machines

struct Machine {
    folder: PathBuf,
    running: bool,
    unused: bool,
}

fn lima_machines(home: &Path) -> Vec<Machine> {
    if !cfg!(unix) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(home.join(".lima")) else { return Vec::new() };
    entries
        .flatten()
        // Why: lima keeps its own settings in folders starting with `_`.
        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with(['_', '.']))
        .map(|e| {
            let folder = e.path();
            let running = fs::read_to_string(folder.join("ha.pid")).ok().and_then(|pid| pid.trim().parse().ok()).is_some_and(alive);
            Machine { unused: unused_since(&folder), running, folder }
        })
        .collect()
}

#[cfg(unix)]
fn alive(pid: i32) -> bool {
    pid > 0 && (unsafe { libc::kill(pid, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM))
}

#[cfg(not(unix))]
fn alive(_pid: i32) -> bool {
    false
}

// ollama models

fn ollama_running() -> bool {
    run(Path::new("/usr/bin/pgrep"), &["-i", "ollama"], 10).is_some()
}

/// True when ollama is not running and nothing under `~/.ollama` (models, logs, history) changed for `UNUSED_DAYS`.
fn ollama_unused(home: &Path) -> bool {
    cfg!(unix) && home.join(".ollama/models").is_dir() && unused_since(&home.join(".ollama")) && !ollama_running()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_docker_sizes() {
        assert_eq!(docker_size("19.4GB (80%)"), Some(19_400_000_000));
        assert_eq!(docker_size("512.3MB"), Some(512_300_000));
        assert_eq!(docker_size("0B"), Some(0));
        assert_eq!(docker_size("n/a"), None);
    }

    #[test]
    fn finds_uuids_in_nested_data() {
        let bytes = b"\x00bplist00\xd1assetIDa33a55d9-edea-4596-a850-6c10b54fbbb5\x00not-a-uuid";
        assert_eq!(uuids(bytes), vec!["A33A55D9-EDEA-4596-A850-6C10B54FBBB5".to_owned()]);
    }

    #[test]
    fn every_kind_has_its_own_path() {
        for kind in KINDS {
            assert_eq!(kind_of(shown_path(kind)), Some(*kind));
        }
    }

    /// A fake home folder with files whose change time is `days` ago.
    fn home_with(name: &str, files: &[(&str, usize, u64)]) -> PathBuf {
        let home = std::env::temp_dir().join(format!("monitor-extra-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        for (file, size, days) in files {
            let path = home.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, vec![1u8; *size]).unwrap();
            let when = std::time::SystemTime::now() - Duration::from_secs(days * 86_400);
            fs::File::options().write(true).open(&path).unwrap().set_modified(when).unwrap();
        }
        home
    }

    #[test]
    fn deletes_only_virtual_machines_unused_for_a_month() {
        let home = home_with("lima", &[(".lima/old/diffdisk", 1 << 20, 40), (".lima/new/diffdisk", 1 << 20, 3), (".lima/_config/user", 10, 90)]);
        assert!(measure("vms", &home) >= 1 << 20);
        let done = empty("vms", &home);
        assert!(done.freed >= 1 << 20);
        assert!(!home.join(".lima/old").exists());
        assert!(home.join(".lima/new").exists() && home.join(".lima/_config").exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keeps_the_wallpaper_video_that_is_set() {
        let set = "A33A55D9-EDEA-4596-A850-6C10B54FBBB5";
        let videos = format!("{WALLPAPERS}/aerials/videos");
        let home = home_with(
            "wallpaper",
            &[(&format!("{videos}/{set}.mov"), 4096, 0), (&format!("{videos}/0A512DA8-E0F4-4488-9E1B-1BB00D271D33.mov"), 4096, 0)],
        );
        fs::create_dir_all(home.join(WALLPAPERS).join("Store")).unwrap();
        fs::write(home.join(WALLPAPERS).join("Store/Index.plist"), format!("bplist00 assetID {}", set.to_lowercase())).unwrap();
        let done = empty("wallpapers", &home);
        assert_eq!(done.skipped, 1);
        assert!(done.freed >= 4096);
        assert!(home.join(format!("{videos}/{set}.mov")).exists());
        let _ = fs::remove_dir_all(&home);
    }
}

