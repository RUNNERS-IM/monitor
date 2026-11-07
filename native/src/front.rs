//! The bundle id of the app in front, asked of macOS inside Monitor. Why: running `lsappinfo` twice every 3 seconds
//! started about 86,000 programs a day just to learn which app is in front.

#[cfg(target_os = "macos")]
pub fn front_bundle_id() -> Option<String> {
    let app = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication()?;
    Some(app.bundleIdentifier()?.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn front_bundle_id() -> Option<String> {
    None
}
