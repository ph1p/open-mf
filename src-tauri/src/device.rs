//! MiniFuse control protocol (interop facts only).
//!
//! Writes: class request, recipient interface 0 (bmRequestType 0x21), bRequest 34,
//! wValue = (param << 8) | index, wIndex 0, payload = u16 LE value.
//! Param ids: 0 = INST (index = input), 3 = 48V (index 0). Initial selectors came from the
//! public mf-cli project (MIT, github.com/nolight132/mf-cli).
//! Reads: bmRequestType 0xA1, bRequest 0xA2 (162), same wValue/wIndex, returns the u16 LE value.
//! GET with bRequest 34 stalls; reads must use 0xA2.
//!
//! MiniFuse 4: everything here is verified on hardware. MiniFuse 1 and 2: product ids and
//! write selectors come from mf-cli only and are not verified here; reads may not work.

use std::sync::Mutex;

use serde::Serialize;

use crate::usb::{self, UsbError};

pub const VID: u16 = 0x1C75;

/// Which MiniFuse is attached. Decides the selectors and whether the mixer exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Model {
    MiniFuse1,
    MiniFuse2,
    MiniFuse4,
}

/// Product ids, most likely first. MF1 has a second id (per mf-cli).
const MODELS: [(u16, Model); 4] =
    [(0xAF70, Model::MiniFuse4), (0xAF90, Model::MiniFuse2), (0xAF80, Model::MiniFuse1), (0xAF82, Model::MiniFuse1)];

/// What the UI may show for a model.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub name: &'static str,
    /// Mic / instrument inputs on the front.
    pub inputs: u8,
    /// Internal DSP mixer, routing and meters (MiniFuse 4 only).
    pub mixer: bool,
    pub controls: Vec<Control>,
}

impl Model {
    pub fn has_mixer(self) -> bool {
        self == Model::MiniFuse4
    }

    pub fn info(self) -> DeviceInfo {
        let (name, inputs) = match self {
            Model::MiniFuse1 => ("MiniFuse 1", 1),
            Model::MiniFuse2 => ("MiniFuse 2", 2),
            Model::MiniFuse4 => ("MiniFuse 4", 2),
        };
        let controls = Control::ALL.into_iter().filter(|c| c.selector(self).is_some()).collect();
        DeviceInfo { name, inputs, mixer: self.has_mixer(), controls }
    }
}

/// Product id of the attached device, once found. Cleared when it disappears.
static CURRENT: Mutex<Option<u16>> = Mutex::new(None);

fn lock_current() -> std::sync::MutexGuard<'static, Option<u16>> {
    CURRENT.lock().unwrap_or_else(|e| e.into_inner())
}

fn model_of(pid: u16) -> Model {
    MODELS.iter().find(|(p, _)| *p == pid).map_or(Model::MiniFuse4, |(_, m)| *m)
}

/// The attached MiniFuse. Probes every known product id until one answers.
pub fn model() -> Result<Model, UsbError> {
    if let Some(pid) = *lock_current() {
        return Ok(model_of(pid));
    }
    for (pid, m) in MODELS {
        if usb::present(VID, pid)? {
            *lock_current() = Some(pid);
            return Ok(m);
        }
    }
    Err(UsbError::NotFound)
}

/// One control transfer to the attached MiniFuse.
fn request(rt: u8, rq: u8, wv: u16, wi: u16, buf: &mut [u8]) -> Result<usize, UsbError> {
    model()?;
    let pid = lock_current().ok_or(UsbError::NotFound)?;
    let r = usb::control(VID, pid, rt, rq, wv, wi, buf);
    if matches!(r, Err(UsbError::NotFound)) {
        // Unplugged, or swapped for another model: detect again next time.
        *lock_current() = None;
    }
    r
}

const REQ_SET: u8 = 34;
const REQ_GET: u8 = 0xA2;
/// Meter block: 16 little-endian u32 linear peaks (full scale ~2^31). The vendor app polls
/// this at ~30 Hz with wValue 0, wIndex 0, 64 bytes.
const REQ_METERS: u8 = 0xC2;
const RT_CLASS_IFACE_OUT: u8 = 0x21;
const RT_CLASS_IFACE_IN: u8 = 0xA1;
const UAC2_CUR: u8 = 0x01;
const CLOCK_SELECTOR_ENTITY: u16 = 40;
const CLOCK_SOURCE_ENTITY: u16 = 41;

/// Every writable control. Only these selectors can ever be written.
#[derive(Debug, Clone, Copy, serde::Deserialize, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Control {
    Inst1,
    Inst2,
    Phantom48v,
    /// Mono direct monitoring (MiniFuse 1 and 2).
    Monitor,
}

impl Control {
    pub const ALL: [Control; 4] = [Control::Inst1, Control::Inst2, Control::Phantom48v, Control::Monitor];

    /// The selector on this model, or None when the model lacks the control.
    pub fn selector(self, model: Model) -> Option<u16> {
        use Model::*;
        match (self, model) {
            (Control::Inst1, _) => Some(0x0000),
            (Control::Inst2, MiniFuse2 | MiniFuse4) => Some(0x0001),
            (Control::Phantom48v, MiniFuse4) => Some(0x0300),
            (Control::Phantom48v, MiniFuse1 | MiniFuse2) => Some(0x0400),
            (Control::Monitor, MiniFuse1 | MiniFuse2) => Some(0x0500),
            _ => None,
        }
    }
}

/// Errors with `Stall` when the attached model has no such control.
fn selector(control: Control) -> Result<u16, UsbError> {
    control.selector(model()?).ok_or(UsbError::Stall)
}

/// Writes one 16-bit param word. Callers must validate (param, idx, value) first;
/// only `set_switch` and the `mixer` module call this.
pub(crate) fn write_param(param: u8, idx: u8, value: u16) -> Result<(), UsbError> {
    let mut data = value.to_le_bytes();
    let wv = (u16::from(param) << 8) | u16::from(idx);
    let n = request(RT_CLASS_IFACE_OUT, REQ_SET, wv, 0, &mut data)?;
    if n == data.len() { Ok(()) } else { Err(UsbError::Io(0)) }
}

/// Reads one 16-bit param word (read-only, always safe).
pub(crate) fn read_param(param: u8, idx: u8) -> Result<u16, UsbError> {
    let mut data = [0u8; 2];
    let wv = (u16::from(param) << 8) | u16::from(idx);
    let n = request(RT_CLASS_IFACE_IN, REQ_GET, wv, 0, &mut data)?;
    if n == data.len() { Ok(u16::from_le_bytes(data)) } else { Err(UsbError::Io(0)) }
}

/// Raw meter words (linear peak, full scale ~2^31). Verified with music on USB 1/2:
/// 0-3 analog in 1-4, 4-9 USB playback 1-6, 10-11 Main mix L/R (bus 0, post-master),
/// 12-13 Cue 1 mix L/R (bus 1, pre-master), 14-15 Cue 2 mix L/R (bus 2, pre-master).
/// Output source routing does not move any word, so these are mix buses, not outputs.
pub(crate) fn read_meters() -> Result<[u32; 16], UsbError> {
    let mut data = [0u8; 64];
    let n = request(RT_CLASS_IFACE_IN, REQ_METERS, 0, 0, &mut data)?;
    if n != data.len() {
        return Err(UsbError::Io(0));
    }
    let mut out = [0u32; 16];
    for (i, w) in out.iter_mut().enumerate() {
        *w = u32::from_le_bytes(data[i * 4..i * 4 + 4].try_into().unwrap());
    }
    Ok(out)
}

pub fn set_switch(control: Control, on: bool) -> Result<(), UsbError> {
    let s = selector(control)?;
    write_param((s >> 8) as u8, s as u8, on as u16)
}

/// Reads the current value of a control from the device.
pub fn get_switch(control: Control) -> Result<bool, UsbError> {
    let s = selector(control)?;
    Ok(read_param((s >> 8) as u8, s as u8)? != 0)
}

/// Reads which clock input is selected (UAC2 selector CUR). Doubles as a presence probe.
pub fn clock_selector() -> Result<u8, UsbError> {
    let mut buf = [0u8; 1];
    request(RT_CLASS_IFACE_IN, UAC2_CUR, 0x0100, CLOCK_SELECTOR_ENTITY << 8, &mut buf)?;
    Ok(buf[0])
}

/// Current sample rate in Hz (UAC2 clock source SAM_FREQ CUR, entity 41).
pub fn sample_rate() -> Result<u32, UsbError> {
    let mut buf = [0u8; 4];
    request(RT_CLASS_IFACE_IN, UAC2_CUR, 0x0100, CLOCK_SOURCE_ENTITY << 8, &mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selectors_per_model() {
        assert_eq!(Control::Phantom48v.selector(Model::MiniFuse4), Some(0x0300));
        assert_eq!(Control::Phantom48v.selector(Model::MiniFuse2), Some(0x0400));
        assert_eq!(Control::Inst2.selector(Model::MiniFuse1), None);
        assert_eq!(Control::Monitor.selector(Model::MiniFuse4), None);
        assert_eq!(Model::MiniFuse1.info().controls, vec![Control::Inst1, Control::Phantom48v, Control::Monitor]);
        assert!(Model::MiniFuse4.info().mixer && !Model::MiniFuse2.info().mixer);
    }
}
