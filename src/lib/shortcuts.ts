import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { toast } from "sonner";
import {
  app, applyPreset, flip, follow, nudge, redo, setBus, setLevel, toggleSwitch, undo, unitName, unitOf, unitsOf, type LevelTarget,
} from "./app";
import { CHANNELS, MIXES, fmtDb, type Control } from "./device";
import { OS } from "./platform";
import { BUILTIN_PRESETS } from "./presets";
import { settings } from "./settings";
import { createStore } from "./store";
import { setSystemMute, setSystemVolume, sysAudio, type SystemAudio } from "./sysaudio";

// ---------------------------------------------------------------------------------------------
// Model: a shortcut is a trigger (keys and/or a MIDI control) + what it acts on + what it does
// ---------------------------------------------------------------------------------------------

export type Subject =
  | LevelTarget
  | { kind: "switch"; control: Control }
  | { kind: "preset"; id: string }
  | { kind: "mix"; bus: number }
  | { kind: "system" }
  | { kind: "app" };

export type Verb =
  | "up" | "down" | "set" | "follow" | "mute" | "solo" | "toggle" | "apply" | "show" | "undo" | "redo";

/** A MIDI control. Matches on any connected port. */
export type Midi = { type: "note" | "cc" | "pc" | "pb"; ch: number; num: number };

export type Shortcut = {
  id: string;
  /** Accelerator as the global-shortcut plugin reads it, e.g. "Super+Shift+ArrowUp". Empty = not set yet. */
  keys: string;
  /** A MIDI button, knob or fader. Null = none. */
  midi: Midi | null;
  subject: Subject;
  verb: Verb;
  /** dB step or target for levels, percent step for computer volume. Null = −∞. */
  amount: number | null;
};

export const VERBS: Record<Subject["kind"], Verb[]> = {
  level: ["up", "down", "set", "follow", "mute", "solo"],
  master: ["up", "down", "set", "follow"],
  trim: ["up", "down", "set", "follow"],
  switch: ["toggle"],
  preset: ["apply"],
  mix: ["show"],
  system: ["up", "down", "follow", "mute"],
  app: ["show", "undo", "redo"],
};

export const DB_STEPS = [0.5, 1, 2, 3, 6];
export const PERCENT_STEPS = [2, 5, 10];
/** "Set to" targets. Mix levels stop at 0 dB, channel levels at +10. */
const SET_VALUES: (number | null)[] = [null, -40, -30, -20, -12, -6, -3, 0, 6];

export function setValuesFor(s: Subject) {
  if (s.kind === "trim") return [-12, -6, 0, 6, 12];
  return SET_VALUES.filter((v) => s.kind !== "master" || v === null || v <= 0);
}

/** A sensible amount when the verb changes. */
export function defaultAmount(s: Subject, verb: Verb): number | null {
  if (verb === "up" || verb === "down") return s.kind === "system" ? 5 : 1;
  if (verb === "set") return s.kind === "master" ? -20 : 0;
  return null;
}

export const hasAmount = (v: Verb) => v === "up" || v === "down" || v === "set";
/** Follow needs a knob or fader; keys can't say where to. */
export const midiOnly = (v: Verb) => v === "follow";

const SWITCH_LABEL: Record<Control, string> = {
  inst1: "Input 1 instrument mode",
  inst2: "Input 2 instrument mode",
  phantom48v: "48 V phantom power",
  monitor: "Mono direct monitoring",
};

function presetName(id: string) {
  return BUILTIN_PRESETS.find((p) => p.id === id)?.name ?? app.get().userPresets.find((p) => p.id === id)?.name ?? null;
}

export function subjectLabel(s: Subject): string {
  switch (s.kind) {
    case "level":
      return `${unitName(unitOf(s.chs), settings.get().names)} · ${MIXES[s.bus].mixName}`;
    case "master":
      return `${MIXES[s.bus].mixName} level`;
    case "trim":
      return `Input ${s.input + 3} trim`;
    case "switch":
      return SWITCH_LABEL[s.control];
    case "preset":
      return `Preset “${presetName(s.id) ?? "deleted"}”`;
    case "mix":
      return MIXES[s.bus].mixName;
    case "system":
      return "Computer volume";
    case "app":
      return "Open MF";
  }
}

export function verbLabel(s: Subject, verb: Verb, amount: number | null): string {
  const unit = s.kind === "system" ? "%" : " dB";
  switch (verb) {
    case "up":
      return `Up ${amount}${unit}`;
    case "down":
      return `Down ${amount}${unit}`;
    case "set":
      return `Jump to ${fmtDb(amount)} · again to go back`;
    case "follow":
      return "Follows a MIDI knob or fader";
    case "mute":
      return "Mute / unmute";
    case "solo":
      return "Solo / unsolo";
    case "toggle":
      return "Turn on / off";
    case "apply":
      return "Apply";
    case "show":
      return s.kind === "app" ? "Bring window to front" : "Show in mixer";
    case "undo":
      return "Undo";
    case "redo":
      return "Redo";
  }
}

/** Verb name for the editor's picker, without an amount. */
export function verbName(s: Subject, verb: Verb): string {
  if (verb === "up") return "Turn up";
  if (verb === "down") return "Turn down";
  if (verb === "set") return "Jump to level";
  if (verb === "follow") return "Follow MIDI knob/fader";
  return verbLabel(s, verb, null);
}

/** What the shortcut editor offers, grouped. Mixer entries need a connected mixer. */
export function subjectGroups(): { label: string; items: Subject[] }[] {
  const { mixer, stat, userPresets } = app.get();
  const groups: { label: string; items: Subject[] }[] = [];
  if (mixer) {
    const units = unitsOf(mixer, CHANNELS.map((_, i) => i), settings.get().pairs);
    MIXES.forEach((mx, bus) => {
      groups.push({
        label: `${mx.mixName} (${mx.name})`,
        items: [{ kind: "master", bus }, ...units.map((u): Subject => ({ kind: "level", bus, chs: u.chs }))],
      });
    });
  }
  const inputs: Subject[] = [];
  if (mixer) inputs.push({ kind: "trim", input: 0 }, { kind: "trim", input: 1 });
  for (const control of stat.device?.controls ?? []) inputs.push({ kind: "switch", control });
  if (inputs.length) groups.push({ label: "Inputs", items: inputs });
  if (mixer) {
    groups.push({
      label: "Presets",
      items: [...BUILTIN_PRESETS, ...userPresets].map((p): Subject => ({ kind: "preset", id: p.id })),
    });
    groups.push({ label: "Mixer view", items: MIXES.map((_, bus): Subject => ({ kind: "mix", bus })) });
  }
  groups.push({ label: "Computer", items: [{ kind: "system" }] });
  groups.push({ label: "App", items: [{ kind: "app" }] });
  return groups;
}

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$|^(CapsLock|Fn|FnLock)$/;

const CODE_LABEL: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/", Backquote: "`",
  Space: "Space", Enter: OS === "mac" ? "↩" : "Enter", Tab: "Tab", Backspace: OS === "mac" ? "⌫" : "Backspace",
  Delete: OS === "mac" ? "⌦" : "Del", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn", Insert: "Ins",
  NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /",
  NumpadDecimal: "Num .", NumpadEnter: "Num Enter", NumpadEqual: "Num =",
  AudioVolumeUp: "Volume Up", AudioVolumeDown: "Volume Down", AudioVolumeMute: "Mute",
  MediaPlayPause: "Play/Pause", MediaTrackNext: "Next", MediaTrackPrevious: "Previous", MediaStop: "Stop",
  MediaFastForward: "Fast Forward", MediaRewind: "Rewind",
};

/** Codes the shortcut plugin can register. */
function keyLabel(code: string): string | null {
  if (code in CODE_LABEL) return CODE_LABEL[code];
  let m = /^Key([A-Z])$/.exec(code) ?? /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `Num ${m[1]}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return null;
}

/** Keys that are fine alone: nothing else uses them for typing. */
const standalone = (code: string) => /^F\d+$/.test(code) || isMedia(code);
const isMedia = (code: string) => /^(Audio|Media)/.test(code);
const codeOf = (keys: string) => keys.slice(keys.lastIndexOf("+") + 1);
/** Whether the shortcut ends in a media key (volume, play, ...). */
export const isMediaKeys = (keys: string) => isMedia(codeOf(keys));

type KeyResult = { keys: string } | { error: string } | null;

/** Turns a keydown into an accelerator. Null while only modifiers are held. */
export function keysFromEvent(e: KeyboardEvent): KeyResult {
  if (MODIFIER_CODES.test(e.code)) return null;
  if (keyLabel(e.code) === null) return { error: "That key can't be used for a shortcut." };
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  // Works in every app, so a plain letter would stop you from typing it anywhere.
  const realMods = mods.filter((m) => m !== "Shift");
  if (!realMods.length && !standalone(e.code)) {
    return { error: `Add ${OS === "mac" ? "⌘, ⌥ or ⌃" : "Ctrl or Alt"}. Only F-keys and media keys work alone.` };
  }
  return { keys: [...mods, e.code].join("+") };
}

const MAC_MOD: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" };
const PC_MOD: Record<string, string> = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win" };

export function formatKeys(keys: string): string {
  if (!keys) return "";
  const parts = keys.split("+");
  const code = parts.pop()!;
  const label = keyLabel(code) ?? code;
  if (OS === "mac") {
    const order = ["Control", "Alt", "Shift", "Super"];
    return order.filter((m) => parts.includes(m)).map((m) => MAC_MOD[m]).join("") + label;
  }
  return [...parts.map((m) => PC_MOD[m] ?? m), label].join("+");
}

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

function formatMidi(m: Midi): string {
  const what =
    m.type === "note" ? `Note ${NOTES[m.num % 12]}${Math.floor(m.num / 12) - 1}`
    : m.type === "cc" ? `CC ${m.num}`
    : m.type === "pc" ? `Program ${m.num + 1}`
    : "Pitch bend";
  return `${what} · ch ${m.ch}`;
}

/** Keys and MIDI control, as shown on the trigger button. */
export function formatTrigger(sc: Shortcut): string {
  return [sc.keys && formatKeys(sc.keys), sc.midi && formatMidi(sc.midi)].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

const KEY = "openmf.shortcuts.v1";
const KINDS = Object.keys(VERBS);

function validMidi(m: unknown): Midi | null {
  const x = m as Midi | null;
  if (!x || !["note", "cc", "pc", "pb"].includes(x.type) || typeof x.ch !== "number" || typeof x.num !== "number") return null;
  return { type: x.type, ch: x.ch, num: x.num };
}

function load(): Shortcut[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (x): x is Shortcut =>
          typeof x?.id === "string" &&
          typeof x.keys === "string" &&
          KINDS.includes(x.subject?.kind) &&
          VERBS[x.subject.kind as Subject["kind"]].includes(x.verb) &&
          (x.amount === null || typeof x.amount === "number"),
      )
      .map((x) => ({ ...x, midi: validMidi(x.midi) }));
  } catch {
    return [];
  }
}

export const shortcuts = createStore<Shortcut[]>(load());

shortcuts.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(shortcuts.get()));
  } catch {
    // Storage unavailable: shortcuts live for this session only.
  }
});

export type ShortcutUi = {
  open: boolean;
  /** Prefill for the "add" form, e.g. from a fader's right-click menu. */
  draft: Subject | null;
  /** Shortcut whose keys are being recorded. Global shortcuts are off meanwhile. */
  recording: string | null;
  /** Shortcuts the OS refused, usually because another app has the keys. */
  failed: Record<string, string>;
  /** macOS: media keys need Accessibility access, and Open MF doesn't have it yet. */
  mediaBlocked: boolean;
  /** Connected MIDI inputs. Null until MIDI started. */
  midiPorts: string[] | null;
  /** Shortcut that just ran, for a short highlight in the editor. */
  fired: string | null;
};

export const shortcutUi = createStore<ShortcutUi>({
  open: false, draft: null, recording: null, failed: {}, mediaBlocked: false, midiPorts: null, fired: null,
});
const patchUi = (p: Partial<ShortcutUi>) => shortcutUi.set((s) => ({ ...s, ...p }));

export const openShortcuts = (draft: Subject | null = null) => patchUi({ open: true, draft });
export const closeShortcuts = () => patchUi({ open: false, draft: null, recording: null });
export const setRecording = (id: string | null) => patchUi({ recording: id });

export function addShortcut(subject: Subject, verb: Verb, amount: number | null) {
  const id = crypto.randomUUID();
  shortcuts.set((l) => [...l, { id, keys: "", midi: null, subject, verb, amount }]);
  patchUi({ draft: null, recording: id });
  return id;
}

export const updateShortcut = (id: string, p: Partial<Shortcut>) =>
  shortcuts.set((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));

export function deleteShortcut(id: string) {
  const before = shortcuts.get();
  shortcuts.set(before.filter((x) => x.id !== id));
  if (shortcutUi.get().recording === id) setRecording(null);
  toast("Shortcut deleted", { id: "edit", duration: 6000, action: { label: "Undo", onClick: () => shortcuts.set(before) } });
}

export const usedBy = (keys: string, except: string) => shortcuts.get().find((x) => x.keys === keys && x.id !== except);

/** Opens the system dialog that leads to Accessibility settings (macOS). */
export const allowMediaKeys = () => invoke<boolean>("media_keys_trusted", { prompt: true }).then((ok) => ok && sync());

// ---------------------------------------------------------------------------------------------
// Recording: keys come from the window, media keys and MIDI from the backend
// ---------------------------------------------------------------------------------------------

export type Captured = { keys: string } | { midi: Midi };
const capturers = new Set<(c: Captured) => void>();

/** Hears media keys and MIDI controls while a shortcut is recording. */
export function onCapture(fn: (c: Captured) => void) {
  capturers.add(fn);
  return () => void capturers.delete(fn);
}
const capture = (c: Captured) => capturers.forEach((fn) => fn(c));

// ---------------------------------------------------------------------------------------------
// Starter sets
// ---------------------------------------------------------------------------------------------

type SetItem = { keys: string; subject: Subject; verb: Verb; amount: number | null };
export type StarterSet = { id: string; name: string; hint: string; mixer: boolean; items: () => SetItem[] };

const CA = "Control+Alt";

/** Input 1 as the mixer shows it (alone or as part of a stereo pair). */
function input1(): number[] {
  const m = app.get().mixer;
  if (!m) return [0];
  return unitsOf(m, [0], settings.get().pairs).find((u) => u.chs.includes(0))?.chs ?? [0];
}

export const STARTER_SETS: StarterSet[] = [
  {
    id: "volume-keys",
    name: "Volume keys",
    hint: "The keyboard's volume keys turn the Main mix up and down. Mute silences it, press again to bring it back.",
    mixer: true,
    items: () => [
      { keys: "AudioVolumeUp", subject: { kind: "master", bus: 0 }, verb: "up", amount: 2 },
      { keys: "AudioVolumeDown", subject: { kind: "master", bus: 0 }, verb: "down", amount: 2 },
      { keys: "AudioVolumeMute", subject: { kind: "master", bus: 0 }, verb: "set", amount: null },
    ],
  },
  {
    id: "monitor",
    name: "Monitor control",
    hint: "Speaker level up and down, dim to −20 dB and mute. Dim and mute go back on a second press.",
    mixer: true,
    items: () => [
      { keys: `${CA}+ArrowUp`, subject: { kind: "master", bus: 0 }, verb: "up", amount: 1 },
      { keys: `${CA}+ArrowDown`, subject: { kind: "master", bus: 0 }, verb: "down", amount: 1 },
      { keys: `${CA}+KeyD`, subject: { kind: "master", bus: 0 }, verb: "set", amount: -20 },
      { keys: `${CA}+KeyM`, subject: { kind: "master", bus: 0 }, verb: "set", amount: null },
    ],
  },
  {
    id: "mic",
    name: "Mic mute",
    hint: "Mute Input 1 in your speakers, or in the Loopback mix so a call or stream can't hear you.",
    mixer: true,
    items: () => [
      { keys: `${CA}+KeyI`, subject: { kind: "level", bus: 0, chs: input1() }, verb: "mute", amount: null },
      { keys: `${CA}+Shift+KeyI`, subject: { kind: "level", bus: 2, chs: input1() }, verb: "mute", amount: null },
    ],
  },
  {
    id: "mixes",
    name: "Switch mixes",
    hint: "Show the Main, Cue or Loopback mix and bring Open MF to the front.",
    mixer: true,
    items: () => MIXES.map((_, bus) => ({ keys: `${CA}+Digit${bus + 1}`, subject: { kind: "mix", bus }, verb: "show", amount: null })),
  },
  {
    id: "app",
    name: "Open MF",
    hint: "Bring the window to the front, undo and redo from any app.",
    mixer: false,
    items: () => [
      { keys: `${CA}+KeyO`, subject: { kind: "app" }, verb: "show", amount: null },
      { keys: `${CA}+KeyZ`, subject: { kind: "app" }, verb: "undo", amount: null },
      { keys: `${CA}+Shift+KeyZ`, subject: { kind: "app" }, verb: "redo", amount: null },
    ],
  },
];

const same = (a: SetItem, b: SetItem) =>
  a.keys === b.keys && a.verb === b.verb && a.amount === b.amount && JSON.stringify(a.subject) === JSON.stringify(b.subject);

/** Whether every shortcut of the set is already there. */
export const hasSet = (set: StarterSet) => set.items().every((i) => shortcuts.get().some((x) => same(x, i)));

export function addSet(set: StarterSet) {
  const before = shortcuts.get();
  const added: Shortcut[] = [];
  let taken = 0;
  for (const i of set.items()) {
    if (before.some((x) => same(x, i))) continue;
    if (before.some((x) => x.keys === i.keys)) {
      taken++;
      continue;
    }
    added.push({ id: crypto.randomUUID(), midi: null, ...i });
  }
  shortcuts.set([...before, ...added]);
  const n = added.length;
  const text = `Added ${n} shortcut${n === 1 ? "" : "s"}` + (taken ? `, skipped ${taken} with keys already in use` : "");
  toast(text, { id: "edit", duration: 6000, action: n ? { label: "Undo", onClick: () => shortcuts.set(before) } : undefined });
}

// ---------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------

const note = (text: string) => toast(text, { id: "shortcut" });

async function freshSystemAudio(): Promise<SystemAudio | null> {
  try {
    const s = await invoke<SystemAudio>("system_audio");
    sysAudio.set(s);
    return s;
  } catch {
    return null;
  }
}

async function runSystem(verb: Verb, amount: number | null) {
  const s = await freshSystemAudio();
  if (verb === "mute") {
    if (s?.muted == null) return note("The computer can't mute the MiniFuse");
    await setSystemMute(!s.muted);
    return note(s.muted ? "Computer sound on" : "Computer sound muted");
  }
  if (s?.volume == null) return note("The computer has no volume for the MiniFuse");
  const v = Math.max(0, Math.min(1, Math.round((s.volume + ((verb === "up" ? 1 : -1) * (amount ?? 5)) / 100) * 100) / 100));
  await setSystemVolume(v);
  note(`Computer volume ${Math.round(v * 100)}%`);
}

async function showWindow() {
  const w = getCurrentWindow();
  await w.unminimize().catch(() => {});
  await w.show().catch(() => {});
  await w.setFocus().catch(() => {});
}

let firedTimer: ReturnType<typeof setTimeout> | undefined;
function fired(id: string) {
  if (shortcutUi.get().fired !== id) patchUi({ fired: id });
  clearTimeout(firedTimer);
  firedTimer = setTimeout(() => patchUi({ fired: null }), 300);
}

// A knob sends many values a second; only the latest one waiting matters.
let sysWant: number | null = null;
let sysBusy = false;
async function followSystem(pos: number) {
  sysWant = Math.round(pos * 100) / 100;
  if (sysBusy) return;
  sysBusy = true;
  try {
    while (sysWant !== null) {
      const v = sysWant;
      sysWant = null;
      await setSystemVolume(v);
    }
  } finally {
    sysBusy = false;
  }
}

/** Moves a level to where a MIDI knob or fader is, 0..1. */
function followTo(sc: Shortcut, pos: number) {
  const s = sc.subject;
  if (s.kind === "system") return void followSystem(pos).catch(() => {});
  if (s.kind === "level" || s.kind === "master" || s.kind === "trim") follow(s, pos);
}

const run = (sc: Shortcut) => void runShortcut(sc).catch((err) => toast.error(String(err)));

async function runShortcut(sc: Shortcut) {
  fired(sc.id);
  const { subject: s, verb, amount } = sc;
  const needsMixer = s.kind === "level" || s.kind === "master" || s.kind === "trim" || s.kind === "preset" || s.kind === "mix";
  if (needsMixer && !app.get().mixer) return note("No MiniFuse mixer connected");
  switch (s.kind) {
    case "level":
    case "master":
    case "trim": {
      if (verb === "up" || verb === "down") nudge(s, (verb === "up" ? 1 : -1) * (amount ?? 1));
      else if (verb === "follow") return;
      else if (verb === "set") setLevel(s, amount);
      else if (s.kind === "level" && (verb === "mute" || verb === "solo")) flip(unitOf(s.chs), verb, s.bus);
      return;
    }
    case "switch": {
      if (!app.get().stat.device?.controls.includes(s.control)) return note(`${SWITCH_LABEL[s.control]} isn't on this device`);
      await toggleSwitch(s.control);
      const st = app.get();
      if (st.armed === s.control) note("Press again within 4 s to turn on 48 V");
      else if (st.switches[s.control] !== undefined) note(`${SWITCH_LABEL[s.control]} ${st.switches[s.control] ? "on" : "off"}`);
      return;
    }
    case "preset": {
      const b = BUILTIN_PRESETS.find((p) => p.id === s.id);
      const u = app.get().userPresets.find((p) => p.id === s.id);
      if (b) return applyPreset(b.name, b.build());
      if (u) return applyPreset(u.name, u.data);
      return note("That preset was deleted");
    }
    case "mix":
      setBus(s.bus);
      return showWindow();
    case "system":
      return verb === "follow" ? undefined : runSystem(verb, amount);
    case "app":
      if (verb === "show") return showWindow();
      return verb === "undo" ? undo() : redo();
  }
}

/** Re-registers everything with the OS. Calls are chained so they never interleave. */
let chain = Promise.resolve();
function sync() {
  chain = chain.then(syncNow, syncNow);
}

// On a Mac the volume keys aren't key events; the backend's media-key tap handles all media keys.
const viaTap = (keys: string) => OS === "mac" && isMediaKeys(keys);

async function syncNow() {
  await unregisterAll().catch(() => {});
  const failed: Record<string, string> = {};
  const recording = shortcutUi.get().recording !== null;
  const media: string[] = [];
  if (!recording) {
    const seen = new Set<string>();
    for (const sc of shortcuts.get()) {
      if (!sc.keys || seen.has(sc.keys)) continue;
      seen.add(sc.keys);
      if (viaTap(sc.keys)) {
        media.push(sc.keys);
        continue;
      }
      const id = sc.id;
      try {
        await register(sc.keys, (e) => {
          if (e.state !== "Pressed") return;
          const cur = shortcuts.get().find((x) => x.id === id);
          if (cur) run(cur);
        });
      } catch (err) {
        failed[id] = String(err);
      }
    }
  }
  let mediaBlocked = false;
  if (OS === "mac") {
    try {
      await invoke("media_keys_set", { keys: media, learn: recording });
    } catch {
      mediaBlocked = true;
    }
  }
  if (JSON.stringify(failed) !== JSON.stringify(shortcutUi.get().failed)) patchUi({ failed });
  if (mediaBlocked !== shortcutUi.get().mediaBlocked) patchUi({ mediaBlocked });
}

// ---------------------------------------------------------------------------------------------
// Backend events: media keys (macOS) and MIDI
// ---------------------------------------------------------------------------------------------

type MediaKeyEvent = { keys: string; repeat: boolean };
type MidiEvent = { kind: Midi["type"]; ch: number; num: number; value: number };

function onMediaKey({ keys, repeat }: MediaKeyEvent) {
  if (shortcutUi.get().recording !== null) return capture({ keys });
  const sc = shortcuts.get().find((x) => x.keys === keys);
  // Holding a volume key repeats it, like the system volume does. Nothing else repeats.
  if (sc && (!repeat || sc.verb === "up" || sc.verb === "down")) run(sc);
}

/** Last value per CC, so a CC button runs once per press (crossing the middle upwards). */
const ccLast = new Map<string, number>();

function onMidi(e: MidiEvent) {
  const id = `${e.ch}:${e.num}`;
  const prev = ccLast.get(id) ?? 0;
  if (e.kind === "cc") ccLast.set(id, e.value);
  const pressed = e.kind === "pc" || (e.kind === "note" && e.value > 0) || (e.kind === "cc" && prev < 64 && e.value >= 64);
  if (shortcutUi.get().recording !== null) {
    // Note-offs and button releases would otherwise be recorded right after the press.
    if (pressed || e.kind === "cc" || e.kind === "pb") capture({ midi: { type: e.kind, ch: e.ch, num: e.num } });
    return;
  }
  for (const sc of shortcuts.get()) {
    const m = sc.midi;
    if (!m || m.type !== e.kind || m.ch !== e.ch || m.num !== e.num) continue;
    if (sc.verb === "follow") {
      fired(sc.id);
      followTo(sc, e.kind === "pb" ? e.value / 16383 : e.value / 127);
    } else if (pressed) run(sc);
  }
}

let midiStarted = false;
function startMidi() {
  if (midiStarted) return;
  midiStarted = true;
  invoke<string[]>("midi_start")
    .then((midiPorts) => patchUi({ midiPorts }))
    .catch(() => patchUi({ midiPorts: [] }));
}

/** Registers global shortcuts and keeps them in sync. Returns a cleanup. */
export function startShortcuts() {
  let last = "";
  const check = () => {
    // Opening the editor retries keys the OS refused before (the other app may have quit).
    const { recording, open } = shortcutUi.get();
    if (open || recording !== null || shortcuts.get().some((x) => x.midi)) startMidi();
    const k = JSON.stringify([shortcuts.get().map((x) => x.keys), recording, open]);
    if (k === last) return;
    last = k;
    sync();
  };
  check();
  const offA = shortcuts.subscribe(check);
  const offB = shortcutUi.subscribe(check);
  // Back from System Settings: Accessibility may be allowed now.
  const onFocus = () => shortcutUi.get().mediaBlocked && sync();
  window.addEventListener("focus", onFocus);
  const unlisten = [
    listen<MediaKeyEvent>("media-key", (e) => onMediaKey(e.payload)),
    listen<MidiEvent>("midi", (e) => onMidi(e.payload)),
    listen<string[]>("midi-ports", (e) => patchUi({ midiPorts: e.payload })),
  ];
  return () => {
    offA();
    offB();
    window.removeEventListener("focus", onFocus);
    unlisten.forEach((p) => p.then((f) => f()).catch(() => {}));
    chain = chain.then(() => unregisterAll().catch(() => {}));
  };
}
