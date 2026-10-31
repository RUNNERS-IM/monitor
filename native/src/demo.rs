//! Debug runs only (the app reads `Sampler.demoSnapshot` only when not packaged): `MONITOR_DEMO=1` swaps this computer's names for made-up ones, so screenshots for the public
//! homepage show no real session names, runner names, folders or host name. Every number is made up too (a 16 GB Mac
//! running short on memory, CPU 62 %, disk 71 %), so each screenshot shows the same believable picture.

use crate::cleanup::{Candidate, Cleanup, KindTotal};
use crate::snapshot::{AppKind, AppUse, ClaudeSession, Pressure, Runner, Snapshot};

const GB: u64 = 1024 * 1024 * 1024;

/// `korean` picks the made-up session names, so the Korean page gets Korean names and every other page English ones.
pub fn apply(snap: &mut Snapshot, korean: bool) {
    snap.host = "MacBook Pro".into();
    snap.cpu_percent = 62.0;
    // Why: a fixed wave instead of the real history, so the CPU line in the panel looks the same in every shot.
    snap.cpu_history = (0..60).map(|i| 50.0 + 12.0 * ((i as f32) * 0.35).sin() + if i > 50 { 8.0 } else { 0.0 }).collect();
    snap.memory_history = (0..60).map(|i| 80.0 + 6.0 * ((i as f32) * 0.2).sin()).collect();
    snap.disk_total = 1000 * 1000 * 1000 * 1000;
    snap.disk_used = snap.disk_total / 100 * 71;
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
    claude.sessions = Some(4);
    snap.top_memory = vec![app("Google Chrome", 3.2, true), claude, app("Slack", 1.4, true), app("Prompt", 0.9, true)];
    snap.top_cpu = snap.top_memory.clone();
    let session = |pid: u32, name: &str, mins: u64, busy: bool| ClaudeSession {
        pid,
        name: Some(name.into()),
        running_secs: mins * 60,
        busy,
        human: true,
    };
    let names = if korean {
        ["웹사이트 고치기", "앱 번역", "결제 화면", "버그 정리"]
    } else {
        ["Fix website", "Translate app", "Checkout screen", "Bug sweep"]
    };
    snap.claude_sessions = vec![
        session(101, names[0], 95, true),
        session(102, names[1], 72, true),
        session(103, names[2], 48, false),
        session(104, names[3], 30, false),
    ];
    snap.runners = [("runner-1", true), ("runner-2", false)]
        .iter()
        .map(|(name, busy)| Runner { name: (*name).into(), busy: *busy, paused_until: None, dir: Default::default() })
        .collect();
    // Why: the heavy-job row comes from heavy-run, an in-house tool other people do not have.
    snap.heavy_job = None;
}

/// A made-up "what could be cleaned" list, so the expanded row never shows this computer's real folders.
pub fn cleanup(measured_at: u64) -> Cleanup {
    let gb = |gb: f64| (gb * GB as f64) as u64;
    let top = vec![
        Candidate { path: "~/Library/Caches".into(), bytes: gb(18.4) },
        Candidate { path: "~/Library/Developer/Xcode/DerivedData".into(), bytes: gb(9.8) },
        Candidate { path: "~/git/my-app/node_modules".into(), bytes: gb(6.2) },
    ];
    let kind = |kind: &str, size: f64| KindTotal { kind: kind.into(), bytes: gb(size) };
    let kinds = vec![kind("cache", 22.1), kind("build", 13.2), kind("packages", 6.2)];
    Cleanup { total: gb(41.5), top, kinds, measured_at }
}
