//! Debug runs only: `MONITOR_DEMO=1` swaps this computer's names for made-up ones, so screenshots for the public
//! homepage show no real session names, runner names, folders or host name. The numbers stay real.

use crate::snapshot::{AppKind, AppUse, ClaudeSession, HeavyJob, Pressure, Runner, Snapshot};

const GB: u64 = 1024 * 1024 * 1024;

pub fn enabled() -> bool {
    std::env::var_os("MONITOR_DEMO").is_some()
}

pub fn apply(snap: &mut Snapshot) {
    snap.host = "MacBook Pro".into();
    // Why: the "why slow" card only shows when memory is short, and the homepage needs it showing.
    snap.memory_pressure = Pressure::Warn;
    snap.slow_memory = true;
    snap.memory_used = snap.memory_total / 100 * 86;
    snap.swap_used = 6 * GB;
    let app = |name: &str, gb: f64, quittable: bool| AppUse {
        name: name.into(),
        cpu_percent: 4.0,
        memory: (gb * GB as f64) as u64,
        quittable,
        kind: AppKind::App,
        folder: None,
        pids: Vec::new(),
        bundle: None,
    };
    snap.top_memory = vec![app("Google Chrome", 3.2, true), app("Slack", 1.4, true), app("claude", 0.9, false)];
    snap.top_cpu = snap.top_memory.clone();
    let session = |pid: u32, name: &str, mins: u64, busy: bool| ClaudeSession {
        pid,
        name: Some(name.into()),
        running_secs: mins * 60,
        busy,
        human: true,
    };
    snap.claude_sessions = vec![
        session(101, "웹사이트 고치기", 95, true),
        session(102, "앱 번역", 72, true),
        session(103, "결제 화면", 48, false),
        session(104, "버그 정리", 30, false),
    ];
    snap.runners = ["office-1", "office-2"]
        .iter()
        .map(|name| Runner { name: (*name).into(), busy: false, paused_until: None, dir: Default::default() })
        .collect();
    snap.heavy_job = Some(HeavyJob { name: "앱 빌드".into(), command: "pnpm build".into(), running_secs: 120 });
}
