import { useRef } from "react";
import { fmtDb } from "@/lib/device";
import { useLatest, useWheelSteps } from "@/lib/hooks";
import { TAPERS, stepDb, toDb, toT } from "@/lib/taper";
import { cn } from "@/lib/utils";

const TICKS: Record<0 | 10, number[]> = { 10: [10, 0, -10, -30, -60], 0: [0, -10, -30, -60] };

// Track is inset 6px top and bottom; positions map onto the inner span.
const at = (p: number) => ({ top: `calc(6px + ${1 - p} * (100% - 12px))` });

/**
 * Vertical level fader with an audio taper: most of the travel covers the useful
 * -30..+10 dB range. Drag is relative (clicking never jumps the level), Shift = fine.
 * Keys: arrows ±0.5 dB, PageUp/PageDown ±3 dB, End = -inf, Home = 0 dB.
 * Double-click, Alt-click or Backspace/Delete resets to the control's default.
 */
export function Fader({
  value,
  max = 10,
  label,
  onChange,
  onReset,
  onDragStart,
}: {
  value: number | null;
  max?: 0 | 10;
  label: string;
  onChange: (db: number | null) => void;
  onReset: () => void;
  onDragStart?: () => void;
}) {
  const taper = TAPERS[max];
  const t = toT(taper, max, value);
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; h: number } | null>(null);
  const latest = useLatest({ value, onChange });

  const set = (db: number | null) => {
    if (db !== latest.current.value) latest.current.onChange(db);
  };
  const step = (delta: number) => set(stepDb(latest.current.value, delta, -60, max));
  useWheelSteps(root, (dir) => step(dir * 0.5));

  return (
    <div
      ref={root}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={-60}
      aria-valuemax={max}
      aria-valuenow={value ?? -60}
      aria-valuetext={fmtDb(value)}
      className="group relative h-full w-12 shrink-0 cursor-ns-resize touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.focus();
        if (e.altKey) {
          onReset();
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, t, h: track.current!.getBoundingClientRect().height };
        onDragStart?.();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const db = toDb(taper, max, d.t + ((d.y - e.clientY) / d.h) * (e.shiftKey ? 0.25 : 1));
        // Snap to 0 dB when passing close by, so unity is easy to hit.
        set(db !== null && Math.abs(db) < 0.75 && !e.shiftKey ? 0 : db);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const steps: Record<string, number> = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5, PageUp: 3, PageDown: -3 };
        if (e.key in steps) step(steps[e.key]);
        else if (e.key === "End") set(null);
        else if (e.key === "Home") set(0);
        else if (e.key === "Backspace" || e.key === "Delete") onReset();
        else return;
        e.preventDefault();
      }}
    >
      <div ref={track} className="absolute inset-y-1.5 left-[9px] w-1.5 overflow-hidden rounded-full bg-muted ring-1 ring-border">
        <div className="absolute inset-x-0 bottom-0 bg-primary/50" style={{ height: `${value === null ? 0 : t * 100}%` }} />
      </div>
      {/* 0 dB notch */}
      <span className="pointer-events-none absolute left-[5px] h-px w-3.5 bg-foreground/40" style={at(toT(taper, max, 0))} />

      {TICKS[max].map((tk) => (
        <span
          key={tk}
          className={cn(
            "pointer-events-none absolute left-[27px] -translate-y-1/2 text-[11px] leading-none tabular-nums",
            tk === 0 ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
          style={at(toT(taper, max, tk))}
        >
          {tk > 0 ? `+${tk}` : tk === 0 ? "0" : tk === -60 ? "−∞" : `−${-tk}`}
        </span>
      ))}

      <div
        className={cn(
          "pointer-events-none absolute left-0 flex h-[18px] w-6 -translate-y-1/2 items-center justify-center rounded-[4px] bg-card shadow-md ring-1 ring-border group-focus-visible:ring-ring",
          value === null && "opacity-70",
        )}
        style={at(t)}
      >
        <span className={cn("h-0.5 w-3.5 rounded-full", value === null ? "bg-muted-foreground" : "bg-primary")} />
      </div>
    </div>
  );
}
