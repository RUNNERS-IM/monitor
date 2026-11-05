//! The bundle id of the app in front, asked of macOS inside Monitor. Why: running `lsappinfo` twice every 3 seconds
//! started about 86,000 programs a day just to learn which app is in front.

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CStr};

    type Id = *mut c_void;
    type Sel = *const c_void;

    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_msgSend();
    }

    // Why: NSWorkspace lives in AppKit, which Electron has loaded already; linking it keeps the class findable anyway.
    #[link(name = "AppKit", kind = "framework")]
    unsafe extern "C" {}

    /// Sends a message that takes no arguments and returns an object (or a C string, for `UTF8String`).
    unsafe fn send(receiver: Id, selector: &CStr) -> Id {
        if receiver.is_null() {
            return std::ptr::null_mut();
        }
        let call: unsafe extern "C" fn(Id, Sel) -> Id = unsafe { std::mem::transmute(objc_msgSend as unsafe extern "C" fn()) };
        unsafe { call(receiver, sel_registerName(selector.as_ptr())) }
    }

    pub fn front_bundle_id() -> Option<String> {
        unsafe {
            let workspace = send(objc_getClass(c"NSWorkspace".as_ptr()), c"sharedWorkspace");
            let id = send(send(send(workspace, c"frontmostApplication"), c"bundleIdentifier"), c"UTF8String");
            (!id.is_null()).then(|| CStr::from_ptr(id as *const c_char).to_string_lossy().into_owned())
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac::front_bundle_id;

#[cfg(not(target_os = "macos"))]
pub fn front_bundle_id() -> Option<String> {
    None
}
