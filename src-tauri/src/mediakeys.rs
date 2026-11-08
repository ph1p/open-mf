//! Media keys as shortcuts on macOS: volume up/down, mute, play/pause, next, previous.
//!
//! The global-shortcut plugin can't see the volume keys on a Mac (they aren't key events),
//! so a small event tap in `csrc/mediakeys_mac.m` watches them. Keys bound to a shortcut
//! are swallowed and sent to the window as `media-key` events; all others pass through.
//! Elsewhere the plugin handles media keys and these commands do nothing.

use serde::Serialize;

#[derive(Clone, Serialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct MediaKey {
    /// Accelerator, e.g. "Shift+AudioVolumeUp".
    keys: String,
    /// The key is held and the system repeats it.
    repeat: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::MediaKey;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, OnceLock, mpsc};
    use tauri::{AppHandle, Emitter};

    type Callback = extern "C" fn(i32, u64, i32, i32) -> i32;
    unsafe extern "C" {
        fn mk_create(cb: Callback) -> i32;
        fn mk_run();
        fn mk_trusted(prompt: i32) -> i32;
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static BOUND: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    /// While recording a shortcut, every media key is reported (and swallowed).
    static LEARN: AtomicBool = AtomicBool::new(false);
    static RUNNING: AtomicBool = AtomicBool::new(false);

    fn code(key: i32) -> Option<&'static str> {
        // NX_KEYTYPE_* from IOKit's ev_keymap.h.
        Some(match key {
            0 => "AudioVolumeUp",
            1 => "AudioVolumeDown",
            7 => "AudioVolumeMute",
            16 => "MediaPlayPause",
            17 => "MediaTrackNext",
            18 => "MediaTrackPrevious",
            19 => "MediaFastForward",
            20 => "MediaRewind",
            _ => return None,
        })
    }

    fn accelerator(flags: u64, code: &str) -> String {
        // CGEventFlags masks, in the order the frontend writes accelerators.
        let mods = [(0x40000, "Control"), (0x80000, "Alt"), (0x20000, "Shift"), (0x100000, "Super")];
        let mut parts: Vec<&str> = mods.iter().filter(|(m, _)| flags & m != 0).map(|(_, n)| *n).collect();
        parts.push(code);
        parts.join("+")
    }

    extern "C" fn on_key(key: i32, flags: u64, down: i32, repeat: i32) -> i32 {
        let Some(code) = code(key) else { return 0 };
        let keys = accelerator(flags, code);
        let learn = LEARN.load(Ordering::Relaxed);
        let bound = BOUND.lock().map(|b| b.as_ref().is_some_and(|b| b.contains(&keys))).unwrap_or(false);
        if !learn && !bound {
            return 0;
        }
        if down != 0
            && let Some(app) = APP.get()
        {
            let _ = app.emit("media-key", MediaKey { keys, repeat: repeat != 0 });
        }
        1
    }

    pub fn init(app: AppHandle) {
        let _ = APP.set(app);
    }

    /// Sets the bound keys and starts the tap when first needed.
    pub fn set(keys: Vec<String>, learn: bool) -> Result<(), String> {
        let needed = learn || !keys.is_empty();
        *BOUND.lock().map_err(|e| e.to_string())? = Some(keys.into_iter().collect());
        LEARN.store(learn, Ordering::Relaxed);
        if !needed || RUNNING.load(Ordering::Relaxed) {
            return Ok(());
        }
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("media-keys".into())
            .spawn(move || {
                let ok = unsafe { mk_create(on_key) } == 0;
                let _ = tx.send(ok);
                if ok {
                    unsafe { mk_run() };
                }
            })
            .map_err(|e| e.to_string())?;
        if rx.recv().unwrap_or(false) {
            RUNNING.store(true, Ordering::Relaxed);
            Ok(())
        } else {
            Err("permission".into())
        }
    }

    pub fn trusted(prompt: bool) -> bool {
        unsafe { mk_trusted(prompt as i32) == 1 }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn init(_app: tauri::AppHandle) {}
    pub fn set(_keys: Vec<String>, _learn: bool) -> Result<(), String> {
        Ok(())
    }
    pub fn trusted(_prompt: bool) -> bool {
        true
    }
}

pub use imp::{init, set, trusted};
