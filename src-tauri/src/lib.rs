mod device;
mod mediakeys;
#[cfg(desktop)]
mod midi;
mod mixer;
mod sysaudio;
mod usb;

use device::Control;
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::Emitter;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    /// False when this OS has no USB control backend yet (only macOS has one).
    supported: bool,
    connected: bool,
    /// The attached model and what it can do.
    device: Option<device::DeviceInfo>,
    clock_selector: Option<u8>,
    sample_rate: Option<u32>,
    /// Current switch states the device reported. Controls it could not read are missing.
    switches: Option<BTreeMap<Control, bool>>,
    error: Option<String>,
}

impl Status {
    fn offline(supported: bool, error: Option<String>) -> Self {
        Status {
            supported,
            connected: error.is_some(),
            device: None,
            clock_selector: None,
            sample_rate: None,
            switches: None,
            error,
        }
    }
}

fn read_switches(info: &device::DeviceInfo) -> BTreeMap<Control, bool> {
    info.controls.iter().filter_map(|&c| Some((c, device::get_switch(c).ok()?))).collect()
}

#[tauri::command]
fn mixer_meters() -> Result<Vec<Option<f64>>, String> {
    mixer::meters().map_err(|e| e.to_string())
}

#[tauri::command]
fn status() -> Status {
    let model = match device::model() {
        Ok(m) => m,
        Err(usb::UsbError::NotFound) => return Status::offline(true, None),
        Err(usb::UsbError::Unsupported) => return Status::offline(false, None),
        Err(e) => return Status::offline(true, Some(e.to_string())),
    };
    // The clock read doubles as a presence check: it fails with NotFound once unplugged.
    let clock = device::clock_selector();
    let error = match &clock {
        Err(usb::UsbError::NotFound) => return Status::offline(true, None),
        // Clock entities are only verified on the MiniFuse 4; elsewhere a failure is expected.
        Err(e) if model.has_mixer() => Some(e.to_string()),
        _ => None,
    };
    let info = model.info();
    let switches = read_switches(&info);
    Status {
        supported: true,
        connected: true,
        clock_selector: clock.ok(),
        sample_rate: device::sample_rate().ok(),
        switches: (!switches.is_empty()).then_some(switches),
        device: Some(info),
        error,
    }
}

#[tauri::command]
fn set_switch(control: Control, on: bool) -> Result<(), String> {
    device::set_switch(control, on).map_err(|e| e.to_string())
}

#[tauri::command]
fn mixer_state() -> Result<mixer::MixerState, String> {
    mixer::read_state().map_err(|e| e.to_string())
}

#[tauri::command]
fn mixer_apply(op: mixer::Op) -> Result<(), String> {
    mixer::apply(op).map_err(|e| e.to_string())
}

/// Applies ops in order (presets). Stops at the first failure; earlier ops stay applied.
#[tauri::command]
fn mixer_apply_many(ops: Vec<mixer::Op>) -> Result<(), String> {
    ops.into_iter().try_for_each(|op| mixer::apply(op).map_err(|e| e.to_string()))
}

/// OS output devices, the MiniFuse's system volume and the apps playing to it.
#[tauri::command]
async fn system_audio() -> sysaudio::SystemAudio {
    // Off the main thread: Core Audio and pactl calls can take a few ms each.
    tauri::async_runtime::spawn_blocking(sysaudio::state).await.unwrap_or_default()
}

#[tauri::command]
async fn set_default_output(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sysaudio::set_default_output(&id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_system_volume(volume: f32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sysaudio::set_volume(volume)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_system_mute(on: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sysaudio::set_mute(on)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_app_volume(id: String, volume: f32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sysaudio::set_app_volume(&id, volume))
        .await
        .map_err(|e| e.to_string())?
}

/// Binds media keys (macOS). Err("permission") until Open MF has Accessibility access.
#[tauri::command]
fn media_keys_set(keys: Vec<String>, learn: bool) -> Result<(), String> {
    mediakeys::set(keys, learn)
}

/// Whether media keys can be watched. `prompt` opens the system dialog that leads to Settings.
#[tauri::command]
fn media_keys_trusted(prompt: bool) -> bool {
    mediakeys::trusted(prompt)
}

/// Starts listening to MIDI inputs. Returns the connected ones so far.
#[tauri::command]
fn midi_start(app: tauri::AppHandle) -> Vec<String> {
    #[cfg(desktop)]
    {
        midi::start(app);
        midi::ports()
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Vec::new()
    }
}

/// The standard macOS menu with "Check for Updates…" under "About Open MF".
#[cfg(target_os = "macos")]
fn add_update_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    let menu = Menu::default(app.handle())?;
    if let Some(app_menu) = menu.items()?.first().and_then(|i| i.as_submenu()) {
        let item = MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?;
        app_menu.insert(&item, 1)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Remember size, position and maximized state. Decorations stay as configured per OS.
    let window_state = tauri_plugin_window_state::Builder::default()
        .with_state_flags(
            tauri_plugin_window_state::StateFlags::SIZE
                | tauri_plugin_window_state::StateFlags::POSITION
                | tauri_plugin_window_state::StateFlags::MAXIMIZED,
        )
        .build();

    let builder = tauri::Builder::default().plugin(window_state);
    // User-defined shortcuts that work while another app is in front.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    // Updates from GitHub releases (signed latest.json) and the relaunch after installing one.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            mediakeys::init(app.handle().clone());
            #[cfg(target_os = "macos")]
            add_update_menu(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "check-updates" {
                let _ = app.emit("check-updates", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            status,
            set_switch,
            mixer_state,
            mixer_apply,
            mixer_apply_many,
            mixer_meters,
            system_audio,
            set_default_output,
            set_system_volume,
            set_system_mute,
            set_app_volume,
            media_keys_set,
            media_keys_trusted,
            midi_start
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
