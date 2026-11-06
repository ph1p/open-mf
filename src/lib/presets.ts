import type { Mixer, Op, Strip } from "./device";

/** Everything a preset can set. `masterDb` undefined = leave the mix level alone. */
export type PresetBus = { masterDb?: number | null; source: number; strips: Strip[] };
export type PresetData = { buses: PresetBus[]; link34?: boolean; trimDb?: [number, number] };
export type UserPreset = { id: string; name: string; savedAt: number; data: PresetData };
export type BuiltinPreset = { id: string; name: string; desc: string; build: () => PresetData };

/** dB values equal within read-back rounding (device words are 1/256 dB). */
const near = (a: number | null | undefined, b: number | null | undefined, eps = 0.05) =>
  a === b || (a != null && b != null && Math.abs(a - b) <= eps);

const off: Strip = { levelDb: null, pan: 0, mute: false, solo: false };
const at = (pan: number): Strip => ({ levelDb: 0, pan, mute: false, solo: false });

/** Channel order: In 1-4, USB 1-6. Mono inputs 1-2 sit in the center, stereo pairs are panned hard left/right. */
const computerOnly = (): Strip[] => [off, off, off, off, at(-1), at(1), off, off, off, off];
const inputsOnly = (): Strip[] => [at(0), at(0), at(-1), at(1), off, off, off, off, off, off];
const inputsAndComputer = (): Strip[] => [at(0), at(0), at(-1), at(1), at(-1), at(1), off, off, off, off];
const everything = (): Strip[] => [at(0), at(0), at(-1), at(1), at(-1), at(1), at(-1), at(1), at(-1), at(1)];

/** Output sources as the device numbers them (see SOURCES in device.ts). */
const MAIN_MIX = 1, USB34 = 2, CUE_MIX = 3, LOOP_MIX = 5, MIRROR_MAIN = 6;

/**
 * Each mix plays on its own output unless `cueSource` routes Outputs 3–4 elsewhere.
 * Built-ins never touch mix levels, so applying one cannot make the speakers jump.
 */
const mixes = (main: Strip[], cue: Strip[], loop: Strip[], cueSource = CUE_MIX): PresetData => ({
  buses: [
    { source: MAIN_MIX, strips: main },
    { source: cueSource, strips: cue },
    { source: LOOP_MIX, strips: loop },
  ],
});

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: "computer",
    name: "Computer only",
    desc: "All outputs play computer audio (USB 1–2). Inputs are silent.",
    build: () => mixes(computerOnly(), computerOnly(), computerOnly()),
  },
  {
    id: "monitor",
    name: "Monitor while recording",
    desc: "Hear your inputs without delay, plus the computer. Loopback carries only the computer.",
    build: () => mixes(inputsAndComputer(), inputsAndComputer(), computerOnly()),
  },
  {
    id: "speakers",
    name: "Mics with speakers",
    desc: "Speakers (Outputs 1–2) play only the computer, so open mics cannot feed back. Headphones on 3–4 hear everything.",
    build: () => mixes(computerOnly(), inputsAndComputer(), computerOnly()),
  },
  {
    id: "stream",
    name: "Streaming",
    desc: "Loopback sends inputs + computer to the computer, ready for OBS. For calls use “Calls & podcasts”.",
    build: () => mixes(inputsAndComputer(), inputsAndComputer(), inputsAndComputer()),
  },
  {
    id: "calls",
    name: "Calls & podcasts",
    desc: "Loopback sends only your inputs, so people in the call do not hear themselves back. You hear everything.",
    build: () => mixes(inputsAndComputer(), inputsAndComputer(), inputsOnly()),
  },
  {
    id: "daw-cue",
    name: "DAW headphone mix",
    desc: "Outputs 3–4 play USB 3–4, so your DAW sends its own cue mix there. Main monitors inputs + computer.",
    build: () => mixes(inputsAndComputer(), inputsAndComputer(), computerOnly(), USB34),
  },
  {
    id: "mirror",
    name: "Same on all outputs",
    desc: "Outputs 3–4 copy Outputs 1–2, e.g. for a second pair of speakers or headphones.",
    build: () => mixes(inputsAndComputer(), inputsAndComputer(), computerOnly(), MIRROR_MAIN),
  },
  {
    id: "reset",
    name: "Everything at 0 dB",
    desc: "Every channel on at 0 dB in every mix, pairs panned left/right. Nothing muted or soloed.",
    build: () => mixes(everything(), everything(), everything()),
  },
];

export function snapshot(m: Mixer): PresetData {
  // JSON round-trip: plain deep copy of the reactive state.
  return JSON.parse(
    JSON.stringify({
      buses: m.buses.map((b) => ({ masterDb: b.masterDb, source: b.source, strips: b.strips })),
      link34: m.link34,
      trimDb: m.trimDb,
    }),
  );
}

/**
 * Ops that turn `cur` into `target`, skipping values that already match. Mutes go first and
 * unmutes last, so nothing gets briefly louder while the preset is applied.
 */
export function diff(cur: Mixer, target: PresetData): Op[] {
  const muteOn: Op[] = [];
  const rest: Op[] = [];
  const muteOff: Op[] = [];
  target.buses.forEach((t, bus) => {
    const c = cur.buses[bus];
    if (!c) return;
    t.strips.forEach((s, ch) => {
      const cs = c.strips[ch];
      if (s.mute !== cs.mute) (s.mute ? muteOn : muteOff).push({ op: "mute", bus, ch, on: s.mute });
      if (!near(s.levelDb, cs.levelDb) || (s.levelDb !== null && Math.abs(s.pan - cs.pan) > 0.01))
        rest.push({ op: "level", bus, ch, levelDb: s.levelDb, pan: s.pan });
      if (s.solo !== cs.solo) rest.push({ op: "solo", bus, ch, on: s.solo });
    });
    if (t.masterDb !== undefined && !near(t.masterDb, c.masterDb)) rest.push({ op: "master", bus, levelDb: t.masterDb });
    if (t.source !== c.source) muteOff.push({ op: "source", bus, source: t.source });
  });
  if (target.link34 !== undefined && target.link34 !== cur.link34) rest.push({ op: "link34", on: target.link34 });
  target.trimDb?.forEach((db, i) => {
    if (!near(db, cur.trimDb[i])) rest.push({ op: "trim", input: i === 0 ? 3 : 4, db });
  });
  return [...muteOn, ...rest, ...muteOff];
}

/** Writes `target` into the local state so the UI matches before the device re-read. */
export function applyLocal(m: Mixer, target: PresetData) {
  target.buses.forEach((t, bus) => {
    const c = m.buses[bus];
    c.source = t.source;
    if (t.masterDb !== undefined) c.masterDb = t.masterDb;
    t.strips.forEach((s, ch) => Object.assign(c.strips[ch], s));
  });
  if (target.link34 !== undefined) m.link34 = target.link34;
  if (target.trimDb) m.trimDb = [...target.trimDb];
}

const KEY = "faderline.presets.v1";

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function storeUserPresets(list: UserPreset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: presets live for this session only.
  }
}
