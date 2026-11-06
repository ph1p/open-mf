//! Raw USB control transfers. macOS only for now (IOKit shim in `csrc/usb_mac.c`).

#[cfg(target_os = "macos")]
use std::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum UsbError {
    #[error("device not connected")]
    NotFound,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    #[error("device rejected the request (stall)")]
    Stall,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    #[error("USB error 0x{0:08x}")]
    Io(u32),
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    #[error("unsupported platform")]
    Unsupported,
}

#[cfg(target_os = "macos")]
const IO_RETURN_PIPE_STALLED: u32 = 0xe000_404f;

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn fp_probe(vid: u16, pid: u16) -> i32;
    fn fp_request(vid: u16, pid: u16, rt: u8, rq: u8, wv: u16, wi: u16, buf: *mut u8, len: u16, done: *mut u16) -> i32;
}

/// Serializes all transfers; the C shim keeps one cached device handle.
#[cfg(target_os = "macos")]
static LOCK: Mutex<()> = Mutex::new(());

/// True when a device with this vendor and product id is attached.
pub fn present(vid: u16, pid: u16) -> Result<bool, UsbError> {
    #[cfg(target_os = "macos")]
    {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        match unsafe { fp_probe(vid, pid) } {
            0 => Ok(true),
            -1 => Ok(false),
            c => Err(UsbError::Io(c as u32)),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (vid, pid);
        Err(UsbError::Unsupported)
    }
}

pub fn control(vid: u16, pid: u16, rt: u8, rq: u8, wv: u16, wi: u16, buf: &mut [u8]) -> Result<usize, UsbError> {
    #[cfg(target_os = "macos")]
    {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut done: u16 = 0;
        let len = u16::try_from(buf.len()).map_err(|_| UsbError::Io(0))?;
        let rc = unsafe { fp_request(vid, pid, rt, rq, wv, wi, buf.as_mut_ptr(), len, &mut done) };
        match rc {
            0 => Ok(done as usize),
            -1 => Err(UsbError::NotFound),
            c if c as u32 == IO_RETURN_PIPE_STALLED => Err(UsbError::Stall),
            c => Err(UsbError::Io(c as u32)),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (vid, pid, rt, rq, wv, wi, buf);
        Err(UsbError::Unsupported)
    }
}
