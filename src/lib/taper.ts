/** Fader travel to dB and back. Shared by on-screen faders and MIDI faders. */

// [position 0..1, dB]. The first point (-60) is the floor and shows as -inf.
export const TAPERS: Record<0 | 10, [number, number][]> = {
  10: [[0.05, -60], [0.25, -30], [0.5, -10], [0.75, 0], [1, 10]],
  0: [[0.05, -60], [0.33, -30], [0.66, -10], [1, 0]],
};

/** One fader step (wheel, arrow keys, shortcuts). Rounds to 0.5 dB; at or below -60 is -inf. */
export function stepDb(cur: number | null, delta: number, min: number, max: number): number | null {
  if (cur === null) return delta > 0 ? Math.min(max, -60 + delta) : null;
  const next = Math.round((cur + delta) * 2) / 2;
  if (next <= -60 && min <= -60) return null;
  return Math.max(min, Math.min(max, next));
}

/** Trim rounds to 0.5 dB and snaps to 0 close by. */
export const quantizeTrim = (v: number) => (Math.abs(v) < 0.75 ? 0 : Math.round(v * 2) / 2);

export function toT(taper: [number, number][], max: number, db: number | null): number {
  if (db === null) return taper[0][0];
  const d = Math.max(-60, Math.min(max, db));
  for (let i = 0; i < taper.length - 1; i++) {
    const [t0, d0] = taper[i];
    const [t1, d1] = taper[i + 1];
    if (d <= d1) return t0 + ((d - d0) / (d1 - d0)) * (t1 - t0);
  }
  return 1;
}

export function toDb(taper: [number, number][], max: number, t: number): number | null {
  if (t < 0.025) return null; // below the floor: -inf
  const c = Math.max(taper[0][0], Math.min(1, t));
  for (let i = 0; i < taper.length - 1; i++) {
    const [t0, d0] = taper[i];
    const [t1, d1] = taper[i + 1];
    if (c <= t1) {
      const db = Math.round((d0 + ((c - t0) / (t1 - t0)) * (d1 - d0)) * 2) / 2;
      // -60 is the floor and means -inf, same as the vendor app.
      return db <= -60 ? null : db;
    }
  }
  return max;
}
