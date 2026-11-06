import { useEffect, useRef, useState } from "react";
import { meters } from "@/lib/app";
import { settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export type MeterSelect = (values: (number | null)[]) => number | null | undefined;

/** Live level from the meter store. Re-renders only the caller, 15 times a second. */
export const useMeter = (select: MeterSelect) => useStore(meters, (v) => select(v) ?? null);

const toPct = (v: number | null) => (v == null ? 0 : Math.max(0, Math.min(100, ((v + 60) / 60) * 100)));
// Red only right at the top; amber from the warning level set in preferences.
const HOT = -1;

/** Peak meter with a hold line. Scale is -60..0 dBFS. */
export function Meter({
  select,
  vertical = true,
  thick = false,
  label,
  className,
}: {
  select: MeterSelect;
  vertical?: boolean;
  thick?: boolean;
  label: string;
  className?: string;
}) {
  const db = useMeter(select);
  const warnDb = useStore(settings, (s) => s.meter.warnDb);
  const hold = useStore(settings, (s) => s.meter.peakHoldMs);
  const tone = db == null ? "" : db > HOT ? "bg-red-500" : db > warnDb ? "bg-amber-400" : "bg-emerald-500";

  // Hold the highest recent value for the preferred time, then let it fall back.
  const [peak, setPeak] = useState<number | null>(null);
  const peakRef = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (hold <= 0) {
      if (peakRef.current !== null) setPeak((peakRef.current = null));
      return;
    }
    if (db != null && (peakRef.current == null || db >= peakRef.current)) {
      setPeak((peakRef.current = db));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setPeak((peakRef.current = null)), hold);
    }
  }, [db, hold]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pct = toPct(db);
  const peakPct = toPct(peak);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={db ?? -60}
      className={cn(
        "relative flex overflow-hidden rounded-full bg-muted ring-1 ring-border",
        vertical ? "w-1.5 flex-col justify-end" : thick ? "h-2" : "h-1.5",
        className,
      )}
    >
      <div className={cn("rounded-full transition-all duration-75", tone)} style={vertical ? { height: `${pct}%` } : { width: `${pct}%` }} />
      {peakPct > 0 && (
        <div
          className={cn("absolute transition-all duration-300", peak! > HOT ? "bg-red-500" : "bg-foreground/50", vertical ? "inset-x-0 h-0.5" : "inset-y-0 w-0.5")}
          style={vertical ? { bottom: `calc(${peakPct}% - 2px)` } : { left: `calc(${peakPct}% - 2px)` }}
        />
      )}
    </div>
  );
}
