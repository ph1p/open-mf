//! System audio: which output the OS uses, the MiniFuse's system volume, and which apps
//! play. macOS uses Core Audio (`csrc/audio_mac.c`), Linux uses `pactl` (PulseAudio or
//! PipeWire). Other platforms report `supported: false` and the UI hides the section.

use serde::Serialize;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudio {
    pub supported: bool,
    /// Every output device the OS knows.
    pub outputs: Vec<Output>,
    /// The MiniFuse's output id, when the OS sees it.
    pub device: Option<String>,
    /// System volume of the MiniFuse output, 0..1. None when the OS has no volume for it.
    pub volume: Option<f32>,
    pub muted: Option<bool>,
    /// Apps playing to the MiniFuse. None when this OS version cannot list them.
    pub apps: Option<Vec<App>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub id: String,
    pub name: String,
    /// Per-app volume 0..1, where the OS supports it (Linux).
    pub volume: Option<f32>,
}

#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
fn is_minifuse(name: &str) -> bool {
    name.to_lowercase().contains("minifuse")
}

pub use imp::{set_app_volume, set_default_output, set_mute, set_volume, state};

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::ffi::{CStr, c_char, c_int};

    unsafe extern "C" {
        fn sa_outputs(ids: *mut u32, max: c_int) -> c_int;
        fn sa_name(id: u32, buf: *mut c_char, len: c_int) -> c_int;
        fn sa_default_output() -> u32;
        fn sa_set_default_output(id: u32) -> c_int;
        fn sa_get_volume(id: u32, v: *mut f32) -> c_int;
        fn sa_set_volume(id: u32, v: f32) -> c_int;
        fn sa_get_mute(id: u32, on: *mut c_int) -> c_int;
        fn sa_set_mute(id: u32, on: c_int) -> c_int;
        fn sa_playing(device: u32, names: *mut c_char, name_len: c_int, max: c_int) -> c_int;
    }

    const NAME_LEN: usize = 128;

    fn name_of(id: u32) -> String {
        let mut buf = [0 as c_char; NAME_LEN];
        if unsafe { sa_name(id, buf.as_mut_ptr(), NAME_LEN as c_int) } != 0 {
            return format!("Device {id}");
        }
        unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned()
    }

    fn minifuse() -> Option<u32> {
        let mut ids = [0u32; 64];
        let n = unsafe { sa_outputs(ids.as_mut_ptr(), 64) };
        ids[..n.max(0) as usize].iter().copied().find(|&id| is_minifuse(&name_of(id)))
    }

    fn parse(id: &str) -> Result<u32, String> {
        id.parse().map_err(|_| format!("bad device id {id}"))
    }

    pub fn state() -> SystemAudio {
        let mut ids = [0u32; 64];
        let n = unsafe { sa_outputs(ids.as_mut_ptr(), 64) }.max(0) as usize;
        let def = unsafe { sa_default_output() };
        let outputs: Vec<Output> = ids[..n]
            .iter()
            .map(|&id| Output { id: id.to_string(), name: name_of(id), is_default: id == def })
            .collect();
        let dev = outputs.iter().find(|o| is_minifuse(&o.name)).and_then(|o| o.id.parse::<u32>().ok());

        let (mut volume, mut muted, mut apps) = (None, None, None);
        if let Some(id) = dev {
            let mut v = 0f32;
            if unsafe { sa_get_volume(id, &mut v) } == 0 {
                volume = Some(v);
            }
            let mut m: c_int = 0;
            if unsafe { sa_get_mute(id, &mut m) } == 0 {
                muted = Some(m != 0);
            }
            const MAX: usize = 32;
            let mut buf = vec![0 as c_char; NAME_LEN * MAX];
            let k = unsafe { sa_playing(id, buf.as_mut_ptr(), NAME_LEN as c_int, MAX as c_int) };
            if k >= 0 {
                let mut list: Vec<App> = Vec::new();
                for i in 0..k as usize {
                    let name = unsafe { CStr::from_ptr(buf.as_ptr().add(i * NAME_LEN)) }.to_string_lossy().into_owned();
                    // Several helper processes of one app collapse into one row.
                    if !list.iter().any(|a| a.name == name) {
                        list.push(App { id: name.clone(), name, volume: None });
                    }
                }
                apps = Some(list);
            }
        }
        SystemAudio { supported: true, outputs, device: dev.map(|d| d.to_string()), volume, muted, apps }
    }

    pub fn set_default_output(id: &str) -> Result<(), String> {
        let ok = unsafe { sa_set_default_output(parse(id)?) } == 0;
        ok.then_some(()).ok_or_else(|| "could not change the system output".into())
    }

    pub fn set_volume(v: f32) -> Result<(), String> {
        let id = minifuse().ok_or("MiniFuse output not found")?;
        let ok = unsafe { sa_set_volume(id, v) } == 0;
        ok.then_some(()).ok_or_else(|| "this output has no system volume".into())
    }

    pub fn set_mute(on: bool) -> Result<(), String> {
        let id = minifuse().ok_or("MiniFuse output not found")?;
        let ok = unsafe { sa_set_mute(id, on as c_int) } == 0;
        ok.then_some(()).ok_or_else(|| "this output has no system mute".into())
    }

    pub fn set_app_volume(_id: &str, _v: f32) -> Result<(), String> {
        Err("per-app volume is not available on macOS".into())
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use serde_json::Value;
    use std::process::Command;

    fn pactl(args: &[&str]) -> Result<String, String> {
        let out = Command::new("pactl").args(args).output().map_err(|e| format!("pactl: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn list(kind: &str) -> Result<Vec<Value>, String> {
        let text = pactl(&["-f", "json", "list", kind])?;
        match serde_json::from_str(&text) {
            Ok(Value::Array(v)) => Ok(v),
            _ => Err("unexpected pactl output".into()),
        }
    }

    /// Mean channel volume, 0..1 (65536 = 100 %).
    fn volume_of(v: &Value) -> Option<f32> {
        let chans = v.get("volume")?.as_object()?;
        let vals: Vec<f64> = chans.values().filter_map(|c| c.get("value")?.as_f64()).collect();
        (!vals.is_empty()).then(|| (vals.iter().sum::<f64>() / vals.len() as f64 / 65536.0) as f32)
    }

    fn sink_label(s: &Value) -> String {
        s.get("description").or_else(|| s.get("name")).and_then(Value::as_str).unwrap_or("Output").to_string()
    }

    fn minifuse_sink() -> Result<Value, String> {
        list("sinks")?
            .into_iter()
            .find(|s| is_minifuse(&sink_label(s)) || s.get("name").and_then(Value::as_str).is_some_and(is_minifuse))
            .ok_or_else(|| "MiniFuse output not found".into())
    }

    fn pct(v: f32) -> String {
        format!("{}%", (v.clamp(0.0, 1.0) * 100.0).round() as u32)
    }

    pub fn state() -> SystemAudio {
        let Ok(sinks) = list("sinks") else {
            // No pactl (or no sound server): nothing to show.
            return SystemAudio::default();
        };
        let def = pactl(&["get-default-sink"]).map(|s| s.trim().to_string()).unwrap_or_default();
        let outputs = sinks
            .iter()
            .filter_map(|s| {
                let name = s.get("name")?.as_str()?.to_string();
                Some(Output { is_default: name == def, name: sink_label(s), id: name })
            })
            .collect::<Vec<_>>();
        let mf = sinks
            .iter()
            .find(|s| is_minifuse(&sink_label(s)) || s.get("name").and_then(Value::as_str).is_some_and(is_minifuse));
        let Some(mf) = mf else {
            return SystemAudio { supported: true, outputs, ..Default::default() };
        };
        let index = mf.get("index").and_then(Value::as_u64);
        let apps = list("sink-inputs").ok().map(|inputs| {
            inputs
                .iter()
                .filter(|i| i.get("sink").and_then(Value::as_u64) == index)
                .filter_map(|i| {
                    let props = i.get("properties")?;
                    let name = props
                        .get("application.name")
                        .or_else(|| props.get("media.name"))
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown app")
                        .to_string();
                    Some(App { id: i.get("index")?.as_u64()?.to_string(), name, volume: volume_of(i) })
                })
                .collect()
        });
        SystemAudio {
            supported: true,
            device: mf.get("name").and_then(Value::as_str).map(str::to_string),
            volume: volume_of(mf),
            muted: mf.get("mute").and_then(Value::as_bool),
            outputs,
            apps,
        }
    }

    pub fn set_default_output(id: &str) -> Result<(), String> {
        pactl(&["set-default-sink", id]).map(|_| ())
    }

    pub fn set_volume(v: f32) -> Result<(), String> {
        let s = minifuse_sink()?;
        let name = s.get("name").and_then(Value::as_str).ok_or("MiniFuse output not found")?;
        pactl(&["set-sink-volume", name, &pct(v)]).map(|_| ())
    }

    pub fn set_mute(on: bool) -> Result<(), String> {
        let s = minifuse_sink()?;
        let name = s.get("name").and_then(Value::as_str).ok_or("MiniFuse output not found")?;
        pactl(&["set-sink-mute", name, if on { "1" } else { "0" }]).map(|_| ())
    }

    pub fn set_app_volume(id: &str, v: f32) -> Result<(), String> {
        pactl(&["set-sink-input-volume", id, &pct(v)]).map(|_| ())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod imp {
    use super::*;

    const NO: &str = "system audio is not supported on this OS yet";

    pub fn state() -> SystemAudio {
        SystemAudio::default()
    }
    pub fn set_default_output(_id: &str) -> Result<(), String> {
        Err(NO.into())
    }
    pub fn set_volume(_v: f32) -> Result<(), String> {
        Err(NO.into())
    }
    pub fn set_mute(_on: bool) -> Result<(), String> {
        Err(NO.into())
    }
    pub fn set_app_volume(_id: &str, _v: f32) -> Result<(), String> {
        Err(NO.into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn detects_minifuse_names() {
        assert!(super::is_minifuse("MiniFuse 4"));
        assert!(super::is_minifuse("alsa_output.usb-ARTURIA_MiniFuse_4-00.analog-stereo"));
        assert!(!super::is_minifuse("MacBook Pro Speakers"));
    }
}

#[cfg(test)]
mod live {
    #[test]
    #[ignore]
    fn print_state() {
        println!("{}", serde_json::to_string_pretty(&super::state()).unwrap());
    }
}
