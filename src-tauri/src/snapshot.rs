use serde::Serialize;
use sysinfo::{Disks, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind};

/// One reading of this computer, sent to the panel and later to other computers.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub host: String,
    pub os: String,
    pub cpu_percent: f32,
    pub memory_used: u64,
    pub memory_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
    pub claude_sessions: usize,
    pub runner: RunnerState,
}

impl Snapshot {
    pub fn memory_percent(&self) -> f64 {
        if self.memory_total == 0 {
            return 0.0;
        }
        self.memory_used as f64 * 100.0 / self.memory_total as f64
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunnerState {
    /// No GitHub Actions runner process on this computer.
    None,
    /// Runner.Listener is up and waiting for a job.
    Idle,
    /// Runner.Worker exists, so a job is running right now.
    Busy,
}

pub struct Sampler {
    system: System,
    disks: Disks,
}

impl Sampler {
    pub fn new() -> Result<Self, sysinfo::Error> {
        let mut system = System::new_with_specifics(RefreshKind::nothing())?;
        // Why: CPU usage is a difference between two readings, so take the first one now.
        system.refresh_cpu_usage();
        Ok(Self { system, disks: Disks::new_with_refreshed_list()? })
    }

    pub fn sample(&mut self) -> Snapshot {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );
        self.disks.refresh(true);

        let mut claude_sessions = 0;
        let mut listener = false;
        let mut worker = false;
        for process in self.system.processes().values() {
            let name = process.name().to_string_lossy().to_lowercase();
            let name = name.strip_suffix(".exe").unwrap_or(&name);
            match name {
                "claude" => claude_sessions += 1,
                "runner.listener" => listener = true,
                "runner.worker" => worker = true,
                _ => {}
            }
        }
        let runner = match (listener, worker) {
            (_, true) => RunnerState::Busy,
            (true, false) => RunnerState::Idle,
            _ => RunnerState::None,
        };

        let (disk_used, disk_total) = self.system_disk();
        Snapshot {
            host: System::host_name().unwrap_or_default(),
            os: System::long_os_version().unwrap_or_default(),
            cpu_percent: self.system.global_cpu_usage(),
            memory_used: self.system.used_memory(),
            memory_total: self.system.total_memory(),
            disk_used,
            disk_total,
            claude_sessions,
            runner,
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
