// macOS USB control-transfer shim.
//
// Uses IOUSBDeviceInterface::DeviceRequestTO at device level WITHOUT opening the
// device. CoreAudio owns the audio interfaces exclusively, and libusb refuses
// interface-recipient requests on unclaimed interfaces; the kernel accepts them
// through the device user client.
#include <stdint.h>
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/usb/IOUSBLib.h>

#define FP_NOT_FOUND (-1)

static IOUSBDeviceInterface650 **g_dev = NULL;

static void fp_close(void) {
  if (g_dev) {
    (*g_dev)->Release(g_dev);
    g_dev = NULL;
  }
}

static int fp_open(uint16_t vid, uint16_t pid) {
  if (g_dev) return 0;
  CFMutableDictionaryRef m = IOServiceMatching("IOUSBHostDevice");
  int v = vid, p = pid;
  CFNumberRef nv = CFNumberCreate(NULL, kCFNumberIntType, &v);
  CFNumberRef np = CFNumberCreate(NULL, kCFNumberIntType, &p);
  CFDictionarySetValue(m, CFSTR("idVendor"), nv);
  CFDictionarySetValue(m, CFSTR("idProduct"), np);
  CFRelease(nv);
  CFRelease(np);
  io_service_t svc = IOServiceGetMatchingService(kIOMainPortDefault, m); // consumes m
  if (!svc) return FP_NOT_FOUND;
  IOCFPlugInInterface **plug = NULL;
  SInt32 score;
  kern_return_t kr = IOCreatePlugInInterfaceForService(
      svc, kIOUSBDeviceUserClientTypeID, kIOCFPlugInInterfaceID, &plug, &score);
  IOObjectRelease(svc);
  if (kr || !plug) return kr ? kr : FP_NOT_FOUND;
  HRESULT hr = (*plug)->QueryInterface(
      plug, CFUUIDGetUUIDBytes(kIOUSBDeviceInterfaceID650), (LPVOID *)&g_dev);
  (*plug)->Release(plug);
  if (hr || !g_dev) {
    g_dev = NULL;
    return FP_NOT_FOUND;
  }
  return 0;
}

// Returns 0 on success, FP_NOT_FOUND if no device, else an IOReturn code.
int fp_request(uint16_t vid, uint16_t pid, uint8_t rt, uint8_t rq, uint16_t wv,
               uint16_t wi, uint8_t *buf, uint16_t len, uint16_t *done) {
  for (int attempt = 0; attempt < 2; attempt++) {
    int rc = fp_open(vid, pid);
    if (rc) return rc;
    IOUSBDevRequestTO r = {
        .bmRequestType = rt, .bRequest = rq, .wValue = wv, .wIndex = wi,
        .wLength = len, .pData = buf, .noDataTimeout = 200, .completionTimeout = 200};
    kern_return_t kr = (*g_dev)->DeviceRequestTO(g_dev, &r);
    if (kr == kIOReturnSuccess) {
      if (done) *done = (uint16_t)r.wLenDone;
      return 0;
    }
    // Stale handle after unplug/replug: drop it and retry once with a fresh match.
    if (kr == kIOReturnNoDevice || kr == kIOReturnNotResponding || kr == MACH_SEND_INVALID_DEST) {
      fp_close();
      continue;
    }
    return kr;
  }
  return FP_NOT_FOUND;
}
