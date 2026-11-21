//! The front-panel A button on the MiniFuse 4 brings Open MF to the front.
//!
//! The device keeps a press counter in param 7 (`ABUTTON` in the vendor agent), counting
//! 0..=9 and wrapping. No event is sent, so a thread polls it and treats any change as a
//! press. Polling runs in Rust so it keeps working while the window is hidden or minimized.

use std::thread;
use std::time::Duration;

use tauri::AppHandle;

use crate::device;

const P_A_BUTTON: u8 = 7;
/// Any change brings the window forward, so presses merged between polls don't matter;
/// only exactly 10 presses between two reads would go unseen.
const POLL: Duration = Duration::from_millis(250);
/// Without a MiniFuse 4 there is nothing to watch; look again now and then. Detection is
/// left to the status poll, so this only reads the cached model and never probes USB.
const IDLE: Duration = Duration::from_secs(1);

pub fn init(app: AppHandle) {
    thread::spawn(move || {
        // (connection, counter). A new connection starts fresh, so replugging is no press.
        let mut last: Option<(u32, u16)> = None;
        loop {
            let read = device::current_model()
                .filter(|m| m.has_mixer())
                .and_then(|_| device::read_param(P_A_BUTTON, 0).ok())
                .map(|v| (device::connection(), v));
            if let (Some((conn, prev)), Some((now_conn, v))) = (last, read)
                && conn == now_conn
                && prev != v
            {
                crate::show_main(&app);
            }
            last = read;
            thread::sleep(if read.is_some() { POLL } else { IDLE });
        }
    });
}
