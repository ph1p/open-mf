import { useState } from "react";
import { parseDb } from "@/lib/db";
import { fmtDb } from "@/lib/device";
import { cn } from "@/lib/utils";

/**
 * Level readout. Click to type a value ("-6", "0", "inf"); Enter or leaving the field
 * commits, Esc cancels.
 */
export function DbReadout({
  value,
  max,
  label,
  onCommit,
  className,
}: {
  value: number | null;
  max: number;
  label: string;
  onCommit: (db: number | null) => void;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);

  if (text === null)
    return (
      <button
        type="button"
        aria-label={`${label}: ${fmtDb(value)}. Click to type a value`}
        onClick={() => setText(value === null ? "-inf" : String(value))}
        className={cn(
          "h-5 rounded px-1 text-[12px] tabular-nums transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          value === null && "text-muted-foreground",
          className,
        )}
      >
        {fmtDb(value)}
      </button>
    );

  const commit = () => {
    const db = parseDb(text, max);
    setText(null);
    if (db !== undefined && db !== value) onCommit(db);
  };
  return (
    <input
      autoFocus
      aria-label={`${label} in dB`}
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setText(null);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn("h-5 w-16 rounded bg-background px-1 text-center text-[12px] tabular-nums ring-2 ring-ring outline-none", className)}
    />
  );
}
