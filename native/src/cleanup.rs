use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::extra;

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
    /// The total split by what the folders hold, so the disk row can show which kind fills it.
    /// Why default: a result saved by an older version has no split, and the panel then shows the total alone.
    #[serde(default)]
    pub kinds: Vec<KindTotal>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindTotal {
    /// `cache`, `packages` (node_modules), `build`, or one of the kinds in `extra::KINDS`.
    pub kind: String,
    pub bytes: u64,
}

/// Which kind a measured folder is: package folders, build output, or a cache that fills again on use.
fn kind_of(path: &str) -> &'static str {
    if let Some(kind) = extra::kind_of(path) {
        kind
    } else if path.ends_with("/node_modules") {
        "packages"
    } else if path.ends_with("/DerivedData") || path.contains("/DerivedData/") || BUILD_FOLDERS.iter().any(|name| path.ends_with(&format!("/{name}"))) {
        "build"
    } else {
        "cache"
    }
}

fn kind_totals(candidates: &[Candidate]) -> Vec<KindTotal> {
    let mut kinds: Vec<KindTotal> = ["cache", "packages", "build"]
        .iter()
        .chain(extra::KINDS)
        .map(|kind| KindTotal {
            kind: kind.to_string(),
            bytes: candidates.iter().filter(|c| kind_of(&c.path) == *kind).map(|c| c.bytes).sum(),
        })
        .filter(|total| total.bytes > 0)
        .collect();
    kinds.sort_by_key(|total| std::cmp::Reverse(total.bytes));
    kinds
}

/// Measures every folder, writing each finished folder to `progress` so a restart picks up where it stopped.
/// Why: a full measurement takes about four minutes, and a restart in that time (every code change in a dev run,
/// a quit, a log-out) used to throw the work away, so `cleanup.json` was never written.
pub fn measure(progress: Option<&Path>) -> Cleanup {
    let Some(home) = home_dir() else {
        // Why measured_at 0: a run that cannot see the home folder measured nothing, so it must not be loaded as a result.
        return Cleanup { total: 0, top: Vec::new(), kinds: Vec::new(), measured_at: 0 };
    };
    let found = cleanable_folders(&home);

    // Why: a folder deleted since the unfinished run must not be counted from the saved progress.
    let mut wanted: Vec<String> = found.iter().map(|folder| tilde(folder, &home)).collect();
    wanted.extend(extra::KINDS.iter().map(|kind| extra::shown_path(kind).to_owned()));
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
    for kind in extra::KINDS {
        let path = extra::shown_path(kind).to_owned();
        if candidates.iter().any(|c| c.path == path) {
            continue;
        }
        candidates.push(Candidate { bytes: extra::measure(kind, &home), path });
        if let Some(file) = progress {
            write_json(file, &candidates);
        }
    }
    if let Some(file) = progress {
        let _ = fs::remove_file(file);
    }
    candidates.retain(|c| c.bytes > 0 && (extra::kind_of(&c.path).is_none() || c.bytes >= extra::MIN_SHOWN));
    candidates.sort_by_key(|c| std::cmp::Reverse(c.bytes));
    let total = candidates.iter().map(|c| c.bytes).sum();
    let kinds = kind_totals(&candidates);
    candidates.truncate(TOP);
    Cleanup { total, top: candidates, kinds, measured_at: now() }
}

const DERIVED_DATA: &str = "Library/Developer/Xcode/DerivedData";

/// Every folder Monitor counts as cleanable: the fixed caches, then build and package folders under ~/git.
/// The kinds in `extra` are measured by their own rules after these.
fn cleanable_folders(home: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = [
        "Library/Caches",
        "Library/pnpm/store",
        ".npm",
        ".cache",
    ]
    .iter()
    .map(|p| home.join(p))
    .filter(|p| p.is_dir())
    .collect();
    // Why one entry per project: a project built yesterday used to keep the whole folder, so the panel offered 30 GB
    // and emptying freed nothing. Each project folder is now kept or deleted on its own.
    if let Ok(entries) = fs::read_dir(home.join(DERIVED_DATA)) {
        found.extend(entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()));
    }
    find_build_folders(&home.join("git"), 0, &mut found);
    found
}

/// What emptying one kind did: bytes freed, and the parts left alone with their size and why.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Emptied {
    pub freed: u64,
    /// How many parts were left.
    pub skipped: u32,
    /// Bytes the left parts take.
    pub kept: u64,
    /// `recent` (used within `KEEP_RECENT_DAYS`) or `inUse` (running or on screen); none when nothing was left.
    pub kept_reason: Option<&'static str>,
}

impl Emptied {
    pub(crate) fn keep(&mut self, bytes: u64, reason: &'static str) {
        self.skipped += 1;
        self.kept += bytes;
        self.kept_reason = Some(reason);
    }
}

/// Inside these cache folders each version is its own entry (`chromium-1228`, `chromium-1248`), so the browsers a
/// test run still uses stay and older versions go.
const TEST_BROWSERS: &[&str] = &["ms-playwright", "puppeteer"];

/// Build and package folders touched within this many days are kept, so a project someone works on keeps building.
pub const KEEP_RECENT_DAYS: u64 = 7;

/// Deletes the folders of one kind, without the Trash, since only deleting frees the space.
/// Caches keep their folder and lose what is inside; build and package folders go whole. In both, what was used within
/// `KEEP_RECENT_DAYS` stays: a running build or an open project still needs it, and a cache in use (the pnpm store,
/// a test browser, uv) would only be downloaded again by the next install or test run.
pub fn empty(kind: &str) -> Emptied {
    let mut done = Emptied::default();
    let Some(home) = home_dir() else { return done };
    if extra::KINDS.contains(&kind) {
        return extra::empty(kind, &home);
    }
    let keep_after = now().saturating_sub(KEEP_RECENT_DAYS * 86_400);
    for folder in cleanable_folders(&home) {
        if kind_of(&tilde(&folder, &home)) != kind {
            continue;
        }
        if kind == "cache" {
            for entry in cache_entries(&folder) {
                if last_used(&entry) > keep_after {
                    done.keep(size_of(&entry), "recent");
                } else {
                    done.freed += remove(&entry);
                }
            }
        } else if last_used(&folder) > keep_after {
            done.keep(folder_size(&folder), "recent");
        } else {
            done.freed += remove(&folder);
        }
    }
    done
}

/// What a cache folder is emptied by: the things right inside it, except that a test-browser folder is opened one
/// level further so each browser version is judged on its own.
fn cache_entries(folder: &Path) -> Vec<PathBuf> {
    let mut entries = Vec::new();
    let Ok(inside) = fs::read_dir(folder) else { return entries };
    for entry in inside.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if TEST_BROWSERS.contains(&name.to_string_lossy().as_ref()) && path.is_dir() {
            entries.extend(fs::read_dir(&path).into_iter().flatten().flatten().map(|inner| inner.path()));
        } else {
            entries.push(path);
        }
    }
    entries
}

fn size_of(path: &Path) -> u64 {
    match path.symlink_metadata() {
        Ok(meta) if meta.is_dir() => folder_size(path),
        Ok(meta) => disk_bytes(&meta),
        Err(_) => 0,
    }
}

/// Removes a file or folder and returns the space it took. Errors (a file the system protects) leave that part in place.
pub(crate) fn remove(path: &Path) -> u64 {
    let Ok(meta) = path.symlink_metadata() else { return 0 };
    if meta.is_dir() {
        let size = folder_size(path);
        // Why: a folder that could only partly go still freed part of its size, so measure what is left.
        if fs::remove_dir_all(path).is_ok() { size } else { size.saturating_sub(folder_size(path)) }
    } else {
        let size = disk_bytes(&meta);
        if fs::remove_file(path).is_ok() { size } else { 0 }
    }
}

/// The newest change time of a folder and the folders right inside it (`target/debug`, `node_modules/.pnpm`),
/// as Unix seconds. Why: a build writes below the top folder, so the top folder's own time alone looks old.
fn last_used(folder: &Path) -> u64 {
    let modified = |path: &Path| {
        path.metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_secs())
    };
    let children = fs::read_dir(folder).into_iter().flatten().flatten().filter(|entry| entry.path().is_dir());
    children.map(|entry| modified(&entry.path())).chain([modified(folder)]).max().unwrap_or(0)
}

/// The last result saved in `file`. Why: measuring takes minutes, so a restart shows the saved numbers instead of "measuring".
/// An empty result counts too: a clean computer used to throw it away and walk the whole disk again on every start.
/// Only a result without a time is refused (an older version saved `{"total":0,"top":[]}` when it could not see the
/// home folder).
pub fn load(file: &Path) -> Option<Cleanup> {
    let saved: Cleanup = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    (saved.measured_at > 0).then_some(saved)
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
pub(crate) fn folder_size(dir: &Path) -> u64 {
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
pub(crate) fn disk_bytes(meta: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    // Why: blocks match what `du` and Finder report; length overcounts sparse files and undercounts tiny ones.
    meta.blocks() * 512
}

#[cfg(not(unix))]
pub(crate) fn disk_bytes(meta: &fs::Metadata) -> u64 {
    meta.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_folders_into_kinds() {
        assert_eq!(kind_of("~/git/acme/web/node_modules"), "packages");
        assert_eq!(kind_of("~/git/acme/app/target"), "build");
        assert_eq!(kind_of("~/git/acme/app/dist.noindex"), "build");
        assert_eq!(kind_of("~/Library/Developer/Xcode/DerivedData"), "build");
        assert_eq!(kind_of("~/Library/Developer/Xcode/DerivedData/Monitor-abcdef"), "build");
        assert_eq!(kind_of("~/Library/Caches"), "cache");
        assert_eq!(kind_of("~/Library/pnpm/store"), "cache");
    }

    #[test]
    fn remove_returns_the_space_it_freed() {
        let dir = std::env::temp_dir().join(format!("monitor-remove-{}", std::process::id()));
        fs::create_dir_all(dir.join("inner")).unwrap();
        fs::write(dir.join("inner/file"), vec![0u8; 64 * 1024]).unwrap();
        let size = folder_size(&dir);
        assert!(size >= 64 * 1024);
        assert_eq!(remove(&dir), size);
        assert!(!dir.exists());
    }

    #[test]
    fn test_browser_versions_are_judged_one_by_one() {
        let dir = std::env::temp_dir().join(format!("monitor-caches-{}", std::process::id()));
        fs::create_dir_all(dir.join("ms-playwright/chromium-1228")).unwrap();
        fs::create_dir_all(dir.join("ms-playwright/chromium-1248")).unwrap();
        fs::create_dir_all(dir.join("com.example.app")).unwrap();
        let mut entries: Vec<String> =
            cache_entries(&dir).iter().map(|p| p.strip_prefix(&dir).unwrap().display().to_string()).collect();
        entries.sort();
        assert_eq!(entries, ["com.example.app", "ms-playwright/chromium-1228", "ms-playwright/chromium-1248"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_empty_measurement_is_loaded_again() {
        let file = std::env::temp_dir().join(format!("monitor-empty-{}.json", std::process::id()));
        save(&file, &Cleanup { total: 0, top: Vec::new(), kinds: Vec::new(), measured_at: 1 });
        assert!(load(&file).is_some());
        save(&file, &Cleanup { total: 0, top: Vec::new(), kinds: Vec::new(), measured_at: 0 });
        assert!(load(&file).is_none());
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn a_folder_just_written_counts_as_recently_used() {
        let dir = std::env::temp_dir().join(format!("monitor-used-{}", std::process::id()));
        fs::create_dir_all(dir.join("debug")).unwrap();
        assert!(last_used(&dir) + 60 > now());
        let _ = fs::remove_dir_all(&dir);
    }
}
