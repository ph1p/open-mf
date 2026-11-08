//! MIDI input for shortcuts: buttons, knobs and faders on any connected controller.
//!
//! One thread keeps a connection to every MIDI input (new devices are picked up within a few
//! seconds) and sends notes, CCs, program changes and pitch bend to the window as `midi`
//! events. Virtual ports count too, so other apps (Stream Deck, Bome, TouchOSC, the IAC bus)
//! can trigger shortcuts as well.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct MidiEvent {
    port: String,
    /// "note" (value 0 = released), "cc", "pc" or "pb".
    kind: &'static str,
    /// 1..16.
    ch: u8,
    /// Note or controller number. Program number for "pc", 0 for "pb".
    num: u8,
    /// 0..127, or 0..16383 for pitch bend.
    value: u16,
}

static STARTED: AtomicBool = AtomicBool::new(false);
static PORTS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn parse(port: &str, msg: &[u8]) -> Option<MidiEvent> {
    let (&status, data) = msg.split_first()?;
    let ch = (status & 0x0F) + 1;
    let d = |i: usize| data.get(i).copied().map(|b| b & 0x7F);
    let (kind, num, value) = match status & 0xF0 {
        0x90 => ("note", d(0)?, d(1)? as u16),
        0x80 => ("note", d(0)?, 0),
        0xB0 => ("cc", d(0)?, d(1)? as u16),
        0xC0 => ("pc", d(0)?, 127),
        0xE0 => ("pb", 0, d(0)? as u16 | (d(1)? as u16) << 7),
        _ => return None,
    };
    Some(MidiEvent { port: port.to_string(), kind, ch, num, value })
}

/// Connects to all MIDI inputs and keeps doing so. Safe to call more than once.
pub fn start(app: AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new().name("midi".into()).spawn(move || {
        // Connections live here; dropping one closes it.
        let mut open: HashMap<String, midir::MidiInputConnection<()>> = HashMap::new();
        loop {
            if let Ok(probe) = midir::MidiInput::new("Open MF") {
                let ports = probe.ports();
                let names: Vec<String> = ports.iter().filter_map(|p| probe.port_name(p).ok()).collect();
                open.retain(|name, _| names.contains(name));
                for name in &names {
                    if open.contains_key(name) {
                        continue;
                    }
                    let Ok(mut input) = midir::MidiInput::new("Open MF") else { continue };
                    input.ignore(midir::Ignore::All);
                    let Some(port) = input.ports().into_iter().find(|p| input.port_name(p).ok().as_ref() == Some(name))
                    else {
                        continue;
                    };
                    let (app, label) = (app.clone(), name.clone());
                    let conn = input.connect(
                        &port,
                        "Open MF input",
                        move |_, msg, _| {
                            if let Some(ev) = parse(&label, msg) {
                                let _ = app.emit("midi", ev);
                            }
                        },
                        (),
                    );
                    if let Ok(c) = conn {
                        open.insert(name.clone(), c);
                    }
                }
                let mut connected: Vec<String> = open.keys().cloned().collect();
                connected.sort();
                if let Ok(mut p) = PORTS.lock()
                    && *p != connected
                {
                    *p = connected.clone();
                    let _ = app.emit("midi-ports", connected);
                }
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

pub fn ports() -> Vec<String> {
    PORTS.lock().map(|p| p.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_messages() {
        let n = parse("x", &[0x91, 60, 100]).unwrap();
        assert_eq!((n.kind, n.ch, n.num, n.value), ("note", 2, 60, 100));
        assert_eq!(parse("x", &[0x80, 60, 64]).unwrap().value, 0);
        let c = parse("x", &[0xB0, 7, 127]).unwrap();
        assert_eq!((c.kind, c.num, c.value), ("cc", 7, 127));
        assert_eq!(parse("x", &[0xE0, 0x7F, 0x7F]).unwrap().value, 16383);
        assert!(parse("x", &[0xF8]).is_none());
        assert!(parse("x", &[0xB0, 7]).is_none());
    }
}
