//! The front-panel A button on the MiniFuse 4 brings Open MF to the front.
//!
//! The device keeps a press counter in param 7 (`ABUTTON` in the vendor agent), counting
//! 0..=9 and wrapping. No event is sent, so a thread polls it and treats any change as a
//! press. Polling runs in Rust so it keeps working while the window is hidden or minimized.

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::device;

const P_A_BUTTON: u8 = 7;
/// Fast enough for a quick double press (presses ~160 ms apart were seen).
const POLL: Duration = Duration::from_millis(100);
/// Without a MiniFuse 4 there is nothing to watch; look again now and then.
const IDLE: Duration = Duration::from_secs(1);

pub fn init(app: AppHandle) {
    thread::spawn(move || {
        // (connection, counter). A new connection starts fresh, so replugging is no press.
        let mut last: Option<(u32, u16)> = None;
        loop {
            let read = device::model()
                .ok()
                .filter(|m| m.has_mixer())
                .and_then(|_| device::read_param(P_A_BUTTON, 0).ok())
                .map(|v| (device::connection(), v));
            match (last, read) {
                (Some((conn, prev)), Some((now_conn, v))) if conn == now_conn && prev != v => bring_to_front(&app),
                _ => {}
            }
            last = read;
            thread::sleep(if read.is_some() { POLL } else { IDLE });
        }
    });
}

fn bring_to_front(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}
