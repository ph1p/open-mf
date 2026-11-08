import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  CHANNELS, MIXES, createSender, fmtDb, fmtPan,
  type Control, type Mixer, type Op, type Status, type Switches,
} from "./device";
import { diff, loadUserPresets, snapshot, storeUserPresets, type PresetData, type UserPreset } from "./presets";
import { settings, updateSettings } from "./settings";
import { TAPERS, quantizeTrim, stepDb, toDb } from "./taper";
import { createStore } from "./store";

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

export type AppState = {
  stat: Status;
  /** Front-panel switches. Device state wins, except while a write is in flight. */
  switches: Switches;
  pending: Control | null;
  /** `window.confirm()` is a no-op in the Tauri webview, so 48 V uses a two-click arm instead. */
  armed: Control | null;
  mixer: Mixer | null;
  /** Mix shown in the mixer (bus index). */
  bus: number;
  /** A preset, copy or undo batch is being written. */
  applying: boolean;
  userPresets: UserPreset[];
  /** Strip that M / S / R shortcuts act on (unit key). */
  focusUnit: string | null;
  undoLabel: string | null;
  redoLabel: string | null;
};

export const app = createStore<AppState>({
  stat: { supported: true, connected: false, device: null, clockSelector: null, sampleRate: null, switches: null, error: null },
  switches: {},
  pending: null,
  armed: null,
  mixer: null,
  bus: 0,
  applying: false,
  userPresets: loadUserPresets(),
  focusUnit: null,
  undoLabel: null,
  redoLabel: null,
});

/** Meters live in their own store: they change 15 times a second. */
export const meters = createStore<(number | null)[]>([]);

const patch = (p: Partial<AppState>) => app.set((s) => ({ ...s, ...p }));

/** Edits a copy of the mixer, so subscribers see a new object. */
function updateMixer(fn: (m: Mixer) => void) {
  const m = app.get().mixer;
  if (!m) return;
  const next = structuredClone(m);
  fn(next);
  patch({ mixer: next });
}

const fail = (e: unknown) => toast.error(String(e));
const sender = createSender(fail);

/** True while a fader, pan or trim is held. Polling pauses so the control doesn't jump. */
let dragging = false;
export const startDrag = () => (dragging = true);

// ---------------------------------------------------------------------------------------------
// Strips: one channel, or a stereo pair shown as one (USB 1–2, 3–4, 5–6, linked In 3–4)
// ---------------------------------------------------------------------------------------------

export type Unit = { key: string; chs: number[]; defaultName: string };

const pairStart = (m: Mixer, ch: number) => (ch === 2 ? m.link34 : ch === 4 || ch === 6 || ch === 8);

export function unitsOf(m: Mixer, chans: number[], pairs: boolean): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < chans.length; i++) {
    const ch = chans[i];
    if (pairs && pairStart(m, ch) && chans[i + 1] === ch + 1) {
      out.push(unitOf([ch, ch + 1]));
      i++;
    } else out.push(unitOf([ch]));
  }
  return out;
}

export const unitName = (u: Unit, names: Record<string, string>) => names[u.key] ?? u.defaultName;
const nameOf = (u: Unit) => unitName(u, settings.get().names);

const keyOf = (b: number, ch: number) => `${b}:${ch}`;

/** A channel is "in" a mix when its level is not off, or when it was kept after being pulled to off. */
export const inMix = (m: Mixer, b: number, u: Unit, kept: string[]) =>
  u.chs.some((ch) => m.buses[b].strips[ch].levelDb !== null || kept.includes(keyOf(b, ch)));

function keep(b: number, chs: number[], on: boolean) {
  const keys = chs.map((ch) => keyOf(b, ch));
  updateSettings((s) => ({
    kept: on ? [...s.kept, ...keys.filter((k) => !s.kept.includes(k))] : s.kept.filter((k) => !keys.includes(k)),
  }));
}

/** Which mix (bus index) a destination ends up playing, or null for direct USB playback. */
export function mixPlayedBy(m: Mixer, dest: number, depth = 0): number | null {
  const src = m.buses[dest].source;
  const own = MIXES.findIndex((x) => x.ownSource === src);
  if (own >= 0) return own;
  if (depth < 2 && (src === 6 || src === 7)) return mixPlayedBy(m, src - 6, depth + 1);
  return null;
}
export const heardOn = (m: Mixer, b: number) => [0, 1, 2].filter((d) => mixPlayedBy(m, d) === b);

/** Mix meters: Main is metered after its level, Cue and Loopback before. Show all after. */
export function busMeter(m: Mixer, values: (number | null)[], b: number, side: 0 | 1) {
  const v = values[10 + 2 * b + side];
  if (MIXES[b].postLevel) return v ?? null;
  const g = m.buses[b].masterDb;
  return v == null || g === null ? null : v + g;
}

// ---------------------------------------------------------------------------------------------
// Default positions
// ---------------------------------------------------------------------------------------------

/** Stereo pairs sit hard left/right by default; everything else in the center. */
export function naturalPan(m: Mixer, ch: number) {
  if (ch >= 4) return ch % 2 === 0 ? -1 : 1;
  if (m.link34 && (ch === 2 || ch === 3)) return ch === 2 ? -1 : 1;
  return 0;
}

export const levelKey = (b: number, ch: number) => `level:${b}:${ch}`;
export const panKey = (b: number, ch: number) => `pan:${b}:${ch}`;
export const masterKey = (b: number) => `master:${b}`;
export const trimKey = (i: number) => `trim:${i}`;

/** User-set default for a control, or the factory one. `null` is a valid default (−∞). */
export function defaultOf(key: string): number | null {
  const d = settings.get().defaults;
  if (key in d) return d[key];
  const [kind, , ch] = key.split(":");
  if (kind === "pan") {
    const m = app.get().mixer;
    return m ? naturalPan(m, +ch) : 0;
  }
  // Main and Cue drive speakers and headphones: a reset must never jump them to 0 dB.
  if (kind === "master" && key !== masterKey(2)) return -20;
  return 0;
}

export function setDefault(keys: string[], value: number | null, label: string) {
  updateSettings((s) => ({ defaults: { ...s.defaults, ...Object.fromEntries(keys.map((k) => [k, value])) } }));
  toast(`${label} is the new default`, { id: "edit" });
}

// ---------------------------------------------------------------------------------------------
// Undo / redo: snapshot-based. Each entry undoes only what it changed.
// ---------------------------------------------------------------------------------------------

type Snap = { data: PresetData; kept: string[] };
type Entry = { label: string; before: Snap; after: Snap };

const undoStack: Entry[] = [];
const redoStack: Entry[] = [];
const LIMIT = 100;

const snap = (): Snap | null => {
  const m = app.get().mixer;
  return m ? { data: snapshot(m), kept: [...settings.get().kept] } : null;
};
const same = (a: Snap, b: Snap) => JSON.stringify(a) === JSON.stringify(b);

function syncLabels() {
  patch({ undoLabel: undoStack.at(-1)?.label ?? null, redoLabel: redoStack.at(-1)?.label ?? null });
}

function push(label: string, before: Snap | null) {
  const after = snap();
  if (!before || !after || same(before, after)) return;
  undoStack.push({ label, before, after });
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncLabels();
  toast(label, { id: "edit", duration: 8000, action: { label: "Undo", onClick: () => void undo() } });
}

/** A continuous edit (drag, scroll, keys): one undo step once the control is still briefly. */
let gesture: { key: string; label: string; before: Snap | null } | null = null;
let gestureTimer: ReturnType<typeof setTimeout> | undefined;

function track(key: string, label: string) {
  if (gesture?.key !== key) {
    settle();
    gesture = { key, label, before: snap() };
  } else gesture.label = label;
  clearTimeout(gestureTimer);
  gestureTimer = setTimeout(settle, 700);
}

function settle() {
  clearTimeout(gestureTimer);
  if (!gesture) return;
  if (dragging) {
    gestureTimer = setTimeout(settle, 300);
    return;
  }
  const g = gesture;
  gesture = null;
  push(g.label, g.before);
}

/** A discrete edit: closes any open gesture, then records `fn` as one step. */
function record(label: string, fn: () => void) {
  settle();
  const before = snap();
  fn();
  push(label, before);
}

/** Mixer shape of a snapshot, for diffing. */
const asMixer = (d: PresetData): Mixer => ({
  buses: d.buses.map((b) => ({ masterDb: b.masterDb ?? null, source: b.source, strips: b.strips })),
  link34: d.link34 ?? false,
  trimDb: d.trimDb ?? [0, 0],
  ledIntensity: 0,
});

function applyOpLocal(m: Mixer, op: Op) {
  switch (op.op) {
    case "level": {
      const s = m.buses[op.bus].strips[op.ch];
      s.levelDb = op.levelDb;
      s.pan = op.pan;
      break;
    }
    case "mute":
    case "solo":
      m.buses[op.bus].strips[op.ch][op.op] = op.on;
      break;
    case "master":
      m.buses[op.bus].masterDb = op.levelDb;
      break;
    case "source":
      m.buses[op.bus].source = op.source;
      break;
    case "link34":
      m.link34 = op.on;
      break;
    case "trim":
      m.trimDb[op.input - 3] = op.db;
      break;
    case "ledIntensity":
      m.ledIntensity = op.level;
      break;
  }
}

/** Writes a batch. The UI updates first; on failure the device state is re-read. */
async function applyOps(ops: Op[]) {
  if (!ops.length) return true;
  patch({ applying: true });
  updateMixer((m) => ops.forEach((op) => applyOpLocal(m, op)));
  sender.touch();
  try {
    await invoke("mixer_apply_many", { ops });
    return true;
  } catch (e) {
    fail(e);
    // Part of the batch may have landed: re-read what the device has now.
    const m = await invoke<Mixer>("mixer_state").catch(() => null);
    if (m) patch({ mixer: m });
    return false;
  } finally {
    sender.touch();
    patch({ applying: false });
  }
}

/** Moves `kept` from `from` to `to`, leaving keys the entry didn't touch alone. */
function shiftKept(from: string[], to: string[]) {
  const added = to.filter((k) => !from.includes(k));
  const removed = from.filter((k) => !to.includes(k));
  updateSettings((s) => ({ kept: [...s.kept.filter((k) => !added.includes(k)), ...removed.filter((k) => !s.kept.includes(k))] }));
}

async function step(fromStack: Entry[], toStack: Entry[], dir: "undo" | "redo") {
  settle();
  const e = fromStack.pop();
  if (!e || app.get().applying) {
    if (e) fromStack.push(e);
    return;
  }
  const [from, to] = dir === "undo" ? [e.after, e.before] : [e.before, e.after];
  // Only the controls this entry changed: later edits to other controls stay.
  await applyOps(diff(asMixer(from.data), to.data));
  shiftKept(from.kept, to.kept);
  toStack.push(e);
  syncLabels();
  toast(dir === "undo" ? `Undid: ${e.label}` : `Redid: ${e.label}`, { id: "edit", duration: 3000 });
}

export const undo = () => step(undoStack, redoStack, "undo");
export const redo = () => step(redoStack, undoStack, "redo");

// ---------------------------------------------------------------------------------------------
// Mixer edits
// ---------------------------------------------------------------------------------------------

function writeLevels(b: number, chs: number[], db: number | null) {
  if (db === null) keep(b, chs, true);
  updateMixer((m) => {
    for (const ch of chs) {
      const s = m.buses[b].strips[ch];
      s.levelDb = db;
      sender.send({ op: "level", bus: b, ch, levelDb: db, pan: s.pan });
    }
  });
}
function writePan(b: number, ch: number, v: number) {
  updateMixer((m) => {
    const s = m.buses[b].strips[ch];
    s.pan = v;
    sender.send({ op: "level", bus: b, ch, levelDb: s.levelDb, pan: v });
  });
}
function writeMaster(b: number, db: number | null) {
  updateMixer((m) => {
    m.buses[b].masterDb = db;
    sender.send({ op: "master", bus: b, levelDb: db });
  });
}
function writeFlag(b: number, chs: number[], what: "mute" | "solo", on: boolean) {
  updateMixer((m) => {
    for (const ch of chs) {
      if (m.buses[b].strips[ch][what] === on) continue;
      m.buses[b].strips[ch][what] = on;
      sender.send({ op: what, bus: b, ch, on });
    }
  });
}
function writeTrim(i: number, db: number) {
  updateMixer((m) => {
    for (const j of m.link34 ? [0, 1] : [i]) {
      m.trimDb[j] = db;
      sender.send({ op: "trim", input: j === 0 ? 3 : 4, db });
    }
  });
}

const busOf = () => app.get().bus;
const strip = (b: number, ch: number) => app.get().mixer!.buses[b].strips[ch];
const sideLabel = (u: Unit, side: number) => (u.chs.length > 1 ? `${nameOf(u)} ${side ? "R" : "L"}` : nameOf(u));

export function moveLevel(u: Unit, db: number | null, b = busOf()) {
  track(`level:${b}:${u.chs}`, `${nameOf(u)} ${fmtDb(db)}`);
  writeLevels(b, u.chs, db);
}
export function movePan(u: Unit, side: number, v: number) {
  const b = busOf();
  const ch = u.chs[side];
  track(`pan:${b}:${ch}`, `${sideLabel(u, side)} pan ${fmtPan(v)}`);
  writePan(b, ch, v);
}
export function moveMaster(db: number | null, b = busOf()) {
  track(`master:${b}`, `Mix for ${MIXES[b].name} ${fmtDb(db)}`);
  writeMaster(b, db);
}
export function moveTrim(i: number, db: number) {
  track(`trim:${i}`, `Trim ${i + 3} ${fmtDb(db)}`);
  writeTrim(i, db);
}

/** Typed value from a dB readout: one undo step. */
export function typeLevel(u: Unit, db: number | null, b = busOf()) {
  record(`${nameOf(u)} ${fmtDb(db)}`, () => writeLevels(b, u.chs, db));
}
export function typeMaster(db: number | null, b = busOf()) {
  record(`Mix for ${MIXES[b].name} ${fmtDb(db)}`, () => writeMaster(b, db));
}

export function resetLevel(u: Unit) {
  const b = busOf();
  const db = defaultOf(levelKey(b, u.chs[0]));
  record(`Reset ${nameOf(u)} to ${fmtDb(db)}`, () => writeLevels(b, u.chs, db));
}
export function resetPan(u: Unit, side: number) {
  const b = busOf();
  const ch = u.chs[side];
  const v = defaultOf(panKey(b, ch)) ?? 0;
  record(`Reset ${sideLabel(u, side)} pan to ${fmtPan(v)}`, () => writePan(b, ch, v));
}
export function resetMaster() {
  const b = busOf();
  const db = defaultOf(masterKey(b));
  record(`Reset mix for ${MIXES[b].name} to ${fmtDb(db)}`, () => writeMaster(b, db));
}
export function resetTrim(i: number) {
  const db = defaultOf(trimKey(i)) ?? 0;
  record(`Reset trim ${i + 3} to ${fmtDb(db)}`, () => writeTrim(i, db));
}
export function resetStrip(u: Unit) {
  const b = busOf();
  record(`Reset ${nameOf(u)}`, () => {
    writeLevels(b, u.chs, defaultOf(levelKey(b, u.chs[0])));
    u.chs.forEach((ch) => writePan(b, ch, defaultOf(panKey(b, ch)) ?? 0));
    writeFlag(b, u.chs, "mute", false);
    writeFlag(b, u.chs, "solo", false);
  });
}

export function setLevelDefault(u: Unit) {
  const b = busOf();
  const db = strip(b, u.chs[0]).levelDb;
  setDefault(u.chs.map((ch) => levelKey(b, ch)), db, `${nameOf(u)} ${fmtDb(db)}`);
}
export function setPanDefault(u: Unit, side: number) {
  const b = busOf();
  const ch = u.chs[side];
  setDefault([panKey(b, ch)], strip(b, ch).pan, `${sideLabel(u, side)} pan ${fmtPan(strip(b, ch).pan)}`);
}
export function setMasterDefault() {
  const b = busOf();
  const db = app.get().mixer!.buses[b].masterDb;
  setDefault([masterKey(b)], db, `Mix for ${MIXES[b].name} ${fmtDb(db)}`);
}
export function setTrimDefault(i: number) {
  const db = app.get().mixer!.trimDb[i];
  setDefault([trimKey(i)], db, `Trim ${i + 3} ${fmtDb(db)}`);
}

export function flip(u: Unit, what: "mute" | "solo", b = busOf()) {
  const on = !u.chs.every((ch) => strip(b, ch)[what]);
  record(`${on ? "" : "Un"}${what === "mute" ? (on ? "Muted" : "muted") : on ? "Soloed" : "soloed"} ${nameOf(u)}`, () =>
    writeFlag(b, u.chs, what, on),
  );
}

const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export function clearSolo() {
  const b = busOf();
  record("Cleared solo", () => writeFlag(b, ALL, "solo", false));
}
export function muteAll(on: boolean) {
  const b = busOf();
  record(on ? "Muted every channel" : "Unmuted every channel", () => writeFlag(b, ALL, "mute", on));
}
/** Every channel in this mix back to its default level and pan, nothing muted or soloed. */
export function resetMix() {
  const b = busOf();
  const m = app.get().mixer;
  if (!m) return;
  const kept = settings.get().kept;
  record(`Reset mix for ${MIXES[b].name}`, () => {
    for (const ch of ALL) {
      // Channels not in the mix stay out.
      if (m.buses[b].strips[ch].levelDb === null && !kept.includes(keyOf(b, ch))) continue;
      writeLevels(b, [ch], defaultOf(levelKey(b, ch)));
      writePan(b, ch, defaultOf(panKey(b, ch)) ?? 0);
    }
    writeFlag(b, ALL, "mute", false);
    writeFlag(b, ALL, "solo", false);
  });
}

export function addUnit(u: Unit) {
  const b = busOf();
  record(`Added ${nameOf(u)}`, () => {
    keep(b, u.chs, true);
    const db = defaultOf(levelKey(b, u.chs[0]));
    writeLevels(b, u.chs, db === null ? 0 : db);
  });
}
/** Takes the channel(s) out of the mix (level off). The pan stays, so re-adding restores it. */
export function removeUnit(u: Unit) {
  const b = busOf();
  record(`Removed ${nameOf(u)}`, () => {
    writeLevels(b, u.chs, null);
    keep(b, u.chs, false);
  });
}

export function setSource(dest: number, source: number) {
  record(`Routing changed`, () =>
    updateMixer((m) => {
      m.buses[dest].source = source;
      sender.send({ op: "source", bus: dest, source });
    }),
  );
}
export function setLink34(on: boolean) {
  record(on ? "Linked Inputs 3–4" : "Unlinked Inputs 3–4", () =>
    updateMixer((m) => {
      m.link34 = on;
      sender.send({ op: "link34", on });
    }),
  );
}
export function setLed(level: number) {
  updateMixer((m) => {
    m.ledIntensity = level;
    sender.send({ op: "ledIntensity", level });
  });
}

export const setBus = (bus: number) => {
  settle();
  patch({ bus, focusUnit: null });
};
export const setFocusUnit = (key: string | null) => {
  if (app.get().focusUnit !== key) patch({ focusUnit: key });
};

// ---------------------------------------------------------------------------------------------
// Shortcut edits: act on a fixed mix, not the one shown
// ---------------------------------------------------------------------------------------------

/** The unit for channels stored in a shortcut. Its key matches `unitsOf`, so custom names apply. */
export function unitOf(chs: number[]): Unit {
  if (chs.length === 1) return { key: `${chs[0]}`, chs, defaultName: CHANNELS[chs[0]] };
  const [a, b] = chs;
  return { key: `${a}+${b}`, chs, defaultName: `${CHANNELS[a]}–${CHANNELS[b].split(" ")[1]}` };
}

/** One step like the fader's wheel: up from −∞ starts just above the floor. */

export type LevelTarget = { kind: "level"; bus: number; chs: number[] } | { kind: "master"; bus: number } | { kind: "trim"; input: number };

function levelOf(m: Mixer, t: LevelTarget): number | null {
  if (t.kind === "level") return m.buses[t.bus].strips[t.chs[0]].levelDb;
  if (t.kind === "master") return m.buses[t.bus].masterDb;
  return m.trimDb[t.input];
}

/** Grouped like a fader drag: repeated presses make one undo step. Returns the new value. */
/** Moves a level like dragging its control: one undo step per gesture. */
function moveTarget(t: LevelTarget, db: number | null) {
  if (t.kind === "trim") moveTrim(t.input, db ?? -24);
  else if (t.kind === "level") moveLevel(unitOf(t.chs), db, t.bus);
  else moveMaster(db, t.bus);
}

export function nudge(t: LevelTarget, delta: number) {
  const m = app.get().mixer;
  if (!m) return;
  moveTarget(t, t.kind === "trim" ? stepDb(levelOf(m, t), delta, -24, 24) : stepDb(levelOf(m, t), delta, -60, t.kind === "master" ? 0 : 10));
}

/** Where a "set to" shortcut came from, so pressing it again goes back (e.g. dim and undim). */
const setFrom = new Map<string, number | null>();

export function setLevel(t: LevelTarget, value: number | null) {
  const m = app.get().mixer;
  if (!m) return;
  const id = JSON.stringify(t);
  const cur = levelOf(m, t);
  const at = cur === value || (cur !== null && value !== null && Math.abs(cur - value) < 0.05);
  let db = value;
  if (at && setFrom.has(id)) {
    db = setFrom.get(id)!;
    setFrom.delete(id);
  } else if (!at) setFrom.set(id, cur);
  else return;
  if (t.kind === "trim") {
    const v = db ?? 0;
    record(`Trim ${t.input + 3} ${fmtDb(v)}`, () => writeTrim(t.input, v));
  } else if (t.kind === "level") typeLevel(unitOf(t.chs), db, t.bus);
  else typeMaster(db, t.bus);
}

/** Puts a level where a hardware knob or fader is, 0..1 along the same taper as the on-screen fader. */
export function follow(t: LevelTarget, pos: number) {
  const m = app.get().mixer;
  if (!m) return;
  const max = t.kind === "master" ? 0 : 10;
  const db = t.kind === "trim" ? quantizeTrim(pos * 48 - 24) : toDb(TAPERS[max], max, pos);
  if (levelOf(m, t) !== db) moveTarget(t, db);
}

// ---------------------------------------------------------------------------------------------
// Batches: presets and copying mixes
// ---------------------------------------------------------------------------------------------

async function applyRecorded(label: string, data: PresetData, sameText: string, after?: () => void) {
  const m = app.get().mixer;
  if (!m || app.get().applying) return;
  settle();
  const before = snap();
  const ops = diff(m, data);
  if (!ops.length) {
    after?.();
    toast(sameText, { id: "edit" });
    return;
  }
  if (await applyOps(ops)) after?.();
  push(label, before);
}

export const applyPreset = (name: string, data: PresetData) => applyRecorded(`Applied ${name}`, data, `${name} is already set`);

export function copyMix(from: number, to: number) {
  const m = app.get().mixer;
  if (!m) return;
  const data = snapshot(m);
  data.buses[to].strips = data.buses[from].strips.map((s) => ({ ...s }));
  data.buses[to].masterDb = data.buses[from].masterDb;
  void applyRecorded(`Copied mix for ${MIXES[from].name} to ${MIXES[to].name}`, data, "Both mixes already match", () =>
    updateSettings((s) => ({
      kept: [
        ...s.kept.filter((k) => !k.startsWith(`${to}:`)),
        ...s.kept.filter((k) => k.startsWith(`${from}:`)).map((k) => `${to}:${k.split(":")[1]}`),
      ],
    })),
  );
}

export const presetMatches = (m: Mixer, data: PresetData) => diff(m, data).length === 0;

function storePresets(list: UserPreset[]) {
  patch({ userPresets: list });
  storeUserPresets(list);
}

/** Saving under an existing name (any case) updates that preset. */
export function savePreset(raw: string) {
  const name = raw.trim();
  const m = app.get().mixer;
  if (!m || !name) return;
  const data = snapshot(m);
  const list = app.get().userPresets;
  const existing = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
  storePresets(
    existing
      ? list.map((p) => (p === existing ? { ...p, savedAt: Date.now(), data } : p))
      : [...list, { id: crypto.randomUUID(), name, savedAt: Date.now(), data }],
  );
  toast.success(existing ? `Updated ${name}` : `Saved ${name}`, { id: "edit" });
}

export function deletePreset(p: UserPreset) {
  const before = app.get().userPresets;
  storePresets(before.filter((x) => x.id !== p.id));
  toast(`Deleted ${p.name}`, { id: "edit", duration: 8000, action: { label: "Undo", onClick: () => storePresets(before) } });
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** An empty name restores the default one. */
export function rename(u: Unit, raw: string) {
  const name = raw.trim().slice(0, 24);
  updateSettings((s) => {
    const names = { ...s.names };
    if (!name || name === u.defaultName) delete names[u.key];
    else names[u.key] = name;
    return { names };
  });
}

// ---------------------------------------------------------------------------------------------
// Front-panel switches
// ---------------------------------------------------------------------------------------------

let armTimer: ReturnType<typeof setTimeout> | undefined;
/** Last switch write. A poll that started before it would report the old value. */
let switchWriteAt = 0;

export async function toggleSwitch(id: Control) {
  const s = app.get();
  const next = !s.switches[id];
  if (id === "phantom48v" && next && s.armed !== id) {
    patch({ armed: id });
    clearTimeout(armTimer);
    armTimer = setTimeout(() => patch({ armed: null }), 4000);
    return;
  }
  clearTimeout(armTimer);
  // Flip right away; roll back if the write fails.
  switchWriteAt = performance.now();
  patch({ armed: null, pending: id, switches: { ...s.switches, [id]: next } });
  try {
    await invoke("set_switch", { control: id, on: next });
  } catch (e) {
    patch({ switches: { ...app.get().switches, [id]: !next } });
    fail(e);
  } finally {
    switchWriteAt = performance.now();
    patch({ pending: null });
  }
}

// ---------------------------------------------------------------------------------------------
// Polling, shortcuts
// ---------------------------------------------------------------------------------------------

async function refresh() {
  const started = performance.now();
  const stat = await invoke<Status>("status");
  const s = app.get();
  // Device state wins, so front-panel presses show up here. Skip while a write is in flight,
  // and briefly after a write: the device reports the new value only after a short delay.
  const stale = s.pending !== null || started < switchWriteAt + 1500;
  patch(stat.switches && !stale ? { stat, switches: { ...s.switches, ...stat.switches } } : { stat });
}

async function refreshMixer() {
  // Device state wins, except right after a local edit (avoids fader jitter).
  if (!app.get().stat.device?.mixer) {
    if (app.get().mixer) patch({ mixer: null });
    return;
  }
  if (dragging || app.get().applying || sender.msSinceWrite() < 1500) return;
  try {
    const m = await invoke<Mixer>("mixer_state");
    if (!dragging && sender.msSinceWrite() >= 1500) {
      const cur = app.get().mixer;
      if (!cur || JSON.stringify(cur) !== JSON.stringify(m)) patch({ mixer: m });
    }
  } catch {
    patch({ mixer: null });
  }
}

/** Units of the shown mix, for shortcuts. */
function focusedUnit(): Unit | null {
  const { mixer: m, focusUnit } = app.get();
  if (!m || !focusUnit) return null;
  return unitsOf(m, ALL, settings.get().pairs).find((u) => u.key === focusUnit) ?? null;
}

function onKey(e: KeyboardEvent) {
  const t = e.target as Element | null;
  if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
  // Menus and dialogs own their keys.
  if (t?.closest('[role="menu"], [role="dialog"], [role="listbox"]')) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === "z") {
    e.preventDefault();
    void (e.shiftKey ? redo() : undo());
    return;
  }
  if (mod && k === "y") {
    e.preventDefault();
    void redo();
    return;
  }
  if (mod || e.altKey) return;
  if (k === "1" || k === "2" || k === "3") {
    setBus(+k - 1);
    e.preventDefault();
    return;
  }
  const u = focusedUnit();
  if (!u) return;
  if (k === "m") flip(u, "mute");
  else if (k === "s") flip(u, "solo");
  else if (k === "r") resetStrip(u);
  else return;
  e.preventDefault();
}

/** Starts polling and global listeners. Returns a cleanup. */
export function startApp() {
  let alive = true;
  let busy = false;
  let t: ReturnType<typeof setTimeout> | undefined;

  // Poll quickly while the window has focus so edits in the vendor app show up fast.
  async function poll() {
    clearTimeout(t);
    if (busy) return;
    busy = true;
    // Status first: it says whether this model has a mixer to read.
    await refresh().catch(() => {});
    await refreshMixer().catch(() => {});
    busy = false;
    if (alive) t = setTimeout(poll, document.hasFocus() ? 300 : 1500);
  }
  void poll();

  let meterBusy = false;
  const mt = setInterval(async () => {
    const { stat } = app.get();
    if (!stat.device?.mixer || meterBusy) return;
    meterBusy = true;
    try {
      meters.set(await invoke<(number | null)[]>("mixer_meters"));
    } catch {
      meters.set([]);
    } finally {
      meterBusy = false;
    }
  }, 66);

  const focus = () => void poll();
  const up = () => (dragging = false);
  window.addEventListener("focus", focus);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("keydown", onKey);
  return () => {
    alive = false;
    clearTimeout(t);
    clearInterval(mt);
    window.removeEventListener("focus", focus);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("keydown", onKey);
  };
}
