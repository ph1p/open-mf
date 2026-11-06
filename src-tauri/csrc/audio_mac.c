// Core Audio shim: system output devices, their volume and mute, and which apps play.
// Plain C so it needs no bindings crate; Rust calls it from `src/sysaudio.rs`.

#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <libproc.h>
#include <string.h>
#include <unistd.h>

// Private but long-stable libsystem call: the app a helper process belongs to
// (e.g. Safari for com.apple.WebKit.GPU). Weak, so a missing symbol only loses that mapping.
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t) __attribute__((weak_import));

static AudioObjectPropertyAddress addr(AudioObjectPropertySelector sel, AudioObjectPropertyScope scope,
                                       AudioObjectPropertyElement el) {
    AudioObjectPropertyAddress a = {sel, scope, el};
    return a;
}

/// Fills `ids` with devices that have output channels. Returns the count, or -1.
int sa_outputs(uint32_t *ids, int max) {
    AudioObjectPropertyAddress a = addr(kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal,
                                        kAudioObjectPropertyElementMain);
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &a, 0, NULL, &size)) return -1;
    int n = (int)(size / sizeof(AudioObjectID));
    AudioObjectID all[128];
    if (n > 128) n = 128;
    size = (UInt32)(n * sizeof(AudioObjectID));
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, &size, all)) return -1;
    n = (int)(size / sizeof(AudioObjectID));
    int out = 0;
    for (int i = 0; i < n && out < max; i++) {
        AudioObjectPropertyAddress s = addr(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput,
                                            kAudioObjectPropertyElementMain);
        UInt32 ss = 0;
        if (AudioObjectGetPropertyDataSize(all[i], &s, 0, NULL, &ss) == 0 && ss > 0) ids[out++] = all[i];
    }
    return out;
}

/// UTF-8 device name into `buf`. Returns 0 on success.
int sa_name(uint32_t id, char *buf, int len) {
    AudioObjectPropertyAddress a = addr(kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal,
                                        kAudioObjectPropertyElementMain);
    CFStringRef s = NULL;
    UInt32 size = sizeof(s);
    if (AudioObjectGetPropertyData(id, &a, 0, NULL, &size, &s) || !s) return -1;
    Boolean ok = CFStringGetCString(s, buf, len, kCFStringEncodingUTF8);
    CFRelease(s);
    return ok ? 0 : -1;
}

uint32_t sa_default_output(void) {
    AudioObjectPropertyAddress a = addr(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal,
                                        kAudioObjectPropertyElementMain);
    AudioObjectID id = 0;
    UInt32 size = sizeof(id);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, &size, &id)) return 0;
    return id;
}

int sa_set_default_output(uint32_t id) {
    AudioObjectPropertyAddress a = addr(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal,
                                        kAudioObjectPropertyElementMain);
    AudioObjectID v = id;
    return AudioObjectSetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, sizeof(v), &v) ? -1 : 0;
}

/// Elements that carry a settable property: the main element, else channels 1 and 2.
static int elements(uint32_t id, AudioObjectPropertySelector sel, AudioObjectPropertyElement *els) {
    AudioObjectPropertyAddress a = addr(sel, kAudioObjectPropertyScopeOutput, kAudioObjectPropertyElementMain);
    Boolean settable = false;
    if (AudioObjectHasProperty(id, &a) && AudioObjectIsPropertySettable(id, &a, &settable) == 0 && settable) {
        els[0] = kAudioObjectPropertyElementMain;
        return 1;
    }
    int n = 0;
    for (AudioObjectPropertyElement ch = 1; ch <= 2; ch++) {
        a.mElement = ch;
        settable = false;
        if (AudioObjectHasProperty(id, &a) && AudioObjectIsPropertySettable(id, &a, &settable) == 0 && settable)
            els[n++] = ch;
    }
    return n;
}

/// Output volume 0..1. Returns -1 when the device has no software volume.
int sa_get_volume(uint32_t id, float *v) {
    AudioObjectPropertyElement els[2];
    int n = elements(id, kAudioDevicePropertyVolumeScalar, els);
    if (!n) return -1;
    float sum = 0;
    for (int i = 0; i < n; i++) {
        AudioObjectPropertyAddress a = addr(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeOutput, els[i]);
        Float32 x = 0;
        UInt32 size = sizeof(x);
        if (AudioObjectGetPropertyData(id, &a, 0, NULL, &size, &x)) return -1;
        sum += x;
    }
    *v = sum / (float)n;
    return 0;
}

int sa_set_volume(uint32_t id, float v) {
    AudioObjectPropertyElement els[2];
    int n = elements(id, kAudioDevicePropertyVolumeScalar, els);
    if (!n) return -1;
    Float32 x = v < 0 ? 0 : v > 1 ? 1 : v;
    for (int i = 0; i < n; i++) {
        AudioObjectPropertyAddress a = addr(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeOutput, els[i]);
        if (AudioObjectSetPropertyData(id, &a, 0, NULL, sizeof(x), &x)) return -1;
    }
    return 0;
}

/// Mute state into `on`. Returns -1 when the device has no software mute.
int sa_get_mute(uint32_t id, int *on) {
    AudioObjectPropertyElement els[2];
    if (!elements(id, kAudioDevicePropertyMute, els)) return -1;
    AudioObjectPropertyAddress a = addr(kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput, els[0]);
    UInt32 x = 0, size = sizeof(x);
    if (AudioObjectGetPropertyData(id, &a, 0, NULL, &size, &x)) return -1;
    *on = x != 0;
    return 0;
}

int sa_set_mute(uint32_t id, int on) {
    AudioObjectPropertyElement els[2];
    int n = elements(id, kAudioDevicePropertyMute, els);
    if (!n) return -1;
    UInt32 x = on ? 1 : 0;
    for (int i = 0; i < n; i++) {
        AudioObjectPropertyAddress a = addr(kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput, els[i]);
        if (AudioObjectSetPropertyData(id, &a, 0, NULL, sizeof(x), &x)) return -1;
    }
    return 0;
}

/// Display name of the app behind `pid`: the outermost "X.app" in its path, else the file name.
static void app_name(pid_t pid, char *buf, int len) {
    if (responsibility_get_pid_responsible_for_pid) {
        pid_t r = responsibility_get_pid_responsible_for_pid(pid);
        if (r > 0) pid = r;
    }
    char path[PROC_PIDPATHINFO_MAXSIZE];
    buf[0] = 0;
    if (proc_pidpath(pid, path, sizeof(path)) <= 0) return;
    char *app = strstr(path, ".app/");
    if (app) {
        *app = 0;
        char *start = strrchr(path, '/');
        strlcpy(buf, start ? start + 1 : path, len);
        return;
    }
    char *base = strrchr(path, '/');
    strlcpy(buf, base ? base + 1 : path, len);
}

/// Apps playing sound right now. `device` 0 = any device, else only apps using it.
/// Writes `max` names of `name_len` bytes each into `names`. Returns the count, or -1
/// when this macOS has no process list (before 14.2).
int sa_playing(uint32_t device, char *names, int name_len, int max) {
    AudioObjectPropertyAddress a = addr(kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyScopeGlobal,
                                        kAudioObjectPropertyElementMain);
    if (!AudioObjectHasProperty(kAudioObjectSystemObject, &a)) return -1;
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &a, 0, NULL, &size)) return -1;
    AudioObjectID procs[256];
    if (size > sizeof(procs)) size = sizeof(procs);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, &size, procs)) return -1;
    int n = (int)(size / sizeof(AudioObjectID)), out = 0;
    pid_t self = getpid();
    for (int i = 0; i < n && out < max; i++) {
        AudioObjectPropertyAddress r = addr(kAudioProcessPropertyIsRunningOutput, kAudioObjectPropertyScopeGlobal,
                                            kAudioObjectPropertyElementMain);
        UInt32 running = 0, rs = sizeof(running);
        if (AudioObjectGetPropertyData(procs[i], &r, 0, NULL, &rs, &running) || !running) continue;
        if (device) {
            AudioObjectPropertyAddress d = addr(kAudioProcessPropertyDevices, kAudioObjectPropertyScopeOutput,
                                                kAudioObjectPropertyElementMain);
            AudioObjectID devs[16];
            UInt32 ds = sizeof(devs);
            int uses = 0;
            if (AudioObjectGetPropertyData(procs[i], &d, 0, NULL, &ds, devs) == 0)
                for (UInt32 k = 0; k < ds / sizeof(AudioObjectID); k++) uses |= devs[k] == device;
            if (!uses) continue;
        }
        AudioObjectPropertyAddress p = addr(kAudioProcessPropertyPID, kAudioObjectPropertyScopeGlobal,
                                            kAudioObjectPropertyElementMain);
        pid_t pid = 0;
        UInt32 ps = sizeof(pid);
        if (AudioObjectGetPropertyData(procs[i], &p, 0, NULL, &ps, &pid) || pid == self) continue;
        char *slot = names + out * name_len;
        app_name(pid, slot, name_len);
        if (slot[0]) out++;
    }
    return out;
}
