//! MiniFuse 4 internal mixer, routing and input extras (interop facts verified on hardware,
//! see the analysis ledger). Every write goes through a typed op that range-checks its
//! (param, idx, value) before it reaches the device.
//!
//! Buses: 0 = Outputs 1&2 (Main), 1 = Outputs 3&4 (Cue 1), 2 = Loopback (Cue 2).
//! Channels: 0-3 = Analog in 1-4, 4-9 = USB playback 1-6.
//! Gains are signed i16 in 1/256 dB; 0x8000 = off. Pan is not stored: the left and right
//! crosspoint gains carry fader + pan with a sin/cos law (-3.01 dB per side at center).

use serde::{Deserialize, Serialize};

use crate::device::{read_meters, read_param, write_param};
use crate::usb::UsbError;

pub const BUSES: u8 = 3;
pub const CHANNELS: u8 = 10;

const P_LINK_34: u8 = 6;
const P_LED_INTENSITY: u8 = 8;
const P_GAIN_L: u8 = 9; // + 20 * bus
const P_GAIN_R: u8 = 19; // + 20 * bus
const P_MASTER: u8 = 69; // idx = bus
const P_TRIM: u8 = 72; // idx = channel (2, 3)
const P_MUTE: u8 = 76; // + bus, idx = channel
const P_SOLO: u8 = 79; // + bus, idx = channel
const P_SOURCE: u8 = 88; // + bus, idx 0

const OFF: u16 = 0x8000;
/// Lowest fader position before "off".
pub const FADER_MIN_DB: f64 = -60.0;
/// Highest channel fader value seen in the vendor app (+10 dB).
pub const FADER_MAX_DB: f64 = 10.0;
/// Bus master tops out at 0 dB in the vendor app.
pub const MASTER_MAX_DB: f64 = 0.0;
pub const TRIM_RANGE_DB: f64 = 24.0;
/// Output sources: 0 USB1/2, 1 Main mix, 2 USB3/4, 3 Cue 1 mix, 4 USB5/6, 5 Cue 2 mix, 6 OUT1/2, 7 OUT3/4.
pub const SOURCE_COUNT: u16 = 8;
/// LED intensity 0..=4 = 20..100 %.
pub const LED_LEVELS: u16 = 5;

#[derive(Debug, thiserror::Error)]
pub enum MixerError {
    #[error("{0}")]
    Usb(#[from] UsbError),
    #[error("value out of range: {0}")]
    Range(&'static str),
    #[error("this MiniFuse has no software mixer")]
    NoMixer,
}

/// Mixer params only exist on the MiniFuse 4. Never send them to another model.
fn require_mixer() -> Result<(), MixerError> {
    if crate::device::model()?.has_mixer() { Ok(()) } else { Err(MixerError::NoMixer) }
}

fn check(ok: bool, what: &'static str) -> Result<(), MixerError> {
    if ok { Ok(()) } else { Err(MixerError::Range(what)) }
}

fn check_bus_ch(bus: u8, ch: u8) -> Result<(), MixerError> {
    check(bus < BUSES, "bus")?;
    check(ch < CHANNELS, "channel")
}

/// dB -> device word. Truncates toward zero, matching the vendor app's values.
fn db_to_raw(db: f64) -> u16 {
    if !db.is_finite() || db < FADER_MIN_DB - 40.0 {
        return OFF;
    }
    ((db * 256.0) as i32).clamp(-32767, 32767) as i16 as u16
}

fn raw_to_db(raw: u16) -> f64 {
    if raw == OFF { f64::NEG_INFINITY } else { f64::from(raw as i16) / 256.0 }
}

/// Fader level + pan (-1 left .. 1 right) -> (left, right) crosspoint words.
pub fn pan_to_sides(level_db: Option<f64>, pan: f64) -> (u16, u16) {
    let Some(level) = level_db else { return (OFF, OFF) };
    let theta = (pan.clamp(-1.0, 1.0) + 1.0) * std::f64::consts::FRAC_PI_4;
    let side = |g: f64| if g < 1e-6 { OFF } else { db_to_raw(level + 20.0 * g.log10()) };
    (side(theta.cos()), side(theta.sin()))
}

/// Inverse of `pan_to_sides`: total power gives the level, the L/R ratio gives the pan.
/// The vendor app's fader bottom ("-inf") writes -60 dB, not `OFF`, so anything at or
/// below the fader floor reads back as off. The pan is kept so re-adding restores it.
pub fn sides_to_pan(l: u16, r: u16) -> (Option<f64>, f64) {
    let lin = |raw: u16| if raw == OFF { 0.0 } else { 10f64.powf(raw_to_db(raw) / 20.0) };
    let (a, b) = (lin(l), lin(r));
    let power = a * a + b * b;
    if power <= 0.0 {
        return (None, 0.0);
    }
    let pan = b.atan2(a) / std::f64::consts::FRAC_PI_4 - 1.0;
    let level = 10.0 * power.log10();
    (level_or_off(level), pan)
}

/// `None` at or below the fader floor (the vendor app's "-inf").
fn level_or_off(db: f64) -> Option<f64> {
    (db > FADER_MIN_DB + 0.01).then_some(db)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Strip {
    /// Fader level in dB; `None` = off.
    pub level_db: Option<f64>,
    pub pan: f64,
    pub mute: bool,
    pub solo: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bus {
    pub master_db: Option<f64>,
    pub source: u16,
    pub strips: Vec<Strip>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixerState {
    pub buses: Vec<Bus>,
    pub link34: bool,
    /// Digital trim for inputs 3 and 4, in dB.
    pub trim_db: [f64; 2],
    pub led_intensity: u16,
}

pub fn read_state() -> Result<MixerState, MixerError> {
    require_mixer()?;
    let mut buses = Vec::with_capacity(BUSES as usize);
    for bus in 0..BUSES {
        let mut strips = Vec::with_capacity(CHANNELS as usize);
        for ch in 0..CHANNELS {
            let l = read_param(P_GAIN_L + 20 * bus, ch)?;
            let r = read_param(P_GAIN_R + 20 * bus, ch)?;
            let (level_db, pan) = sides_to_pan(l, r);
            strips.push(Strip {
                level_db,
                pan,
                mute: read_param(P_MUTE + bus, ch)? != 0,
                solo: read_param(P_SOLO + bus, ch)? != 0,
            });
        }
        let master = read_param(P_MASTER, bus)?;
        buses.push(Bus { master_db: level_or_off(raw_to_db(master)), source: read_param(P_SOURCE + bus, 0)?, strips });
    }
    Ok(MixerState {
        buses,
        link34: read_param(P_LINK_34, 0)? != 0,
        trim_db: [raw_to_db(read_param(P_TRIM, 2)?), raw_to_db(read_param(P_TRIM, 3)?)],
        led_intensity: read_param(P_LED_INTENSITY, 0)?,
    })
}

/// Number of meter values: one per channel, then L/R for each of the 3 mix buses.
pub const METERS: usize = CHANNELS as usize + 2 * 3;

/// Peak levels in dBFS; `None` = silence. Indices 0-9 = channels (analog 1-4, USB 1-6),
/// then `CHANNELS + 2*bus` / `+1` = bus L/R (Main post-master, Cue 1/2 pre-master).
pub fn meters() -> Result<Vec<Option<f64>>, MixerError> {
    require_mixer()?;
    let words = read_meters()?;
    Ok(words[..METERS].iter().map(|&w| (w != 0).then(|| 20.0 * (f64::from(w) / 2_147_483_648.0).log10())).collect())
}

/// One validated write. The frontend can only reach the device through these.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    Level {
        bus: u8,
        ch: u8,
        level_db: Option<f64>,
        pan: f64,
    },
    Mute {
        bus: u8,
        ch: u8,
        on: bool,
    },
    Solo {
        bus: u8,
        ch: u8,
        on: bool,
    },
    Master {
        bus: u8,
        level_db: Option<f64>,
    },
    Source {
        bus: u8,
        source: u16,
    },
    Link34 {
        on: bool,
    },
    /// `input` is 3 or 4.
    Trim {
        input: u8,
        db: f64,
    },
    LedIntensity {
        level: u16,
    },
}

pub fn apply(op: Op) -> Result<(), MixerError> {
    require_mixer()?;
    match op {
        Op::Level { bus, ch, level_db, pan } => {
            check_bus_ch(bus, ch)?;
            check(pan.is_finite() && (-1.0..=1.0).contains(&pan), "pan")?;
            let level = level_db.filter(|db| *db >= FADER_MIN_DB);
            if let Some(db) = level {
                check(db <= FADER_MAX_DB, "level")?;
            }
            // Off is written like the vendor app's fader bottom: -60 dB with the pan kept,
            // so re-adding the channel (here or in the vendor app) restores its position.
            let (l, r) = pan_to_sides(Some(level.unwrap_or(FADER_MIN_DB)), pan);
            write_param(P_GAIN_L + 20 * bus, ch, l)?;
            write_param(P_GAIN_R + 20 * bus, ch, r)?;
        }
        Op::Mute { bus, ch, on } => {
            check_bus_ch(bus, ch)?;
            write_param(P_MUTE + bus, ch, on as u16)?;
        }
        Op::Solo { bus, ch, on } => {
            check_bus_ch(bus, ch)?;
            write_param(P_SOLO + bus, ch, on as u16)?;
        }
        Op::Master { bus, level_db } => {
            check(bus < BUSES, "bus")?;
            let raw = match level_db.filter(|db| *db >= FADER_MIN_DB) {
                Some(db) => {
                    check(db <= MASTER_MAX_DB, "master")?;
                    db_to_raw(db)
                }
                None => OFF,
            };
            write_param(P_MASTER, bus, raw)?;
        }
        Op::Source { bus, source } => {
            check(bus < BUSES, "bus")?;
            check(source < SOURCE_COUNT, "source")?;
            write_param(P_SOURCE + bus, 0, source)?;
        }
        Op::Link34 { on } => write_param(P_LINK_34, 0, on as u16)?,
        Op::Trim { input, db } => {
            check(input == 3 || input == 4, "trim input")?;
            check(db.is_finite() && db.abs() <= TRIM_RANGE_DB, "trim")?;
            write_param(P_TRIM, input - 1, db_to_raw(db))?;
        }
        Op::LedIntensity { level } => {
            check(level < LED_LEVELS, "led intensity")?;
            write_param(P_LED_INTENSITY, 0, level)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn center_pan_matches_vendor_values() {
        // 0 dB fader at center -> 0xfcfe on both sides; +4 dB -> 0x00fd.
        assert_eq!(pan_to_sides(Some(0.0), 0.0), (0xfcfe, 0xfcfe));
        assert_eq!(pan_to_sides(Some(4.0), 0.0), (0x00fd, 0x00fd));
    }

    #[test]
    fn hard_pan_turns_other_side_off() {
        assert_eq!(pan_to_sides(Some(0.0), -1.0), (0x0000, OFF));
        assert_eq!(pan_to_sides(Some(0.0), 1.0), (OFF, 0x0000));
    }

    #[test]
    fn round_trip() {
        let (l, r) = pan_to_sides(Some(-6.0), 0.4);
        let (db, pan) = sides_to_pan(l, r);
        assert!((db.unwrap() + 6.0).abs() < 0.02);
        assert!((pan - 0.4).abs() < 0.01);
        assert_eq!(sides_to_pan(OFF, OFF).0, None);
    }

    #[test]
    fn vendor_minus_inf_reads_as_off() {
        // Vendor app fader at "-inf", panned hard right: L off, R -60 dB.
        let (db, pan) = sides_to_pan(OFF, 0xc400);
        assert_eq!(db, None);
        assert!((pan - 1.0).abs() < 1e-9);
    }

    #[test]
    fn floor_keeps_pan_and_reads_as_off() {
        for pan in [-1.0, -0.4, 0.0, 0.7, 1.0] {
            let (l, r) = pan_to_sides(Some(FADER_MIN_DB), pan);
            let (db, back) = sides_to_pan(l, r);
            assert_eq!(db, None, "pan {pan}");
            assert!((back - pan).abs() < 0.01, "pan {pan} read back as {back}");
        }
    }

    #[test]
    fn rejects_out_of_range() {
        assert!(apply(Op::Level { bus: 3, ch: 0, level_db: Some(0.0), pan: 0.0 }).is_err());
        assert!(apply(Op::Level { bus: 0, ch: 0, level_db: Some(12.0), pan: 0.0 }).is_err());
        assert!(apply(Op::Source { bus: 0, source: 8 }).is_err());
        assert!(apply(Op::Trim { input: 1, db: 0.0 }).is_err());
        assert!(apply(Op::LedIntensity { level: 5 }).is_err());
    }

    /// Needs a connected MiniFuse 4. Read-only: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn hardware_read_state() {
        let st = read_state().expect("read");
        for (b, bus) in st.buses.iter().enumerate() {
            println!("bus{b} master={:?} source={}", bus.master_db, bus.source);
            for (c, s) in bus.strips.iter().enumerate() {
                println!("  ch{c} {:?} pan={:.2} mute={} solo={}", s.level_db, s.pan, s.mute, s.solo);
            }
        }
        println!("link={} trim={:?} led={}", st.link34, st.trim_db, st.led_intensity);
    }

    /// Needs a connected MiniFuse 4. Writes the Loopback master once, then restores the exact
    /// original word: `cargo test hardware_write_roundtrip -- --ignored`.
    #[test]
    #[ignore]
    fn hardware_write_roundtrip() {
        let orig = read_param(P_MASTER, 2).expect("read");
        apply(Op::Master { bus: 2, level_db: Some(-12.0) }).expect("write");
        std::thread::sleep(std::time::Duration::from_millis(150));
        let got = read_param(P_MASTER, 2).expect("readback");
        write_param(P_MASTER, 2, orig).expect("restore");
        assert_eq!(got, db_to_raw(-12.0));
        assert_eq!(read_param(P_MASTER, 2).expect("verify"), orig);
        println!("orig={orig:#06x} wrote={got:#06x} restored");
    }

    /// Needs a connected MiniFuse 4 with audio playing. Read-only.
    #[test]
    #[ignore]
    fn hardware_meters() {
        let m = meters().expect("meters");
        println!("meters dBFS: {m:?}");
        assert_eq!(m.len(), METERS);
    }
}
