use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Folders that only hold things a build or package manager can make again, so they are safe places to free disk.
const BUILD_FOLDERS: &[&str] = &["node_modules", "target", "target.noindex", "build.noindex", "dist.noindex"];
// Why: projects sit at ~/git/<org>/<repo>, so four levels reach a repo's own build folders without crawling the whole tree.
const MAX_DEPTH: usize = 4;
const TOP: usize = 3;

/// What could be cleaned on this computer. Measured rarely because walking big folders takes minutes.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub total: u64,
    pub top: Vec<Candidate>,
    /// Unix time of the measurement, so a saved result knows how old it is.
    #[serde(default)]
    pub measured_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Path with the home folder written as `~`.
    pub path: String,
    pub bytes: u64,
}

/// Measures every folder, writing each finished folder to `progress` so a restart picks up where it stopped.
/// Why: a full measurement takes about four minutes, and a restart in that time (every code change in a dev run,
/// a quit, a log-out) used to throw the work away, so `cleanup.json` was never written.
pub fn measure(progress: Option<&Path>) -> Cleanup {
    let Some(home) = home_dir() else {
        return Cleanup { total: 0, top: Vec::new(), measured_at: now() };
    };
    let mut found: Vec<PathBuf> = [
        "Library/Developer/Xcode/DerivedData",
        "Library/Caches",
        "Library/pnpm/store",
        ".npm",
        ".cache",
    ]
    .iter()
    .map(|p| home.join(p))
    .filter(|p| p.is_dir())
    .collect();
    find_build_folders(&home.join("git"), 0, &mut found);

    // Why: a folder deleted since the unfinished run must not be counted from the saved progress.
    let wanted: Vec<String> = found.iter().map(|folder| tilde(folder, &home)).collect();
    let mut candidates: Vec<Candidate> = progress.and_then(load_progress).unwrap_or_default();
    candidates.retain(|c| wanted.contains(&c.path));
    for folder in found {
        let path = tilde(&folder, &home);
        if candidates.iter().any(|c| c.path == path) {
            continue;
        }
        candidates.push(Candidate { bytes: folder_size(&folder), path });
        if let Some(file) = progress {
            write_json(file, &candidates);
        }
    }
    if let Some(file) = progress {
        let _ = fs::remove_file(file);
    }
    candidates.retain(|c| c.bytes > 0);
    candidates.sort_by_key(|c| std::cmp::Reverse(c.bytes));
    let total = candidates.iter().map(|c| c.bytes).sum();
    candidates.truncate(TOP);
    Cleanup { total, top: candidates, measured_at: now() }
}

/// The last result saved in `file`. Why: measuring takes minutes, so a restart shows the saved numbers instead of "measuring".
pub fn load(file: &Path) -> Option<Cleanup> {
    serde_json::from_slice(&fs::read(file).ok()?).ok()
}

pub fn save(file: &Path, cleanup: &Cleanup) {
    write_json(file, cleanup);
}

/// Folders already measured by a run that did not finish.
fn load_progress(file: &Path) -> Option<Vec<Candidate>> {
    serde_json::from_slice(&fs::read(file).ok()?).ok()
}

/// Writes through a temporary file so a restart in the middle never leaves half a file behind.
fn write_json<T: Serialize + ?Sized>(file: &Path, value: &T) {
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let Ok(json) = serde_json::to_vec(value) else { return };
    let temp = file.with_extension("tmp");
    if fs::write(&temp, json).is_ok() {
        let _ = fs::rename(&temp, file);
    }
}

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// Lowers this thread's CPU and disk priority so measuring never makes the computer feel slower.
pub fn run_in_background() {
    #[cfg(target_os = "macos")]
    unsafe {
        libc::setpriority(libc::PRIO_DARWIN_THREAD, 0, libc::PRIO_DARWIN_BG);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    unsafe {
        libc::nice(19);
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn tilde(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

fn find_build_folders(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if !kind.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if BUILD_FOLDERS.contains(&name.as_ref()) {
            found.push(entry.path());
        } else if !name.starts_with('.') {
            find_build_folders(&entry.path(), depth + 1, found);
        }
    }
}

/// Space a folder takes on disk. Symbolic links are not followed, so nothing is counted twice through a link.
fn folder_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.path().symlink_metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += disk_bytes(&meta);
            }
        }
    }
    total
}

#[cfg(unix)]
fn disk_bytes(meta: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    // Why: blocks match what `du` and Finder report; length overcounts sparse files and undercounts tiny ones.
    meta.blocks() * 512
}

#[cfg(not(unix))]
fn disk_bytes(meta: &fs::Metadata) -> u64 {
    meta.len()
}
