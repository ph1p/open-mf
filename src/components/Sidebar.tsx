import { useState } from "react";
import { Tabs } from "radix-ui";
import { CenterSlider, quantizeTrim } from "@/components/CenterSlider";
import { ControlMenu } from "@/components/ControlMenu";
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

/** One line under the sidebar tabs saying what the panel controls. */
export function Intro({ children }: { children: string }) {
  return <p className="mb-3 text-[13px] text-muted-foreground">{children}</p>;
}

/** Small label for a group of rows inside a panel. */
function Sub({ children }: { children: string }) {
  return <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>;
}

const PANELS = [
  { id: "inputs", label: "Inputs" },
  { id: "outputs", label: "Outputs" },
  { id: "computer", label: "Computer" },
] as const;
type Panel = (typeof PANELS)[number]["id"];
const PANEL_KEY = "openmf.sidebarPanel";

function savedPanel(): Panel {
  try {
    const v = localStorage.getItem(PANEL_KEY);
    return PANELS.some((p) => p.id === v) ? (v as Panel) : "inputs";
  } catch {
    return "inputs";
  }
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

/** Front jacks: Hi-Z and 48 V for the combo inputs, trim and stereo link for 3–4 (MiniFuse 4). */
export function Inputs() {
  const mixer = useStore(app, (s) => s.mixer);
  const device = useStore(app, (s) => s.stat.device);
  const switches = useStore(app, (s) => s.switches);
  const pending = useStore(app, (s) => s.pending);
  const armed = useStore(app, (s) => s.armed);
  useStore(settings, (s) => s.defaults);
  if (!device) return null;

  const has = (c: Control) => device.controls.includes(c);
  const combo = device.inputs === 1 ? [0] : [0, 1];
  const comboLabel = combo.length === 1 ? "Input 1" : "Inputs 1–2";
  const on = (c: Control) => switches[c] === true;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <Intro>The jacks on the MiniFuse. Set gain with the knobs on the device.</Intro>
        <Sub>{`${comboLabel} · mic and instrument`}</Sub>
        <div className="flex flex-col divide-y divide-border">
          {combo.map((i) => {
            const id: Control = i === 0 ? "inst1" : "inst2";
            return (
              <InputTile
                key={i}
                ch={i}
                name={CHANNELS[i]}
                kind="XLR / ¼″"
                metered={device.mixer}
                badge={on("phantom48v") ? "48 V" : undefined}
              >
                {has(id) && (
                  <SwitchRow
                    label="Guitar / bass (Hi-Z)"
                    hint={on(id) ? "On: for a guitar or bass plugged straight in" : "Off: for mics, keyboards and line-level gear"}
                    checked={on(id)}
                    disabled={pending !== null}
                    onChange={() => void toggleSwitch(id)}
                  />
                )}
              </InputTile>
            );
          })}
        </div>
        {has("phantom48v") && (
          <SwitchRow
            label="48 V phantom power"
            hint={combo.length === 1 ? "For a condenser mic on input 1" : "For condenser mics on inputs 1 and 2"}
            warn
            checked={on("phantom48v")}
            armed={armed === "phantom48v"}
            disabled={pending !== null}
            onChange={() => void toggleSwitch("phantom48v")}
          />
        )}
        {has("monitor") && (
          <SwitchRow
            label="Mono direct monitoring"
            hint="Hear the inputs in mono on the outputs"
            checked={on("monitor")}
            disabled={pending !== null}
            onChange={() => void toggleSwitch("monitor")}
          />
        )}
      </section>

      {mixer && (
        <section>
          <Sub>Inputs 3–4 · line</Sub>
          <div className="flex flex-col divide-y divide-border">
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
        </section>
      )}
    </div>
  );
}

/** Tabs keep the sidebar to one short panel at a time; the choice is remembered. */
export function Sidebar() {
  const mixer = useStore(app, (s) => s.mixer);
  const [panel, setPanel] = useState<Panel>(savedPanel);
  const pick = (v: string) => {
    setPanel(v as Panel);
    try {
      localStorage.setItem(PANEL_KEY, v);
    } catch {
      // Private mode: the choice is just not remembered.
    }
  };

  return (
    <Tabs.Root value={panel} onValueChange={pick} className="flex flex-col">
      <Tabs.List
        aria-label="Sidebar"
        className="sticky top-0 z-10 m-3 mb-0 grid grid-cols-3 gap-1 rounded-lg border bg-muted/60 p-1 backdrop-blur"
      >
        {PANELS.map((p) => (
          <Tabs.Trigger
            key={p.id}
            value={p.id}
            className="rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            {p.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="inputs" className="p-4 outline-none">
        <Inputs />
      </Tabs.Content>
      <Tabs.Content value="outputs" className="p-4 outline-none">
        {mixer && <Outputs mixer={mixer} />}
      </Tabs.Content>
      <Tabs.Content value="computer" className="p-4 outline-none">
        <SystemAudio />
      </Tabs.Content>
    </Tabs.Root>
  );
}

function Outputs({ mixer: m }: { mixer: Mixer }) {
  return (
    <section>
      <Intro>What each output plays. Pick a mix in the mixer to set its faders.</Intro>
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
