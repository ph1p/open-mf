import { useState } from "react";
import { XIcon } from "lucide-react";
import { CenterSlider, quantizePan } from "@/components/CenterSlider";
import { ControlMenu } from "@/components/ControlMenu";
import { DbReadout } from "@/components/DbReadout";
import { Fader } from "@/components/Fader";
import { Hint } from "@/components/Hint";
import { Meter } from "@/components/Meter";
import {
  defaultOf, flip, levelKey, movePan, moveLevel, panKey, removeUnit, rename, resetLevel, resetPan, resetStrip,
  setFocusUnit, setLevelDefault, setPanDefault, startDrag, typeLevel, unitName, type Unit,
} from "@/lib/app";
import { fmtDb, fmtPan, type Strip } from "@/lib/device";
import { settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** One channel or stereo pair in the shown mix: name, meters + fader, level, pan, mute/solo. */
export function ChannelStrip({
  unit: u,
  bus,
  strips,
  anySolo,
  focused,
}: {
  unit: Unit;
  bus: number;
  /** All 10 strips of the shown mix. */
  strips: Strip[];
  anySolo: boolean;
  focused: boolean;
}) {
  const names = useStore(settings, (s) => s.names);
  // Re-render when defaults change, so menus show the right reset value.
  useStore(settings, (s) => s.defaults);
  const name = unitName(u, names);
  const first = strips[u.chs[0]];
  const pair = u.chs.length === 2;
  const usb = u.chs[0] >= 4;
  const solo = u.chs.some((ch) => strips[ch].solo);
  const mute = u.chs.some((ch) => strips[ch].mute);
  const silenced = anySolo && !solo;
  const quiet = mute || silenced || first.levelDb === null;

  return (
    <section
      aria-label={name}
      onFocusCapture={() => setFocusUnit(u.key)}
      onPointerDownCapture={() => setFocusUnit(u.key)}
      className={cn(
        "group/strip relative flex shrink-0 flex-col items-center gap-2 rounded-md border bg-card px-2 pt-0 pb-2 transition",
        pair ? "w-[136px]" : "w-[96px]",
        focused ? "border-ring/60" : "border-border",
      )}
    >
      <span className={cn("absolute inset-x-2 top-0 h-0.5 rounded-b", usb ? "bg-violet-500" : "bg-sky-500")} aria-hidden="true" />

      {/* Equal side columns keep the name centred; the remove button lives in the right one. */}
      <div className="-mx-1 mt-2 grid h-6 w-[calc(100%+8px)] grid-cols-[14px_minmax(0,1fr)_14px] items-center">
        <span />
        <div className="flex min-w-0 justify-center">
          <StripName name={name} defaultName={u.defaultName} onRename={(v) => rename(u, v)} />
        </div>
        <Hint text="Remove from this mix">
          <button
            type="button"
            aria-label={`Remove ${name} from this mix`}
            onClick={() => removeUnit(u)}
            className={cn(
              "grid size-3.5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              focused ? "opacity-100" : "opacity-0 group-hover/strip:opacity-100",
            )}
          >
            <XIcon className="size-3" />
          </button>
        </Hint>
      </div>

      <div className={cn("flex h-(--fader-h) w-full justify-center gap-1.5 transition-opacity", quiet && "opacity-50")}>
        <div className="flex gap-0.5 py-1.5">
          {u.chs.map((ch) => (
            <Meter key={ch} select={(v) => v[ch]} label={`${name} ${pair ? (ch === u.chs[0] ? "left" : "right") : ""} signal`} />
          ))}
        </div>
        <ControlMenu
          className="h-full"
          defaultText={fmtDb(defaultOf(levelKey(bus, u.chs[0])))}
          onReset={() => resetLevel(u)}
          onSetDefault={() => setLevelDefault(u)}
          onResetStrip={() => resetStrip(u)}
        >
          <Fader
            value={first.levelDb}
            label={`${name} level`}
            onChange={(db) => moveLevel(u, db)}
            onReset={() => resetLevel(u)}
            onDragStart={startDrag}
          />
        </ControlMenu>
      </div>

      <DbReadout value={first.levelDb} max={10} label={`${name} level`} onCommit={(db) => typeLevel(u, db)} />

      {/* Fixed height: mono and stereo strips line up, pan readouts on one baseline. */}
      <div className="flex h-14 w-full flex-col justify-center gap-1">
        {u.chs.map((ch, side) => {
          const pan = strips[ch].pan;
          return (
            <div key={ch} className="flex items-center gap-1">
              {pair && <span className="w-2 text-[11px] text-muted-foreground">{side ? "R" : "L"}</span>}
              <ControlMenu
                className="min-w-0 flex-1"
                defaultText={fmtPan(defaultOf(panKey(bus, ch)) ?? 0)}
                onReset={() => resetPan(u, side)}
                onSetDefault={() => setPanDefault(u, side)}
                onResetStrip={() => resetStrip(u)}
              >
                <CenterSlider
                  value={pan}
                  min={-1}
                  max={1}
                  step={0.05}
                  quantize={quantizePan}
                  label={`${name}${pair ? (side ? " right" : " left") : ""} pan`}
                  valueText={fmtPan(pan)}
                  disabled={strips[ch].levelDb === null}
                  onChange={(v) => movePan(u, side, v)}
                  onReset={() => resetPan(u, side)}
                  onDragStart={startDrag}
                />
              </ControlMenu>
            </div>
          );
        })}
        <span className="text-center text-[12px] text-muted-foreground tabular-nums">
          {u.chs.map((ch) => fmtPan(strips[ch].pan)).join(" · ")}
        </span>
      </div>

      <div className="mt-auto grid w-full grid-cols-2 gap-1">
        <Hint text="Mute: remove from this mix (M)">
          <button
            type="button"
            aria-pressed={mute}
            aria-label={`Mute ${name}`}
            onClick={() => flip(u, "mute")}
            className={cn(
              "h-7 rounded text-[12px] font-semibold transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              mute ? "bg-red-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            M
          </button>
        </Hint>
        <Hint text="Solo: hear only soloed channels in this mix (S)">
          <button
            type="button"
            aria-pressed={solo}
            aria-label={`Solo ${name}`}
            onClick={() => flip(u, "solo")}
            className={cn(
              "h-7 rounded text-[12px] font-semibold transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              solo ? "bg-amber-400 text-black" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            S
          </button>
        </Hint>
      </div>
    </section>
  );
}

/** Strip name; double-click to rename. Empty restores the default name. */
function StripName({ name, defaultName, onRename }: { name: string; defaultName: string; onRename: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  if (text === null)
    return (
      <Hint text={`Double-click to rename${name !== defaultName ? ` (${defaultName})` : ""}`} delay={700}>
        <h3
          tabIndex={0}
          onDoubleClick={() => setText(name)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "F2") {
              e.preventDefault();
              setText(name);
            }
          }}
          className="max-w-full cursor-text truncate rounded px-0.5 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </h3>
      </Hint>
    );
  const commit = () => {
    onRename(text);
    setText(null);
  };
  return (
    <input
      autoFocus
      aria-label="Channel name"
      value={text}
      maxLength={24}
      placeholder={defaultName}
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
      className="h-5 w-full min-w-0 rounded bg-background px-1 text-center text-[13px] font-semibold ring-2 ring-ring outline-none"
    />
  );
}
