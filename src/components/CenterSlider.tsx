import { useRef } from "react";
import { useLatest, useWheelSteps } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * Horizontal control that fills from its center: pan (-1..1) and trim (±24 dB).
 * Relative drag (Shift = fine), arrows and wheel step, Home/End go to the ends.
 * Double-click, Alt-click or Backspace/Delete resets to the control's default.
 */
export function CenterSlider({
  value,
  min,
  max,
  step,
  quantize,
  label,
  valueText,
  disabled = false,
  onChange,
  onReset,
  onDragStart,
  className,
}: {
  value: number;
  min: number;
  max: number;
  /** Arrow / wheel step. */
  step: number;
  /** Rounds and snaps a raw value. */
  quantize: (v: number) => number;
  label: string;
  valueText: string;
  disabled?: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
  onDragStart?: () => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; v: number; w: number } | null>(null);
  const latest = useLatest({ value, onChange });
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const set = (v: number) => {
    const next = quantize(clamp(v));
    if (next !== latest.current.value) latest.current.onChange(next);
  };
  useWheelSteps(root, (dir) => set(latest.current.value + dir * step), true);

  const span = max - min;
  const p = ((value - min) / span) * 100; // 0..100
  const mid = ((0 - min) / span) * 100;

  return (
    <div
      ref={root}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled}
      className={cn(
        "relative h-4 w-full cursor-ew-resize touch-none rounded outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "opacity-40",
        className,
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.focus();
        if (e.altKey) {
          onReset();
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, w: e.currentTarget.getBoundingClientRect().width };
        onDragStart?.();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) set(d.v + ((e.clientX - d.x) / d.w) * span * (e.shiftKey ? 0.25 : 1));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const steps: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
        if (e.key in steps) set(value + steps[e.key]);
        else if (e.key === "Home") set(min);
        else if (e.key === "End") set(max);
        else if (e.key === "Backspace" || e.key === "Delete") onReset();
        else return;
        e.preventDefault();
      }}
    >
      <div className="absolute inset-x-1 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted ring-1 ring-border" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/60"
        style={{
          left: `calc(4px + ${Math.min(mid, p)} * (100% - 8px) / 100)`,
          width: `calc(${Math.abs(p - mid)} * (100% - 8px) / 100)`,
        }}
      />
      {/* center notch */}
      <div className="absolute top-0.5 bottom-0.5 w-px bg-muted-foreground/50" style={{ left: `calc(4px + ${mid} * (100% - 8px) / 100)` }} />
      <div
        className="pointer-events-none absolute top-1/2 size-3 -translate-1/2 rounded-full bg-card shadow ring-1 ring-border"
        style={{ left: `calc(4px + ${p} * (100% - 8px) / 100)` }}
      />
    </div>
  );
}

/** Pan snaps to center close by and rounds to 1 %. */
export const quantizePan = (v: number) => (Math.abs(v) < 0.04 ? 0 : Math.round(v * 100) / 100);
export { quantizeTrim } from "@/lib/taper";
