import { CircleHelpIcon } from "lucide-react";
import { CenterSlider, quantizeTrim } from "@/components/CenterSlider";
import { ControlMenu } from "@/components/ControlMenu";
import { Hint } from "@/components/Hint";
import { InputTile } from "@/components/InputTile";
import { Meter } from "@/components/Meter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SystemAudio } from "@/components/SystemAudio";
import {
  app, busMeter, defaultOf, mixPlayedBy, moveTrim, resetTrim, setLink34, setSource, setTrimDefault, startDrag,
  toggleSwitch, trimKey,
} from "@/lib/app";
import { CHANNELS, DESTINATIONS, SOURCES, fmtDb, type Control, type Mixer } from "@/lib/device";
import { settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Heading({ children, hint }: { children: string; hint: string }) {
  return (
    <h2 className="mb-2 flex items-center gap-1 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
      <Hint text={hint} side="bottom">
        <button type="button" aria-label={`About ${children}`} className="rounded text-muted-foreground/70 hover:text-foreground">
          <CircleHelpIcon className="size-3.5" />
        </button>
      </Hint>
    </h2>
  );
}

/** A labelled on/off row. */
function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  warn,
  armed,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  warn?: boolean;
  armed?: boolean;
  onChange: () => void;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-md py-2", armed && "bg-warn/10 px-2 ring-1 ring-warn/50")}>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[14px] font-medium", warn && checked && "text-warn")}>{label}</span>
        <span className={cn("block text-[12px]", armed ? "font-medium text-warn" : "text-muted-foreground")}>
          {armed ? `Click again to turn on ${label}` : hint}
        </span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

/** Inputs (front jacks) and outputs (what each destination plays). */
export function Sidebar() {
  const mixer = useStore(app, (s) => s.mixer);
  const switches = useStore(app, (s) => s.switches);
  const pending = useStore(app, (s) => s.pending);
  const armed = useStore(app, (s) => s.armed);
  useStore(settings, (s) => s.defaults);

  return (
    <div className="flex flex-col gap-6 p-4">
      <section>
        <Heading hint="The jacks on the front. Set gain with the knobs on the device.">Inputs</Heading>
        <div className="flex flex-col divide-y divide-border">
          {([0, 1] as const).map((i) => {
            const id: Control = i === 0 ? "inst1" : "inst2";
            return (
              <InputTile key={i} ch={i} name={CHANNELS[i]} kind="XLR / ¼″" badge={switches.phantom48v ? "48 V" : undefined}>
                <SwitchRow
                  label="Guitar / bass (Hi-Z)"
                  hint={switches[id] ? "On: for a guitar or bass plugged straight in" : "Off: for mics, keyboards and line-level gear"}
                  checked={switches[id]}
                  disabled={pending !== null}
                  onChange={() => void toggleSwitch(id)}
                />
              </InputTile>
            );
          })}
        </div>
        <SwitchRow
          label="48 V phantom power"
          hint="For condenser mics on inputs 1 and 2"
          warn
          checked={switches.phantom48v}
          armed={armed === "phantom48v"}
          disabled={pending !== null}
          onChange={() => void toggleSwitch("phantom48v")}
        />

        {mixer && (
          <>
            <div className="mt-2 flex flex-col divide-y divide-border border-t pt-3">
              {([0, 1] as const).map((i) => (
                <InputTile key={i} ch={i + 2} name={CHANNELS[i + 2]} kind={mixer.link34 ? (i ? "Stereo R" : "Stereo L") : "¼″ line"}>
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="w-8 text-muted-foreground">Trim</span>
                    <ControlMenu
                      className="min-w-0 flex-1"
                      defaultText={fmtDb(defaultOf(trimKey(i)))}
                      onReset={() => resetTrim(i)}
                      onSetDefault={() => setTrimDefault(i)}
                    >
                      <CenterSlider
                        value={mixer.trimDb[i]}
                        min={-24}
                        max={24}
                        step={0.5}
                        quantize={quantizeTrim}
                        label={`Trim ${i + 3}`}
                        valueText={fmtDb(mixer.trimDb[i])}
                        onChange={(db) => moveTrim(i, db)}
                        onReset={() => resetTrim(i)}
                        onDragStart={startDrag}
                      />
                    </ControlMenu>
                    <output className="w-14 text-right text-[12px] tabular-nums">{fmtDb(mixer.trimDb[i])}</output>
                  </div>
                </InputTile>
              ))}
            </div>
            <SwitchRow
              label="Link as stereo pair"
              hint="Inputs 3 and 4 share one trim"
              checked={mixer.link34}
              onChange={() => setLink34(!mixer.link34)}
            />
          </>
        )}
      </section>

      {mixer && <Outputs mixer={mixer} />}
      <SystemAudio />
    </div>
  );
}

function Outputs({ mixer: m }: { mixer: Mixer }) {
  return (
    <section>
      <Heading hint="What each output plays. Pick a mix in the mixer to set its faders.">Outputs</Heading>
      <div className="flex flex-col divide-y divide-border">
        {DESTINATIONS.map((d, i) => {
          const played = mixPlayedBy(m, i);
          return (
            <div key={i} className="flex flex-col gap-1.5 py-2.5 first:pt-0">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">{d.name}</span>
                  <span className="block text-[12px] text-muted-foreground">{d.hint}</span>
                </span>
                {played !== null && (
                  <span className="flex h-6 gap-0.5" aria-hidden="true">
                    <Meter select={(v) => busMeter(m, v, played, 0)} label={`${d.name} left`} />
                    <Meter select={(v) => busMeter(m, v, played, 1)} label={`${d.name} right`} />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[13px] text-muted-foreground">Plays</span>
                <Select value={String(m.buses[i].source)} onValueChange={(v) => setSource(i, +v)}>
                  <SelectTrigger size="sm" className="min-w-0 flex-1 text-[13px]" aria-label={`${d.name} plays`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((name, s) =>
                      s !== 6 + i || m.buses[i].source === s ? (
                        <SelectItem key={s} value={String(s)} className="text-[13px]">
                          {name}
                        </SelectItem>
                      ) : null,
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
