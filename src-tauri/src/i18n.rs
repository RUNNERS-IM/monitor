//! Screen text for the tray menu. The page reads the same files in `locales/`,
//! so every language lives in one place for both Rust and TypeScript.

use std::collections::HashMap;
use std::sync::OnceLock;

/// Every bundled locale: (code, file). The code is the file name in `locales/`.
const LOCALES: &[(&str, &str)] = &[
    ("ar", include_str!("../../locales/ar.json")),
    ("de", include_str!("../../locales/de.json")),
    ("en", include_str!("../../locales/en.json")),
    ("es", include_str!("../../locales/es.json")),
    ("fi", include_str!("../../locales/fi.json")),
    ("fr", include_str!("../../locales/fr.json")),
    ("hi", include_str!("../../locales/hi.json")),
    ("id", include_str!("../../locales/id.json")),
    ("it", include_str!("../../locales/it.json")),
    ("ja", include_str!("../../locales/ja.json")),
    ("ko", include_str!("../../locales/ko.json")),
    ("nl", include_str!("../../locales/nl.json")),
    ("pl", include_str!("../../locales/pl.json")),
    ("pt", include_str!("../../locales/pt.json")),
    ("ru", include_str!("../../locales/ru.json")),
    ("th", include_str!("../../locales/th.json")),
    ("vi", include_str!("../../locales/vi.json")),
    ("zh-Hans", include_str!("../../locales/zh-Hans.json")),
];

/// Picks the best bundled locale for a tag like `de-AT` or `zh-Hant-TW`: exact code, then language, else `en`.
fn pick_locale(tag: &str) -> &'static str {
    if let Some((code, _)) = LOCALES.iter().find(|(code, _)| code.eq_ignore_ascii_case(tag)) {
        return code;
    }
    let language = tag.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    // Only simplified Chinese ships, so every Chinese variant (zh-CN, zh-TW, zh-Hant…) reads it.
    if language == "zh" {
        return "zh-Hans";
    }
    LOCALES.iter().find(|(code, _)| *code == language).map_or("en", |(code, _)| code)
}

fn table() -> &'static HashMap<String, String> {
    static TABLE: OnceLock<HashMap<String, String>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let code = pick_locale(&sys_locale::get_locale().unwrap_or_default());
        let file = LOCALES.iter().find(|(c, _)| *c == code).map(|(_, file)| *file).unwrap_or(LOCALES[2].1);
        serde_json::from_str(file).expect("locales/*.json must be a flat string map")
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

#[cfg(test)]
mod tests {
    use super::pick_locale;

    #[test]
    fn picks_best_locale() {
        assert_eq!(pick_locale("ko-KR"), "ko");
        assert_eq!(pick_locale("de-AT"), "de");
        assert_eq!(pick_locale("pt-BR"), "pt");
        assert_eq!(pick_locale("pt_PT"), "pt");
        assert_eq!(pick_locale("zh-Hans"), "zh-Hans");
        assert_eq!(pick_locale("zh-Hans-CN"), "zh-Hans");
        assert_eq!(pick_locale("zh-CN"), "zh-Hans");
        assert_eq!(pick_locale("zh-TW"), "zh-Hans");
        assert_eq!(pick_locale("zh-Hant-HK"), "zh-Hans");
        assert_eq!(pick_locale("sv-SE"), "en");
        assert_eq!(pick_locale(""), "en");
    }
}
