//! Screen text for the tray menu. The page reads the same files in `locales/`,
//! so every language lives in one place for both Rust and TypeScript.

use std::collections::HashMap;
use std::sync::OnceLock;

const KO: &str = include_str!("../../locales/ko.json");
const EN: &str = include_str!("../../locales/en.json");

fn table() -> &'static HashMap<String, String> {
    static TABLE: OnceLock<HashMap<String, String>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let korean = sys_locale::get_locale().is_some_and(|l| l.starts_with("ko"));
        serde_json::from_str(if korean { KO } else { EN }).expect("locales/*.json must be a flat string map")
    })
}

/// Looks up `key` and fills `{{name}}` slots from `args`; a missing key shows the key itself so it is easy to spot.
pub fn t(key: &str, args: &[(&str, &str)]) -> String {
    let mut text = table().get(key).cloned().unwrap_or_else(|| key.to_owned());
    for (name, value) in args {
        text = text.replace(&format!("{{{{{name}}}}}"), value);
    }
    text
}
