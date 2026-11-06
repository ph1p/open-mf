import { useEffect, useRef, useState, type ReactNode } from "react";
import { UnplugIcon } from "lucide-react";
import { Meter, useMeter } from "@/components/Meter";
import { Hint } from "@/components/Hint";
import { settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** One physical input: name, live level with a dBFS readout, a latching clip light, and its controls. */
export function InputTile({
  ch,
  name,
  kind,
  badge,
  children,
}: {
  ch: number;
  name: string;
  /** Connector / role, e.g. "XLR / ¼″". */
  kind: string;
  /** Small warning chip next to the name (e.g. "48 V"). */
  badge?: string;
  children?: ReactNode;
}) {
  const db = useMeter((v) => v[ch]);
  const hold = useStore(settings, (s) => s.meter.clipHoldMs);

  // Clip latches so a short over is not missed: until clicked, or for the preferred time.
  const [clipped, setClipped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (db == null || db < -0.1) return;
    setClipped(true);
    clearTimeout(timer.current);
    if (hold !== null) timer.current = setTimeout(() => setClipped(false), hold);
  }, [db, hold]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // "No signal" only after a few quiet seconds, so pauses between notes don't flash it.
  const silent = db == null || db < -60;
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!silent) {
      setIdle(false);
      return;
    }
    const t = setTimeout(() => setIdle(true), 3000);
    return () => clearTimeout(t);
  }, [silent]);

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold">{name}</span>
        <span className="text-[12px] text-muted-foreground">{kind}</span>
        {badge && <span className="rounded bg-warn/15 px-1 text-[11px] font-semibold text-warn">{badge}</span>}
        {/* Fixed slot that fades in: a text line here made the sidebar jump. */}
        <Hint
          text={
            ch < 2
              ? `No signal. Plug in, then turn up the ${name} gain knob on the MiniFuse.`
              : "No signal. Check what is plugged into this jack."
          }
        >
          <span
            role="img"
            aria-label={`${name}: no signal`}
            aria-hidden={!idle}
            tabIndex={idle ? 0 : -1}
            className={cn(
              "ml-auto grid size-4 place-items-center rounded text-warn/80 transition-opacity duration-300 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              idle ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <UnplugIcon className="size-3.5" />
          </span>
        </Hint>
        <output aria-label={`${name} level`} className={cn(" text-[12px] tabular-nums", db == null && "text-muted-foreground")}>
          {db == null || db < -60 ? "−∞" : db.toFixed(1).replace("-", "−")}&nbsp;<span className="text-muted-foreground">dB</span>
        </output>
        <Hint text={clipped ? "Clipped. Turn the gain down, then click to reset" : "Lights up when the input overloads. Hold time: Preferences"}>
          <button
            type="button"
            onClick={() => setClipped(false)}
            aria-label={clipped ? `${name} clipped, reset` : `${name} clip light`}
            className={cn(
              "rounded px-1 text-[11px] font-bold tracking-wide transition",
              clipped ? "bg-red-500 text-white" : "text-muted-foreground/70 ring-1 ring-border",
            )}
          >
            CLIP
          </button>
        </Hint>
      </div>
      <Meter select={(v) => v[ch]} vertical={false} thick label={`${name} signal`} />
      {children}
    </div>
  );
}
