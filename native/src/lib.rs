//! Monitor's native module, loaded by the Electron main process (electron/main/native.ts).
//! Why one module: RUNNERS apps reach OS features through a single Node native module instead of helper programs.
//! Everything slow (a reading, the folder scan, quitting an app) runs off the main thread and returns a Promise.
//! Results cross to JavaScript as JSON text with the same camelCase fields the panel reads.

mod actions;
mod bars;
mod cleanup;
mod demo;
mod snapshot;

use std::path::Path;
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi::{Env, Task};
use napi_derive::napi;

/// One piece of blocking work for the libuv thread pool; it resolves to text (JSON or a number).
pub struct Work(Option<Box<dyn FnOnce() -> std::result::Result<String, String> + Send>>);

impl Work {
    fn new(run: impl FnOnce() -> std::result::Result<String, String> + Send + 'static) -> AsyncTask<Work> {
        AsyncTask::new(Work(Some(Box::new(run))))
    }
}

impl Task for Work {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<String> {
        let run = self.0.take().ok_or_else(|| Error::from_reason("work already ran"))?;
        run().map_err(Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
        Ok(output)
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> std::result::Result<String, String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}

/// Keeps the system counters between readings (CPU use is a difference of two readings) and the last reading,
/// so Quit and Pause act on exactly the processes the panel showed.
#[napi]
pub struct Sampler {
    inner: Arc<Mutex<snapshot::Sampler>>,
    last: Arc<Mutex<Option<snapshot::Snapshot>>>,
}

#[napi]
impl Sampler {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let inner = snapshot::Sampler::new().map_err(|e| Error::from_reason(format!("failed to open system counters: {e}")))?;
        Ok(Self { inner: Arc::new(Mutex::new(inner)), last: Arc::new(Mutex::new(None)) })
    }

    /// Takes one reading and resolves to its JSON. `demo` swaps real names for made-up ones (debug runs only).
    #[napi(ts_return_type = "Promise<string>")]
    pub fn sample(&self, demo: Option<bool>) -> AsyncTask<Work> {
        let (inner, last) = (self.inner.clone(), self.last.clone());
        Work::new(move || {
            let snap = inner.lock().map_err(|e| e.to_string())?.sample();
            *last.lock().map_err(|e| e.to_string())? = Some(snap.clone());
            let mut shown = snap;
            if demo.unwrap_or(false) {
                demo::apply(&mut shown);
            }
            to_json(&shown)
        })
    }

    /// Asks the app named `name` in the last reading to quit, the way ⌘Q does. Never force-kills.
    #[napi(ts_return_type = "Promise<string>")]
    pub fn quit_app(&self, name: String) -> AsyncTask<Work> {
        let last = self.last.clone();
        Work::new(move || {
            let app = last
                .lock()
                .map_err(|e| e.to_string())?
                .as_ref()
                .and_then(|snap| snap.top_cpu.iter().chain(&snap.top_memory).find(|a| a.name == name).cloned())
                .ok_or_else(|| format!("{name} is no longer running"))?;
            actions::quit_app(&app).map(|()| String::new())
        })
    }

    /// Stops the runner named `name` for an hour; resolves to the Unix time it comes back, as text.
    #[napi(ts_return_type = "Promise<string>")]
    pub fn pause_runner(&self, name: String) -> AsyncTask<Work> {
        let last = self.last.clone();
        Work::new(move || {
            let runner = last
                .lock()
                .map_err(|e| e.to_string())?
                .as_ref()
                .and_then(|snap| snap.runners.iter().find(|r| r.name == name).cloned())
                .ok_or_else(|| format!("runner {name} is not running"))?;
            actions::pause_runner(&runner).map(|until| until.to_string())
        })
    }
}

/// The last cleanup result saved in `path`, as JSON, or null when there is none.
#[napi]
pub fn cleanup_load(path: String) -> Option<String> {
    cleanup::load(Path::new(&path)).and_then(|found| to_json(&found).ok())
}

/// Measures every cleanable folder (minutes) on a low-priority thread; resolves to the result's JSON.
/// `progress_path` keeps finished folders so a restart picks up where it stopped.
#[napi(ts_return_type = "Promise<string>")]
pub fn cleanup_measure(progress_path: Option<String>) -> AsyncTask<Work> {
    Work::new(move || {
        // Why: its own thread, so lowering the priority never slows the shared thread pool that serves other work.
        std::thread::spawn(move || {
            cleanup::run_in_background();
            to_json(&cleanup::measure(progress_path.as_deref().map(Path::new)))
        })
        .join()
        .map_err(|_| "cleanup scan stopped".to_owned())?
    })
}

#[napi]
pub fn cleanup_save(path: String, json: String) -> Result<()> {
    let found: cleanup::Cleanup = serde_json::from_str(&json).map_err(|e| Error::from_reason(e.to_string()))?;
    cleanup::save(Path::new(&path), &found);
    Ok(())
}

/// Unix time now, in seconds, from the same clock the cleanup result uses.
#[napi]
pub fn now_secs() -> f64 {
    cleanup::now() as f64
}

/// The tray picture as a 36×36 PNG with the three bars at the given heights (grid units from `barHeight`).
#[napi]
pub fn bars_png(h0: f64, h1: f64, h2: f64, r: u8, g: u8, b: u8) -> Buffer {
    bars::png([h0 as f32, h1 as f32, h2 as f32], [r, g, b]).into()
}

/// Bar height on the 24 grid for a usage fraction (0 – 1).
#[napi]
pub fn bar_height(fraction: f64) -> f64 {
    bars::bar_height(fraction as f32) as f64
}

#[napi]
pub fn ease_out(t: f64) -> f64 {
    bars::ease_out(t as f32) as f64
}
