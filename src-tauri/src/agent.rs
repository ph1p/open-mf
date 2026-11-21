//! Login agent that opens Open MF from the front-panel A button while the app is closed.
//!
//! The vendor ships a background agent for this; ours is the same binary started by
//! launchd with `--agent`. It never builds a Tauri app (no window, no Dock icon) and only
//! polls the A-button counter. While Open MF runs, the app polls the button itself
//! (`abutton`), so the agent stays idle: the app holds an exclusive lock on `app.lock`
//! for its lifetime, and the agent watches the button only while it can take that lock.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

use crate::device;

pub const FLAG: &str = "--agent";
const LABEL: &str = "com.phlp.minifuse-panel.agent";
/// Same folder Tauri uses as app data dir on macOS (bundle identifier).
const DATA_DIR: &str = "Library/Application Support/com.phlp.minifuse-panel";

const P_A_BUTTON: u8 = 7;
const POLL: Duration = Duration::from_millis(250);
const IDLE: Duration = Duration::from_secs(1);

unsafe extern "C" {
    fn getuid() -> u32;
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn lock_path() -> Option<PathBuf> {
    Some(home()?.join(DATA_DIR).join("app.lock"))
}

fn plist_path() -> Option<PathBuf> {
    Some(home()?.join("Library/LaunchAgents").join(format!("{LABEL}.plist")))
}

fn open_lock() -> Option<File> {
    let path = lock_path()?;
    fs::create_dir_all(path.parent()?).ok()?;
    File::options().create(true).truncate(false).write(true).open(path).ok()
}

/// Called by the app at startup: holds the lock until the process exits. The agent takes
/// it for a moment on each check, so retry until it is ours.
pub fn hold_app_lock() {
    static HELD: OnceLock<File> = OnceLock::new();
    let Some(file) = open_lock() else { return };
    thread::spawn(move || {
        for _ in 0..50 {
            if file.try_lock().is_ok() {
                let _ = HELD.set(file);
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    });
}

/// True while Open MF itself runs (it holds the lock).
fn app_running(lock: &File) -> bool {
    match lock.try_lock() {
        Ok(()) => {
            let _ = lock.unlock();
            false
        }
        Err(_) => true,
    }
}

/// The `.app` bundle the running binary lives in, if any.
fn bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(Path::to_path_buf)
}

fn launch_app() {
    let _ = match bundle() {
        Some(app) => Command::new("/usr/bin/open").arg(app).spawn(),
        // Dev build outside a bundle: start the binary directly.
        None => std::env::current_exe().and_then(|exe| Command::new(exe).spawn()),
    };
}

/// Entry point for `--agent`. Never returns.
pub fn run() -> ! {
    let lock = open_lock();
    // (connection, counter) seen while the app was closed. Reset whenever the app runs,
    // since presses it handled changed the counter.
    let mut last: Option<(u32, u16)> = None;
    loop {
        if lock.as_ref().is_some_and(app_running) {
            last = None;
            thread::sleep(IDLE);
            continue;
        }
        let read = device::model()
            .ok()
            .filter(|m| m.has_mixer())
            .and_then(|_| device::read_param(P_A_BUTTON, 0).ok())
            .map(|v| (device::connection(), v));
        if let (Some((conn, prev)), Some((now_conn, v))) = (last, read)
            && conn == now_conn
            && prev != v
        {
            launch_app();
            // The app takes over; don't count presses until it has quit again.
            last = None;
            thread::sleep(Duration::from_secs(3));
            continue;
        }
        last = read;
        thread::sleep(if read.is_some() { POLL } else { IDLE });
    }
}

fn launchctl(args: &[&str]) -> bool {
    Command::new("/bin/launchctl").args(args).output().is_ok_and(|o| o.status.success())
}

fn domain() -> String {
    format!("gui/{}", unsafe { getuid() })
}

fn plist(exe: &Path) -> String {
    let exe = exe.to_string_lossy().replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>{exe}</string><string>{FLAG}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
"#
    )
}

pub fn enabled() -> bool {
    plist_path().is_some_and(|p| p.exists())
}

/// Writes the LaunchAgent and (re)starts it, so it always runs the current binary.
fn install() -> Result<(), String> {
    let path = plist_path().ok_or("no home folder")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    fs::create_dir_all(path.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
    fs::write(&path, plist(&exe)).map_err(|e| e.to_string())?;
    let domain = domain();
    launchctl(&["bootout", &format!("{domain}/{LABEL}")]);
    // bootout returns before the old job is gone; bootstrap fails until then.
    for _ in 0..10 {
        if launchctl(&["bootstrap", &domain, &path.to_string_lossy()]) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err("launchctl could not start the A-button agent".into())
}

fn uninstall() -> Result<(), String> {
    launchctl(&["bootout", &format!("{}/{LABEL}", domain())]);
    match plist_path() {
        Some(p) if p.exists() => fs::remove_file(p).map_err(|e| e.to_string()),
        _ => Ok(()),
    }
}

pub fn set_enabled(on: bool) -> Result<(), String> {
    if on { install() } else { uninstall() }
}

/// After an update or a move, the running agent may be an old binary or point at a stale
/// path. Re-register it once per app start.
pub fn refresh() {
    if enabled() {
        thread::spawn(|| {
            let _ = install();
        });
    }
}
