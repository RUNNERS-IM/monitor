//! Debug runs only (the app reads `Sampler.demoSnapshot` only when not packaged): `MONITOR_DEMO=1` swaps this computer's names for made-up ones, so screenshots for the public
//! homepage show no real session names, runner names, folders or host name. The CPU and disk numbers stay real; memory is
//! made up as a 16 GB Mac running short, so the "who uses memory" card always shows the same believable picture.

use crate::snapshot::{AppKind, AppUse, ClaudeSession, HeavyJob, Pressure, Runner, Snapshot};

const GB: u64 = 1024 * 1024 * 1024;

pub fn apply(snap: &mut Snapshot) {
    snap.host = "MacBook Pro".into();
    // Why: the "why slow" card only shows when memory is short, and the homepage needs it showing.
    snap.memory_pressure = Pressure::Warn;
    snap.slow_memory = true;
    let gb = |gb: f64| (gb * GB as f64) as u64;
    snap.memory_total = 16 * GB;
    snap.memory_used = gb(13.8);
    snap.memory_wired = gb(2.1);
    snap.memory_compressed = gb(0.8);
    snap.memory_cache = gb(4.0);
    snap.memory_free = gb(0.5);
    snap.swap_used = 6 * GB;
    let app = |name: &str, gb: f64, quittable: bool| AppUse {
        name: name.into(),
        cpu_percent: 4.0,
        memory: (gb * GB as f64) as u64,
        quittable,
        kind: AppKind::App,
        sessions: None,
        folder: None,
        pids: Vec::new(),
        bundle: None,
    };
    let mut claude = app("claude", 2.8, false);
    claude.sessions = Some(6);
    snap.top_memory = vec![app("Google Chrome", 3.2, true), claude, app("Slack", 1.4, true), app("Prompt", 0.9, true)];
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
