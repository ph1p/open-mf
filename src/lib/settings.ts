import { createStore } from "./store";

export type MeterPrefs = {
  /** Meters turn amber above this level (dBFS). */
  warnDb: number;
  /** How long a clip light stays on. `null` = until clicked. */
  clipHoldMs: number | null;
  /** How long the peak line holds. 0 = no peak line. */
  peakHoldMs: number;
};

export type Settings = {
  /** Channels shown in a mix although their level is off, as `${bus}:${ch}`. */
  kept: string[];
  /** Show stereo pairs (USB 1–2, 3–4, 5–6, linked Inputs 3–4) as one strip. */
  pairs: boolean;
  /** Show every channel in every mix, including ones that are off. */
  showAll: boolean;
  meter: MeterPrefs;
  /** Custom names, keyed by strip key ("0" for Input 1, "4+5" for the USB 1–2 pair). */
  names: Record<string, string>;
  /** Custom reset values, keyed by control ("level:0:4", "pan:0:4", "master:0", "trim:0"). */
  defaults: Record<string, number | null>;
};

const KEY = "faderline.settings.v1";

/** Meter defaults follow the vendor app (amber from -6 dBFS, clip holds until reset). */
const initial = (): Settings => ({
  kept: [],
  pairs: true,
  showAll: false,
  meter: { warnDb: -6, clipHoldMs: null, peakHoldMs: 1000 },
  names: {},
  defaults: {},
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function load(): Settings {
  const d = initial();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const names = isRecord(raw.names)
      ? Object.fromEntries(Object.entries(raw.names).filter(([, v]) => typeof v === "string"))
      : d.names;
    const defaults = isRecord(raw.defaults)
      ? Object.fromEntries(Object.entries(raw.defaults).filter(([, v]) => v === null || typeof v === "number"))
      : d.defaults;
    return {
      kept: Array.isArray(raw.kept) ? raw.kept.filter((k: unknown) => typeof k === "string") : d.kept,
      pairs: typeof raw.pairs === "boolean" ? raw.pairs : d.pairs,
      showAll: typeof raw.showAll === "boolean" ? raw.showAll : d.showAll,
      meter: { ...d.meter, ...(isRecord(raw.meter) ? raw.meter : {}) },
      names: names as Record<string, string>,
      defaults: defaults as Record<string, number | null>,
    };
  } catch {
    return d;
  }
}

export const settings = createStore<Settings>(load());

settings.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.get()));
  } catch {
    // Storage unavailable: settings live for this session only.
  }
});

export const updateSettings = (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) =>
  settings.set((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));

export const WARN_OPTIONS = [-18, -12, -9, -6, -3];
export const CLIP_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Until clicked" },
  { value: 1000, label: "1 s" },
  { value: 3000, label: "3 s" },
  { value: 10000, label: "10 s" },
];
export const PEAK_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 500, label: "0.5 s" },
  { value: 1000, label: "1 s" },
  { value: 2000, label: "2 s" },
  { value: 5000, label: "5 s" },
];
