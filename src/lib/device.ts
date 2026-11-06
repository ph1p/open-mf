import { invoke } from "@tauri-apps/api/core";

export type Control = "inst1" | "inst2" | "phantom48v";
export type Switches = Record<Control, boolean>;
export type Status = {
  connected: boolean;
  clockSelector: number | null;
  sampleRate: number | null;
  switches: Switches | null;
  error: string | null;
  /** False when this OS has no USB control backend yet. */
  supported: boolean;
};

export type Strip = { levelDb: number | null; pan: number; mute: boolean; solo: boolean };
export type Bus = { masterDb: number | null; source: number; strips: Strip[] };
export type Mixer = { buses: Bus[]; link34: boolean; trimDb: [number, number]; ledIntensity: number };
export type Op =
  | { op: "level"; bus: number; ch: number; levelDb: number | null; pan: number }
  | { op: "mute" | "solo"; bus: number; ch: number; on: boolean }
  | { op: "master"; bus: number; levelDb: number | null }
  | { op: "source"; bus: number; source: number }
  | { op: "link34"; on: boolean }
  | { op: "trim"; input: 3 | 4; db: number }
  | { op: "ledIntensity"; level: number };

/** Channel order matches the device: analog inputs 1-4, then computer playback 1-6. */
export const CHANNELS = [
  "Input 1", "Input 2", "Input 3", "Input 4",
  "USB 1", "USB 2", "USB 3", "USB 4", "USB 5", "USB 6",
];
export const INPUT_CHANNELS = [0, 1, 2, 3];
export const USB_CHANNELS = [4, 5, 6, 7, 8, 9];

/**
 * One mix per physical destination. `ownSource` is the source value that makes the
 * destination play this mix. Main is metered after its level, the others before.
 */
export const MIXES = [
  { name: "Outputs 1–2", tag: "Main", mixName: "Main mix", ownSource: 1, postLevel: true, about: "Your speakers or main headphones." },
  { name: "Outputs 3–4", tag: "Cue", mixName: "Cue mix", ownSource: 3, postLevel: false, about: "A second mix, e.g. for a performer's headphones." },
  { name: "Loopback", tag: "To computer", mixName: "Loopback mix", ownSource: 5, postLevel: false, about: "What your computer records from the Loopback input." },
];

/** What each destination is, in plain words. Index = bus. */
export const DESTINATIONS = [
  { name: "Outputs 1–2", hint: "Main monitor outputs" },
  { name: "Outputs 3–4", hint: "Second output pair" },
  { name: "Loopback", hint: "Recordable input on your computer" },
];

/** Source values 0-7 as the device numbers them. */
export const SOURCES = [
  "Computer 1–2 only (no mix)",
  "Mix for Outputs 1–2",
  "Computer 3–4 only (no mix)",
  "Mix for Outputs 3–4",
  "Computer 5–6 only (no mix)",
  "Mix for Loopback",
  "Same as Outputs 1–2",
  "Same as Outputs 3–4",
];

export const LED_LEVELS = ["20 %", "40 %", "60 %", "80 %", "100 %"];

export const fmtDb = (db: number | null) => {
  if (db === null) return "−∞ dB";
  const r = Math.round(db * 10) / 10 || 0; // `|| 0` turns -0 into 0
  return `${r > 0 ? "+" : ""}${r.toFixed(1)} dB`;
};
export const fmtPan = (p: number) => (Math.abs(p) < 0.01 ? "C" : `${p < 0 ? "L" : "R"} ${Math.round(Math.abs(p) * 100)}`);

/**
 * Coalesces writes per target: while one write is in flight, only the newest pending
 * op for the same target is kept. `msSinceWrite` lets polling skip right after edits.
 */
export function createSender(onError: (msg: string) => void) {
  const inflight = new Set<string>();
  const queued = new Map<string, Op>();
  let lastWrite = 0;

  const key = (op: Op) => ("ch" in op ? `${op.op}:${op.bus}:${op.ch}` : "bus" in op ? `${op.op}:${op.bus}` : op.op);

  function send(op: Op) {
    lastWrite = Date.now();
    const k = key(op);
    if (inflight.has(k)) {
      queued.set(k, op);
      return;
    }
    inflight.add(k);
    invoke("mixer_apply", { op })
      .catch((e) => onError(String(e)))
      .finally(() => {
        inflight.delete(k);
        const next = queued.get(k);
        queued.delete(k);
        if (next) send(next);
      });
  }

  return {
    send,
    msSinceWrite: () => Date.now() - lastWrite,
    /** Marks a write made outside `send` (e.g. a preset batch) so polling backs off. */
    touch: () => (lastWrite = Date.now()),
  };
}
