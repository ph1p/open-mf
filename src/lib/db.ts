/** Parses a typed level: "-6", "0", "+3 dB", "inf", "-∞", "off". `undefined` = not a level. */
export function parseDb(text: string, max: number): number | null | undefined {
  const t = text.trim().toLowerCase().replace(/\s*db$/, "").replace(/−/g, "-").replace(",", ".").trim();
  if (["inf", "-inf", "∞", "-∞", "off"].includes(t)) return null;
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  const c = Math.min(max, n);
  // -60 is the floor and means -inf, same as the faders.
  if (c <= -60) return null;
  return Math.round(c * 2) / 2;
}
