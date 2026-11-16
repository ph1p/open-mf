//! Remembers the window's size, position and maximized state in logical pixels.
//!
//! tauri-plugin-window-state stores physical pixels and restores them as-is. With displays of
//! different scale factors that is wrong: a size saved on a Retina display came back twice as
//! large on a 1x display, and the position halved on every launch.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow, WindowEvent};

/// Matches `minWidth` / `minHeight` in tauri.conf.json.
const MIN: (f64, f64) = (720.0, 560.0);

#[derive(Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
struct State {
    /// Top-left corner and inner size while not maximized, fullscreen or minimized.
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
}

struct Saved(Mutex<Option<State>>);

fn file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("window.json"))
}

fn load(app: &AppHandle) -> Option<State> {
    serde_json::from_slice(&fs::read(file(app)?).ok()?).ok()
}

/// Writes the remembered state. Called when the window loses focus, closes, and on exit.
pub fn save(app: &AppHandle) {
    let Some(state) = app.try_state::<Saved>().and_then(|s| *s.0.lock().unwrap()) else { return };
    let Some(path) = file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_vec(&state) {
        let _ = fs::write(path, json);
    }
}

/// Reads the live window into `state`. Size and position keep their last normal values while
/// the window is maximized, fullscreen or minimized.
fn track(win: &WebviewWindow, state: &mut State) {
    let (Ok(scale), Ok(size), Ok(pos)) = (win.scale_factor(), win.inner_size(), win.outer_position()) else { return };
    let maximized = win.is_maximized().unwrap_or(false);
    let normal = !maximized && !win.is_fullscreen().unwrap_or(false) && size.width > 0 && size.height > 0;
    if normal {
        let (s, p) = (size.to_logical::<f64>(scale), pos.to_logical::<f64>(scale));
        (state.x, state.y, state.width, state.height) = (p.x, p.y, s.width, s.height);
    }
    state.maximized = maximized;
}

/// Restores the saved state, fitted to the displays that are attached now, and tracks changes.
pub fn init(window: &WebviewWindow) {
    let app = window.app_handle();
    let saved = load(app);

    if let Some(s) = saved {
        // Only go back to a spot that is still on a display; otherwise the OS places the window.
        let on_screen = window.available_monitors().unwrap_or_default().iter().any(|m| {
            let (p, size) =
                (m.position().to_logical::<f64>(m.scale_factor()), m.size().to_logical::<f64>(m.scale_factor()));
            // The title bar must be reachable: its left part inside the display.
            (p.x..p.x + size.width - 80.0).contains(&s.x) && (p.y..p.y + size.height - 40.0).contains(&s.y)
        });
        if on_screen {
            let _ = window.set_position(LogicalPosition::new(s.x, s.y));
        }
        let (mut w, mut h) = (s.width.max(MIN.0), s.height.max(MIN.1));
        if let Ok(Some(m)) = window.current_monitor() {
            let area = m.work_area().size.to_logical::<f64>(m.scale_factor());
            (w, h) = (w.min(area.width), h.min(area.height));
        }
        let _ = window.set_size(LogicalSize::new(w, h));
        if s.maximized {
            let _ = window.maximize();
        }
    }

    let mut state = saved.unwrap_or_default();
    track(window, &mut state);
    app.manage(Saved(Mutex::new(Some(state))));

    let win = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
            if let Some(state) = win.state::<Saved>().0.lock().unwrap().as_mut() {
                track(&win, state);
            }
        }
        WindowEvent::Focused(false) | WindowEvent::CloseRequested { .. } => save(win.app_handle()),
        _ => {}
    });
}
