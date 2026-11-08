// Media keys (volume, mute, play, next, ...) on macOS.
//
// Apple keyboards send these as NSSystemDefined events, not key events, so Carbon hotkeys
// never see the volume keys. A session event tap does, and can swallow the ones we use.
// Needs Accessibility permission; mk_create returns -1 without it.

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

// key: NX_KEYTYPE_*, flags: CGEventFlags, down: 1 press / 0 release, repeat: key held.
// Returns 1 to swallow the event, 0 to pass it on.
typedef int (*mk_callback)(int key, unsigned long long flags, int down, int repeat);

static mk_callback g_cb = NULL;
static CFMachPortRef g_tap = NULL;

static CGEventRef on_event(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *info) {
    (void)proxy;
    (void)info;
    // The system turns slow taps off; turn it back on.
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (g_tap) CGEventTapEnable(g_tap, true);
        return event;
    }
    if ((int)type != (int)NSEventTypeSystemDefined || !g_cb) return event;
    @autoreleasepool {
        NSEvent *ev = [NSEvent eventWithCGEvent:event];
        // Subtype 8 = NX_SUBTYPE_AUX_CONTROL_BUTTONS: the media keys.
        if (!ev || ev.subtype != 8) return event;
        NSInteger data = ev.data1;
        int key = (int)((data & 0xFFFF0000) >> 16);
        int state = (int)((data & 0xFF00) >> 8);
        int repeat = (int)(data & 0x1);
        if (state != 0xA && state != 0xB) return event;
        int swallow = g_cb(key, (unsigned long long)CGEventGetFlags(event), state == 0xA, repeat);
        return swallow ? NULL : event;
    }
}

// Creates the tap on the calling thread's run loop. 0 = ok, -1 = no permission.
int mk_create(mk_callback cb) {
    g_cb = cb;
    CGEventMask mask = CGEventMaskBit(NSEventTypeSystemDefined);
    g_tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault, mask, on_event, NULL);
    if (!g_tap) return -1;
    CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
    CFRelease(src);
    CGEventTapEnable(g_tap, true);
    return 0;
}

// Blocks, delivering events to the callback.
void mk_run(void) {
    CFRunLoopRun();
}

// Whether Open MF may watch keys. prompt = 1 shows the system dialog that leads to Settings.
int mk_trusted(int prompt) {
    NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @(prompt != 0)};
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts) ? 1 : 0;
}
