use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Disks, Pid, Process, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind};

/// About ten minutes of readings at the 3 second interval.
const HISTORY_LEN: usize = 200;
const TOP_APPS: usize = 4;
// Why: an idle claude still wakes up now and then, so only a steady average above this (percent of one core)
// over the last 30 seconds (10 readings) counts as working, when the session file does not say.
const CLAUDE_BUSY_CPU: f32 = 5.0;
const CLAUDE_CPU_READINGS: usize = 10;
/// Compilers, linkers and build daemons. Quitting one breaks a build another session is running.
const BUILD_TOOLS: &[&str] = &[
    "clang", "clang++", "cc", "c++", "cc1", "cc1plus", "ld", "ld64", "ld.lld", "lld", "swift-frontend", "swiftc",
    "swift-build", "xcodebuild", "xcbbuildservice", "rustc", "cargo", "java", "gradle", "kotlin-daemon", "go",
];
// Why: a Runner.Worker is started a few processes below its Runner.Listener, never deeper than this.
const MAX_PARENT_HOPS: usize = 10;
// Why: a short spike is normal; the computer feels slow when the CPU stays this busy for a minute (20 readings).
const SLOW_CPU: f32 = 80.0;
const SLOW_CPU_READINGS: usize = 20;
/// Processes the OS needs to keep running; quitting them would log the user out or hang the computer.
const SYSTEM_PROCESSES: &[&str] = &[
    "kernel_task", "launchd", "windowserver", "loginwindow", "dock", "finder", "systemuiserver",
    "controlcenter", "coreaudiod", "mds", "mds_stores", "mdworker", "mdworker_shared", "mdsync",
    "system", "system idle process", "csrss", "wininit", "winlogon", "services", "lsass", "dwm",
    "explorer", "systemd", "xorg", "gnome-shell",
];

/// One reading of this computer, sent to the panel and later to other computers.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub host: String,
    pub os: String,
    pub cpu_percent: f32,
    /// The part of `cpu_percent` spent in macOS itself (kernel time: compressing memory, swapping, drivers).
    /// Why: on a Mac short of memory this is often the biggest share, and no app in the list holds it.
    pub cpu_system_percent: f32,
    pub memory_used: u64,
    pub memory_total: u64,
    /// Where memory goes besides apps, in bytes, so the panel can split all of it into one bar.
    /// Kernel memory that cannot be paged out (0 where the OS does not report it).
    pub memory_wired: u64,
    /// Memory squeezed by the macOS compressor (0 elsewhere).
    pub memory_compressed: u64,
    /// File copies and purgeable pages the OS drops by itself when an app needs the room.
    pub memory_cache: u64,
    pub memory_free: u64,
    pub memory_pressure: Pressure,
    pub disk_used: u64,
    pub disk_total: u64,
    pub swap_used: u64,
    /// Memory pressure is at warning or worse.
    pub slow_memory: bool,
    /// CPU has stayed above `SLOW_CPU` for the last minute.
    pub slow_cpu: bool,
    /// Oldest first, in percent.
    pub cpu_history: Vec<f32>,
    pub memory_history: Vec<f32>,
    pub top_cpu: Vec<AppUse>,
    pub top_memory: Vec<AppUse>,
    pub claude_sessions: Vec<ClaudeSession>,
    pub runners: Vec<Runner>,
    /// The heavy job holding the shared turn (`heavy-run` in claude-config), if any.
    pub heavy_job: Option<HeavyJob>,
}

/// Whether memory is really short. macOS fills spare memory with cache, so "used" alone looks alarming when it is not.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Pressure {
    Normal,
    Warn,
    Critical,
}

/// One app's share, with its helper processes added up.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUse {
    pub name: String,
    /// Percent of the whole computer, on the same scale as `cpu_percent`.
    pub cpu_percent: f32,
    pub memory: u64,
    /// How the panel's Quit button ends this entry, or none when it offers no Quit. Never for system processes,
    /// Monitor itself, claude, other users' processes, build tools, simulators, terminals or editors.
    pub quit: Option<QuitKind>,
    pub kind: AppKind,
    /// The Mac app's bundle id (com.apple.Terminal), for the entries on screen. Why: the front app is noted by it,
    /// because the name macOS shows is translated ("터미널") while the `.app` folder name is not.
    pub bundle_id: Option<String>,
    /// For the "claude" entry, how many claude processes it adds up; none for other apps.
    pub sessions: Option<u32>,
    /// For a build tool or dev server, the repository it works in (the folder holding `.git` above its working folder).
    pub folder: Option<String>,
    /// For a dev server, how long it has been running.
    pub running_secs: Option<u64>,
    /// Whether every process in the entry may be asked to quit; `quit` is decided from it once the entry is on screen.
    #[serde(skip)]
    pub quittable: bool,
    #[serde(skip)]
    pub pids: Vec<Pid>,
    /// The `.app` bundle, so a Mac app can be asked to quit like ⌘Q instead of being sent a signal.
    #[serde(skip)]
    pub bundle: Option<PathBuf>,
}

/// How Quit ends an entry, so the panel can say whether it asks to save first.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuitKind {
    /// Asked to quit the way ⌘Q does (a Mac app) or closed like its window's close box (Windows): it can ask to save.
    App,
    /// Sent SIGTERM: it ends at once without asking.
    Process,
}

/// What kind of program an entry is, so the panel offers Quit only where it is safe.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppKind {
    App,
    Build,
    Simulator,
    /// A development web server (`nuxt dev`, `vite`, `next dev` …) run by node. Why: one left running for hours often
    /// holds a gigabyte or more, and quitting it is safe because it is started again with one command.
    DevServer,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSession {
    pub pid: u32,
    /// The session name Claude Code shows in its session list (for example "Split"), when it has one.
    pub name: Option<String>,
    pub running_secs: u64,
    pub busy: bool,
    /// Opened by a person in a terminal. Why: background `claude` runs (agents, scripts, `claude -p`) also show up as
    /// claude processes, and counting them as sessions made the panel say 9 or 10 when only 7 were open.
    pub human: bool,
}

/// A GitHub Actions runner, named after its install folder (for example `sense` in `~/actions-runners/sense`).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runner {
    pub name: String,
    pub busy: bool,
    /// Unix time when a paused runner starts again; set by the panel's pause button, not by sampling.
    pub paused_until: Option<u64>,
    /// Installed as a service but turned off in launchd (`launchctl disable`), so it never runs on this Mac.
    pub off: bool,
    /// The install folder, which holds `.service` naming the launchd job.
    #[serde(skip)]
    pub dir: PathBuf,
}

pub struct Sampler {
    system: System,
    disks: Disks,
    cpu_history: VecDeque<f32>,
    memory_history: VecDeque<f32>,
    claude_cpu: HashMap<Pid, VecDeque<f32>>,
    /// The CPU tick counters (user, system, idle, nice) at the last reading; the share is their difference.
    cpu_ticks: [u64; 4],
}

impl Sampler {
    pub fn new() -> Result<Self, sysinfo::Error> {
        let mut system = System::new_with_specifics(RefreshKind::nothing())?;
        // Why: CPU usage is a difference between two readings, so take the first one now.
        system.refresh_cpu_usage();
        Ok(Self {
            system,
            disks: Disks::new_with_refreshed_list()?,
            cpu_history: VecDeque::with_capacity(HISTORY_LEN),
            memory_history: VecDeque::with_capacity(HISTORY_LEN),
            claude_cpu: HashMap::new(),
            cpu_ticks: cpu_ticks(),
        })
    }

    pub fn sample(&mut self) -> Snapshot {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_cpu()
                .with_memory()
                .with_exe(UpdateKind::OnlyIfNotSet)
                .with_cwd(UpdateKind::OnlyIfNotSet)
                .with_cmd(UpdateKind::OnlyIfNotSet)
                .with_user(UpdateKind::OnlyIfNotSet),
        );
        self.disks.refresh(true);

        let processes = self.system.processes();
        let cores = self.system.cpus().len().max(1) as f32;
        let (top_cpu, top_memory) = top_apps(processes, cores);

        let mut claude_sessions = Vec::new();
        for (pid, process) in processes {
            if plain_name(process) != "claude" {
                continue;
            }
            let readings = self.claude_cpu.entry(*pid).or_default();
            if readings.len() == CLAUDE_CPU_READINGS {
                readings.pop_front();
            }
            readings.push_back(process.cpu_usage());
            let average = readings.iter().sum::<f32>() / readings.len() as f32;
            let info = claude_session_file(pid.as_u32());
            claude_sessions.push(ClaudeSession {
                pid: pid.as_u32(),
                name: info.as_ref().and_then(|i| i.name.clone()),
                running_secs: process.run_time(),
                busy: match info.as_ref().and_then(|i| i.status.as_deref()) {
                    Some("busy") => true,
                    Some("idle") => false,
                    _ => average >= CLAUDE_BUSY_CPU,
                },
                human: info.as_ref().is_some_and(|i| i.kind.as_deref().is_none_or(|kind| kind == "interactive")),
            });
        }
        self.claude_cpu.retain(|pid, _| processes.contains_key(pid));
        claude_sessions.sort_by_key(|s| std::cmp::Reverse(s.running_secs));

        let runners = runners(processes);
        let cpu_percent = self.system.global_cpu_usage();
        let ticks = cpu_ticks();
        let cpu_system_percent = system_share(self.cpu_ticks, ticks).min(cpu_percent);
        self.cpu_ticks = ticks;
        let memory_used = self.system.used_memory();
        let memory_total = self.system.total_memory();
        let (disk_used, disk_total) = self.system_disk();
        push_capped(&mut self.cpu_history, cpu_percent);
        push_capped(&mut self.memory_history, memory_used as f32 * 100.0 / memory_total.max(1) as f32);
        let memory_pressure = memory_pressure(&self.system);
        let breakdown = memory_breakdown(&self.system);
        let slow_cpu = self.cpu_history.len() >= SLOW_CPU_READINGS
            && self.cpu_history.iter().rev().take(SLOW_CPU_READINGS).all(|&v| v >= SLOW_CPU);

        Snapshot {
            host: System::host_name().unwrap_or_default(),
            os: System::long_os_version().unwrap_or_default(),
            cpu_percent,
            memory_used,
            memory_total,
            memory_wired: breakdown.wired,
            memory_compressed: breakdown.compressed,
            cpu_system_percent,
            memory_cache: breakdown.cache,
            memory_free: breakdown.free,
            memory_pressure,
            disk_used,
            disk_total,
            swap_used: self.system.used_swap(),
            slow_memory: !matches!(memory_pressure, Pressure::Normal),
            slow_cpu,
            cpu_history: self.cpu_history.iter().copied().collect(),
            memory_history: self.memory_history.iter().copied().collect(),
            top_cpu,
            top_memory,
            claude_sessions,
            runners,
            heavy_job: heavy_job(),
        }
    }

    /// Space on the disk the OS boots from: "/" on macOS and Linux, the system drive on Windows.
    fn system_disk(&self) -> (u64, u64) {
        let root = if cfg!(windows) {
            std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()) + "\\"
        } else {
            "/".into()
        };
        self.disks
            .iter()
            .find(|d| d.mount_point().as_os_str() == root.as_str())
            .or_else(|| self.disks.iter().max_by_key(|d| d.total_space()))
            .map(|d| (d.total_space() - d.available_space(), d.total_space()))
            .unwrap_or((0, 0))
    }
}

fn push_capped(history: &mut VecDeque<f32>, value: f32) {
    if history.len() == HISTORY_LEN {
        history.pop_front();
    }
    history.push_back(value);
}

/// Lower-case process name without `.exe`.
fn plain_name(process: &Process) -> String {
    let name = process.name().to_string_lossy().to_lowercase();
    name.strip_suffix(".exe").map(str::to_owned).unwrap_or(name)
}

/// The name people know an app by, and its kind. Why: Chrome, Slack and Xcode run many helper processes inside their
/// `.app` bundle, so the outermost bundle name adds those up instead of listing "Google Chrome Helper" five times.
/// Simulators are folded into one entry each for the same reason; their processes carry dozens of iOS names.
fn app_name(process: &Process) -> (String, Option<PathBuf>, AppKind) {
    let name = plain_name(process);
    let exe = process.exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    if exe.contains("/CoreSimulator/") || name == "xpcproxy_sim" || name == "launchd_sim" {
        return ("iOS Simulator".into(), None, AppKind::Simulator);
    }
    if name.starts_with("qemu-system") || exe.contains("/Android/sdk/emulator/") {
        return ("Android Emulator".into(), None, AppKind::Simulator);
    }
    if let Some(tool) = dev_server(process, &name) {
        return (tool.to_owned(), None, AppKind::DevServer);
    }
    if BUILD_TOOLS.contains(&name.as_str()) {
        return (process.name().to_string_lossy().into_owned(), None, AppKind::Build);
    }
    if let Some(bundle) = process
        .exe()
        .and_then(|exe| exe.ancestors().filter(|p| p.extension().is_some_and(|e| e == "app")).last())
    {
        let name = bundle.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        return (name, Some(bundle.to_path_buf()), AppKind::App);
    }
    let name = process.name().to_string_lossy();
    (name.strip_suffix(".exe").unwrap_or(&name).to_owned(), None, AppKind::App)
}

/// The dev server a node, bun or deno process runs, by the words its command line holds.
fn dev_server(process: &Process, name: &str) -> Option<&'static str> {
    if !matches!(name, "node" | "bun" | "deno") {
        return None;
    }
    let cmd: Vec<String> = process.cmd().iter().map(|a| a.to_string_lossy().into_owned()).collect();
    let has = |tool: &str, word: Option<&str>| {
        cmd.iter().any(|a| a.rsplit('/').next() == Some(tool)) && word.is_none_or(|w| cmd.iter().any(|a| a == w))
    };
    DEV_SERVERS.iter().find(|(tool, word, _)| has(tool, *word)).map(|(_, _, label)| *label)
}

/// The repository a build tool works in: the nearest folder above its working folder that holds `.git`.
fn repo_name(process: &Process) -> Option<String> {
    process
        .cwd()?
        .ancestors()
        .find(|dir| dir.join(".git").exists())
        .and_then(Path::file_name)
        .map(|n| n.to_string_lossy().into_owned())
}

#[derive(serde::Deserialize)]
struct SessionFile {
    name: Option<String>,
    status: Option<String>,
    /// "interactive" for a session a person opened.
    kind: Option<String>,
}

/// Claude Code keeps `~/.claude/sessions/<pid>.json` with the session's name and whether it is busy.
/// Why: every claude process reports the home folder as its working folder, so this file is the only way to tell them apart.
fn claude_session_file(pid: u32) -> Option<SessionFile> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    let path = PathBuf::from(home).join(".claude").join("sessions").join(format!("{pid}.json"));
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// One heavy job (simulator, Gradle, release build) running through `heavy-run`, which lets one session at a time go.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeavyJob {
    pub name: String,
    pub command: String,
    pub running_secs: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeavyFile {
    name: Option<String>,
    command: String,
    started_epoch: u64,
    /// The heavy-run process holding the turn.
    pid: Option<u32>,
}

/// `heavy-run` writes `~/.runners/heavy.json` while it holds the turn and removes it when done.
/// Why: sessions wait for each other through it, so the panel shows who has the turn and for how long.
fn heavy_job() -> Option<HeavyJob> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    let path = PathBuf::from(home).join(".runners").join("heavy.json");
    let file: HeavyFile = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    // Why: a heavy-run that was killed leaves the file behind, which showed "무거운 작업 1" growing forever.
    if file.pid.is_some_and(|pid| !alive(pid)) {
        return None;
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(HeavyJob {
        name: file.name.unwrap_or_default(),
        command: file.command,
        running_secs: now.saturating_sub(file.started_epoch),
    })
}

/// How Quit may end an entry. Why: on a Mac a program outside any `.app` (node, python) may be a Claude session's tool
/// server or a runner, so only a confirmed dev server is offered; a terminal or editor would take its sessions with it.
fn quit_kind(app: &AppUse) -> Option<QuitKind> {
    if !app.quittable {
        return None;
    }
    match app.kind {
        AppKind::DevServer => Some(QuitKind::Process),
        AppKind::App if cfg!(target_os = "macos") => {
            app.bundle_id.as_deref().filter(|id| !keeps_sessions(id)).map(|_| QuitKind::App)
        }
        AppKind::App if cfg!(windows) => Some(QuitKind::App),
        AppKind::App => Some(QuitKind::Process),
        AppKind::Build | AppKind::Simulator => None,
    }
}

/// Terminals and editors, by bundle id; an entry ending in "." covers every id that starts with it.
const KEEPS_SESSIONS: &[&str] = &[
    "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.mitchellh.ghostty", "net.kovidgoyal.kitty",
    "org.alacritty", "com.github.wez.wezterm", "im.runners.prompt", "com.microsoft.VSCode", "com.microsoft.VSCodeInsiders",
    "com.todesktop.230313mzl4w4u92", "dev.zed.Zed", "com.exafunction.windsurf", "com.jetbrains.", "com.google.android.studio",
    "com.apple.dt.Xcode", "com.sublimetext.", "com.panic.Nova",
];

fn keeps_sessions(id: &str) -> bool {
    KEEPS_SESSIONS.iter().any(|known| if known.ends_with('.') { id.starts_with(known) } else { id == *known })
}

/// The bundle id in an `.app`'s Info.plist, remembered per bundle because it never changes while the app runs.
fn bundle_id(bundle: &Path) -> Option<String> {
    static IDS: std::sync::OnceLock<std::sync::Mutex<HashMap<PathBuf, Option<String>>>> = std::sync::OnceLock::new();
    let mut ids = IDS.get_or_init(Default::default).lock().ok()?;
    ids.entry(bundle.to_path_buf()).or_insert_with(|| read_bundle_id(bundle)).clone()
}

#[cfg(target_os = "macos")]
fn read_bundle_id(bundle: &Path) -> Option<String> {
    // Why: Info.plist is often binary, and plutil reads both forms.
    let out = std::process::Command::new("plutil")
        .args(["-extract", "CFBundleIdentifier", "raw", "-o", "-"])
        .arg(bundle.join("Contents/Info.plist"))
        .output()
        .ok()
        .filter(|out| out.status.success())?;
    Some(String::from_utf8_lossy(&out.stdout).trim().to_owned()).filter(|id| !id.is_empty())
}

#[cfg(not(target_os = "macos"))]
fn read_bundle_id(_bundle: &Path) -> Option<String> {
    None
}

/// Whether a process with this id is running. Signal 0 checks without sending anything; EPERM means it runs as someone else.
#[cfg(unix)]
fn alive(pid: u32) -> bool {
    (unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }) || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn alive(_pid: u32) -> bool {
    true
}

fn quittable(process: &Process) -> bool {
    let name = plain_name(process);
    let own = process.pid().as_u32() == std::process::id();
    !own && name != "claude" && !name.eq_ignore_ascii_case("monitor") && !SYSTEM_PROCESSES.contains(&name.as_str()) && owned_by_me(process)
}

#[cfg(unix)]
fn owned_by_me(process: &Process) -> bool {
    // Why: other users' and root processes cannot be asked to quit by us anyway.
    process.user_id().is_some_and(|uid| **uid == unsafe { libc::getuid() })
}

#[cfg(not(unix))]
fn owned_by_me(_process: &Process) -> bool {
    true
}

/// (program, word that must follow it, name shown). Why: `nuxt build` or `vite build` finish on their own; only the
/// long-running dev command is worth offering to quit.
const DEV_SERVERS: &[(&str, Option<&str>, &str)] = &[
    ("nuxt", Some("dev"), "nuxt dev"),
    ("nuxi", Some("dev"), "nuxt dev"),
    ("next", Some("dev"), "next dev"),
    ("vite", None, "vite"),
    ("electron-vite", Some("dev"), "electron-vite dev"),
    ("astro", Some("dev"), "astro dev"),
    ("webpack", Some("serve"), "webpack serve"),
    ("remix", Some("dev"), "remix dev"),
];

/// What a process holds in memory, the way Activity Monitor's Memory column counts it: its resident pages plus the
/// pages macOS has compressed for it. Why: on a Mac short of memory most of an idle app sits compressed, so counting
/// resident pages alone made it look small and left its share under "System".
#[cfg(target_os = "macos")]
fn memory_of(pid: Pid, process: &Process) -> u64 {
    let mut info: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        libc::proc_pid_rusage(pid.as_u32() as i32, libc::RUSAGE_INFO_V2, (&mut info as *mut libc::rusage_info_v2).cast())
    } == 0;
    // Why: other users' processes cannot be asked; their resident size is the best left.
    if ok { info.ri_phys_footprint } else { process.memory() }
}

#[cfg(not(target_os = "macos"))]
fn memory_of(_pid: Pid, process: &Process) -> u64 {
    process.memory()
}

fn top_apps(processes: &HashMap<Pid, Process>, cores: f32) -> (Vec<AppUse>, Vec<AppUse>) {
    let mut apps: HashMap<String, AppUse> = HashMap::new();
    for (pid, process) in processes {
        let (name, bundle, kind) = app_name(process);
        let entry = apps.entry(name.clone()).or_insert(AppUse {
            name,
            cpu_percent: 0.0,
            memory: 0,
            quit: None,
            kind,
            bundle_id: None,
            quittable: matches!(kind, AppKind::App | AppKind::DevServer),
            sessions: None,
            folder: None,
            running_secs: None,
            pids: Vec::new(),
            bundle,
        });
        // Why: sysinfo gives percent of one core, while the CPU bar is percent of the whole computer.
        entry.cpu_percent += process.cpu_usage() / cores;
        entry.memory += memory_of(*pid, process);
        if entry.kind == AppKind::DevServer {
            entry.running_secs = entry.running_secs.max(Some(process.run_time()));
        }
        // Why: one protected process (say a root helper) makes the whole app unsafe to quit from here.
        entry.quittable &= quittable(process);
        entry.pids.push(*pid);
    }
    // Why: every claude process is one session; the panel names the entry "claude 세션 N개" instead of a size alone.
    if let Some(claude) = apps.get_mut("claude") {
        claude.sessions = Some(claude.pids.len() as u32);
        claude.quittable = false;
    }
    let mut by_cpu: Vec<AppUse> = apps.values().cloned().collect();
    by_cpu.sort_by(|a, b| b.cpu_percent.total_cmp(&a.cpu_percent));
    by_cpu.truncate(TOP_APPS);
    let mut by_memory: Vec<AppUse> = apps.into_values().collect();
    by_memory.sort_by_key(|a| std::cmp::Reverse(a.memory));
    by_memory.truncate(TOP_APPS);
    // Why: only the few entries on screen need their repository or bundle id looked up, which touches the disk.
    for app in by_cpu.iter_mut().chain(by_memory.iter_mut()) {
        if matches!(app.kind, AppKind::Build | AppKind::DevServer) {
            app.folder = app.pids.iter().filter_map(|pid| processes.get(pid)).find_map(repo_name);
        }
        app.bundle_id = app.bundle.as_deref().and_then(bundle_id);
        app.quit = quit_kind(app);
    }
    (by_cpu, by_memory)
}

/// Every Runner.Listener is one runner; it is busy when a Runner.Worker runs somewhere below it.
fn runners(processes: &HashMap<Pid, Process>) -> Vec<Runner> {
    let mut listeners: Vec<(Pid, PathBuf)> = Vec::new();
    let mut workers: Vec<Pid> = Vec::new();
    for (pid, process) in processes {
        match plain_name(process).as_str() {
            "runner.listener" => listeners.push((*pid, runner_dir(process))),
            "runner.worker" => workers.push(*pid),
            _ => {}
        }
    }
    let mut busy_listeners = Vec::new();
    for worker in workers {
        let mut current = processes.get(&worker).and_then(Process::parent);
        for _ in 0..MAX_PARENT_HOPS {
            let Some(pid) = current else { break };
            if listeners.iter().any(|(listener, _)| *listener == pid) {
                busy_listeners.push(pid);
                break;
            }
            current = processes.get(&pid).and_then(Process::parent);
        }
    }
    let mut runners: Vec<Runner> = listeners
        .into_iter()
        .map(|(pid, dir)| Runner {
            name: dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "runner".into()),
            busy: busy_listeners.contains(&pid),
            paused_until: None,
            off: false,
            dir,
        })
        .collect();
    // Why: a runner turned off in launchd has no process, so without this it would look as if it were never installed.
    let disabled = disabled_labels();
    for dir in installed_runners() {
        let off = service_label(&dir).is_some_and(|label| disabled.contains(&label));
        if off && !runners.iter().any(|r| r.dir == dir) {
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            runners.push(Runner { name, busy: false, paused_until: None, off: true, dir });
        }
    }
    runners.sort_by(|a, b| a.name.cmp(&b.name));
    runners
}

/// The folder every runner on this computer is installed under (`~/actions-runners/<name>`).
pub fn runners_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join("actions-runners"))
}

/// Runner folders that `svc.sh install` made into a service.
fn installed_runners() -> Vec<PathBuf> {
    let Some(Ok(entries)) = runners_home().map(std::fs::read_dir) else { return Vec::new() };
    entries.flatten().map(|e| e.path()).filter(|dir| dir.join(".service").is_file()).collect()
}

/// The launchd plist named in the runner folder's `.service`, and its label (the file name without `.plist`).
pub fn service_plist(dir: &Path) -> Option<(String, String)> {
    let plist = std::fs::read_to_string(dir.join(".service")).ok()?.trim().to_owned();
    let label = Path::new(&plist).file_stem()?.to_string_lossy().into_owned();
    Some((plist, label))
}

fn service_label(dir: &Path) -> Option<String> {
    service_plist(dir).map(|(_, label)| label)
}

/// How long the list of turned-off launchd jobs is reused. Why: asking launchctl every 2 seconds costs a process each time.
const DISABLED_KEEP: Duration = Duration::from_secs(60);

/// Labels launchd keeps turned off for this user (`launchctl print-disabled gui/<uid>`).
#[cfg(target_os = "macos")]
pub fn disabled_labels() -> Vec<String> {
    static CACHE: OnceLock<Mutex<Option<(Instant, Vec<String>)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let Ok(mut cached) = cache.lock() else { return Vec::new() };
    if let Some((at, labels)) = cached.as_ref() {
        if at.elapsed() < DISABLED_KEEP {
            return labels.clone();
        }
    }
    let domain = format!("gui/{}", unsafe { libc::getuid() });
    let labels = std::process::Command::new("launchctl")
        .arg("print-disabled")
        .arg(domain)
        .output()
        .map(|out| parse_disabled(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default();
    *cached = Some((Instant::now(), labels.clone()));
    labels
}

#[cfg(not(target_os = "macos"))]
pub fn disabled_labels() -> Vec<String> {
    Vec::new()
}

/// Reads lines like `"actions.runner.SENSE-IM.m2-pro-sun-1" => disabled` (older macOS writes `true`).
fn parse_disabled(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let (label, state) = line.trim().split_once("=>")?;
            matches!(state.trim(), "disabled" | "true").then(|| label.trim().trim_matches('"').to_owned())
        })
        .collect()
}

/// The folder above `bin/Runner.Listener`, which is how each runner was installed and named.
fn runner_dir(process: &Process) -> PathBuf {
    process.exe().and_then(Path::parent).and_then(Path::parent).map(Path::to_path_buf).unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn memory_pressure(_system: &System) -> Pressure {
    // Why: this is the same level Activity Monitor colours its memory pressure graph with (1 normal, 2 warn, 4 critical).
    let mut level: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let ok = unsafe {
        libc::sysctlbyname(
            c"kern.memorystatus_vm_pressure_level".as_ptr(),
            (&mut level as *mut libc::c_int).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    } == 0;
    match level {
        _ if !ok => Pressure::Normal,
        4.. => Pressure::Critical,
        2 | 3 => Pressure::Warn,
        _ => Pressure::Normal,
    }
}

#[cfg(not(target_os = "macos"))]
fn memory_pressure(system: &System) -> Pressure {
    // Why: Windows and Linux have no single pressure number, so it is estimated from memory that can still be handed out.
    let total = system.total_memory();
    if total == 0 {
        return Pressure::Normal;
    }
    let available = system.available_memory() as f64 / total as f64;
    if available < 0.10 {
        Pressure::Critical
    } else if available < 0.20 {
        Pressure::Warn
    } else {
        Pressure::Normal
    }
}

#[derive(Debug, Default, PartialEq)]
pub struct MemoryBreakdown {
    pub wired: u64,
    pub compressed: u64,
    pub cache: u64,
    pub free: u64,
}

/// Percent of all CPU time between two tick readings that went to the system (kernel).
fn system_share(before: [u64; 4], after: [u64; 4]) -> f32 {
    let diff: Vec<u64> = after.iter().zip(before).map(|(a, b)| a.saturating_sub(b)).collect();
    let all: u64 = diff.iter().sum();
    if all == 0 { 0.0 } else { diff[1] as f32 * 100.0 / all as f32 }
}

/// The counters `top` reads for its "sys" figure, summed over every core.
#[cfg(target_os = "macos")]
#[allow(deprecated)] // As in memory_breakdown: the mach2 crate would add a dependency for the same call.
fn cpu_ticks() -> [u64; 4] {
    let mut info: libc::host_cpu_load_info = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_CPU_LOAD_INFO_COUNT;
    let ok = unsafe {
        libc::host_statistics(
            libc::mach_host_self(),
            libc::HOST_CPU_LOAD_INFO,
            (&mut info as *mut libc::host_cpu_load_info).cast(),
            &mut count,
        )
    } == libc::KERN_SUCCESS;
    if !ok {
        return [0; 4];
    }
    let [user, system, idle, nice] = info.cpu_ticks;
    [user as u64, system as u64, idle as u64, nice as u64]
}

/// `/proc/stat`'s first line (user, nice, system, idle, ...), reordered like the macOS counters.
#[cfg(target_os = "linux")]
fn cpu_ticks() -> [u64; 4] {
    let text = std::fs::read_to_string("/proc/stat").unwrap_or_default();
    let fields: Vec<u64> = text.lines().next().unwrap_or("").split_whitespace().skip(1).filter_map(|f| f.parse().ok()).collect();
    match fields.as_slice() {
        [user, nice, system, idle, ..] => [*user, *system, *idle, *nice],
        _ => [0; 4],
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn cpu_ticks() -> [u64; 4] {
    [0; 4]
}

/// The same page counts `vm_stat` prints. Why: sysinfo has no wired, compressed or cache figures.
#[cfg(target_os = "macos")]
#[allow(deprecated)] // libc points to the mach2 crate for these, but the calls are the same and need no new dependency.
fn memory_breakdown(_system: &System) -> MemoryBreakdown {
    let mut info: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_VM_INFO64_COUNT;
    let ok = unsafe {
        libc::host_statistics64(
            libc::mach_host_self(),
            libc::HOST_VM_INFO64,
            (&mut info as *mut libc::vm_statistics64).cast(),
            &mut count,
        )
    } == libc::KERN_SUCCESS;
    if !ok {
        return MemoryBreakdown::default();
    }
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) }.max(0) as u64;
    let bytes = |pages: u32| pages as u64 * page;
    MemoryBreakdown {
        wired: bytes(info.wire_count),
        compressed: bytes(info.compressor_page_count),
        cache: bytes(info.external_page_count) + bytes(info.purgeable_count),
        // Why: free_count already holds the speculative pages; vm_stat prints "Pages free" as free minus speculative.
        free: bytes(info.free_count),
    }
}

/// `/proc/meminfo`: page cache and buffers are the part Linux gives back on its own. No wired or compressed figures.
#[cfg(target_os = "linux")]
fn memory_breakdown(_system: &System) -> MemoryBreakdown {
    let text = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    parse_meminfo(&text)
}

#[cfg(any(target_os = "linux", test))]
fn parse_meminfo(text: &str) -> MemoryBreakdown {
    let field = |name: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(':'))
            .and_then(|rest| rest.split_whitespace().next()?.parse::<u64>().ok())
            .map_or(0, |kib| kib * 1024)
    };
    MemoryBreakdown { wired: 0, compressed: 0, cache: field("Cached") + field("Buffers"), free: field("MemFree") }
}

/// Windows: only free memory; standby cache is not reported by sysinfo.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn memory_breakdown(system: &System) -> MemoryBreakdown {
    MemoryBreakdown { free: system.free_memory(), ..Default::default() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_share_is_the_system_part_of_the_difference() {
        assert_eq!(system_share([10, 20, 70, 0], [40, 60, 100, 0]), 40.0);
        assert_eq!(system_share([5, 5, 5, 5], [5, 5, 5, 5]), 0.0);
    }

    #[test]
    fn reads_turned_off_launchd_jobs() {
        let text = "disabled services = {\n\t\"actions.runner.SENSE-IM.m2-pro-sun-1\" => disabled\n\t\"com.apple.ftp-proxy\" => enabled\n\t\"old.style\" => true\n}\n";
        assert_eq!(parse_disabled(text), vec!["actions.runner.SENSE-IM.m2-pro-sun-1", "old.style"]);
    }

    #[test]
    fn meminfo_cache_and_free() {
        let text = "MemTotal:       16000000 kB\nMemFree:          100000 kB\nBuffers:           2000 kB\nCached:           30000 kB\nSwapCached:          10 kB\n";
        let got = parse_meminfo(text);
        assert_eq!(got.cache, 32000 * 1024);
        assert_eq!(got.free, 100000 * 1024);
        assert_eq!(got.wired, 0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_breakdown_fits_in_total() {
        let system = System::new_with_specifics(RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything())).unwrap();
        let got = memory_breakdown(&system);
        assert!(got.wired > 0 && got.free > 0);
        assert!(got.wired + got.compressed + got.cache + got.free <= system.total_memory());
    }
}
