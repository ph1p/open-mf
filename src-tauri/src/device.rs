//! MiniFuse 4 control protocol (interop facts only, verified on hardware).
//!
//! Writes: class request, recipient interface 0 (bmRequestType 0x21), bRequest 34,
//! wValue = (param << 8) | index, wIndex 0, payload = u16 LE value.
//! Param ids: 0 = INST (index = input), 3 = 48V (index 0). Initial selectors came from the
//! public mf-cli project (MIT, github.com/nolight132/mf-cli).
//! Reads: bmRequestType 0xA1, bRequest 0xA2 (162), same wValue/wIndex, returns the u16 LE value.
//! GET with bRequest 34 stalls; reads must use 0xA2.

use serde::Serialize;

use crate::usb::{self, UsbError};

pub const VID: u16 = 0x1C75;
pub const PID_MF4: u16 = 0xAF70;

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
#[derive(Debug, Clone, Copy, serde::Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum Control {
    Inst1,
    Inst2,
    Phantom48v,
}

impl Control {
    fn selector(self) -> u16 {
        match self {
            Control::Inst1 => 0x0000,
            Control::Inst2 => 0x0001,
            Control::Phantom48v => 0x0300,
        }
    }
}

/// Writes one 16-bit param word. Callers must validate (param, idx, value) first;
/// only `set_switch` and the `mixer` module call this.
pub(crate) fn write_param(param: u8, idx: u8, value: u16) -> Result<(), UsbError> {
    let mut data = value.to_le_bytes();
    let wv = (u16::from(param) << 8) | u16::from(idx);
    let n = usb::control(VID, PID_MF4, RT_CLASS_IFACE_OUT, REQ_SET, wv, 0, &mut data)?;
    if n == data.len() { Ok(()) } else { Err(UsbError::Io(0)) }
}

/// Reads one 16-bit param word (read-only, always safe).
pub(crate) fn read_param(param: u8, idx: u8) -> Result<u16, UsbError> {
    let mut data = [0u8; 2];
    let wv = (u16::from(param) << 8) | u16::from(idx);
    let n = usb::control(VID, PID_MF4, RT_CLASS_IFACE_IN, REQ_GET, wv, 0, &mut data)?;
    if n == data.len() { Ok(u16::from_le_bytes(data)) } else { Err(UsbError::Io(0)) }
}

/// Raw meter words (linear peak, full scale ~2^31). Verified with music on USB 1/2:
/// 0-3 analog in 1-4, 4-9 USB playback 1-6, 10-11 Main mix L/R (bus 0, post-master),
/// 12-13 Cue 1 mix L/R (bus 1, pre-master), 14-15 Cue 2 mix L/R (bus 2, pre-master).
/// Output source routing does not move any word, so these are mix buses, not outputs.
pub(crate) fn read_meters() -> Result<[u32; 16], UsbError> {
    let mut data = [0u8; 64];
    let n = usb::control(VID, PID_MF4, RT_CLASS_IFACE_IN, REQ_METERS, 0, 0, &mut data)?;
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
    let s = control.selector();
    write_param((s >> 8) as u8, s as u8, on as u16)
}

/// Reads the current value of a control from the device.
pub fn get_switch(control: Control) -> Result<bool, UsbError> {
    let s = control.selector();
    Ok(read_param((s >> 8) as u8, s as u8)? != 0)
}

/// Reads which clock input is selected (UAC2 selector CUR). Doubles as a presence probe.
pub fn clock_selector() -> Result<u8, UsbError> {
    let mut buf = [0u8; 1];
    usb::control(VID, PID_MF4, RT_CLASS_IFACE_IN, UAC2_CUR, 0x0100, CLOCK_SELECTOR_ENTITY << 8, &mut buf)?;
    Ok(buf[0])
}

/// Current sample rate in Hz (UAC2 clock source SAM_FREQ CUR, entity 41).
pub fn sample_rate() -> Result<u32, UsbError> {
    let mut buf = [0u8; 4];
    usb::control(VID, PID_MF4, RT_CLASS_IFACE_IN, UAC2_CUR, 0x0100, CLOCK_SOURCE_ENTITY << 8, &mut buf)?;
    Ok(u32::from_le_bytes(buf))
}
