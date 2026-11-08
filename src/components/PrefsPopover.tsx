import { SlidersHorizontalIcon, SunIcon } from "lucide-react";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { app, setLed } from "@/lib/app";
import { LED_LEVELS } from "@/lib/device";
import { checkForUpdates, updater } from "@/lib/updater";
import { CLIP_OPTIONS, PEAK_OPTIONS, WARN_OPTIONS, settings, updateSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { groupLabel as group } from "@/lib/utils";


function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-[14px] font-normal whitespace-nowrap">{label}</Label>
      {children}
    </div>
  );
}

function About() {
  const { current, state } = useStore(updater, (u) => u);
  const label =
    state.kind === "checking"
      ? "Checking…"
      : state.kind === "available"
        ? `${state.version} is available`
        : state.kind === "downloading"
          ? `Downloading ${state.version}…`
          : null;
  return (
    <>
      <span className={`mt-1 ${group}`}>Open MF</span>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] text-muted-foreground">
          {current ? `Version ${current}` : "Version"}
          {label && <span className="block text-[12px]">{label}</span>}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={state.kind === "checking" || state.kind === "downloading"}
          onClick={() => checkForUpdates(true)}
        >
          Check for updates
        </Button>
      </div>
    </>
  );
}

/** Preferences: meter behavior and how mixes show. */
export function PrefsPopover() {
  const s = useStore(settings, (x) => x);
  const clipValue = s.meter.clipHoldMs === null ? "hold" : String(s.meter.clipHoldMs);
  const setMeter = (p: Partial<typeof s.meter>) => updateSettings((x) => ({ meter: { ...x.meter, ...p } }));
  return (
    <Popover>
      <Hint text="Preferences" side="bottom">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-8 text-muted-foreground" aria-label="Preferences">
            <SlidersHorizontalIcon className="size-4" />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3 p-4">
        <span className={group}>Meters</span>
        <Row label="Amber from">
          <Select value={String(s.meter.warnDb)} onValueChange={(v) => setMeter({ warnDb: +v })}>
            <SelectTrigger size="sm" className="w-36 text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WARN_OPTIONS.map((v) => (
                <SelectItem key={v} value={String(v)} className="text-[13px]">
                  {String(v).replace("-", "−")} dBFS
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Clip light stays on">
          <Select value={clipValue} onValueChange={(v) => setMeter({ clipHoldMs: v === "hold" ? null : +v })}>
            <SelectTrigger size="sm" className="w-36 text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CLIP_OPTIONS.map((o) => (
                <SelectItem key={o.label} value={o.value === null ? "hold" : String(o.value)} className="text-[13px]">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Peak line holds">
          <Select value={String(s.meter.peakHoldMs)} onValueChange={(v) => setMeter({ peakHoldMs: +v })}>
            <SelectTrigger size="sm" className="w-36 text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PEAK_OPTIONS.map((o) => (
                <SelectItem key={o.label} value={String(o.value)} className="text-[13px]">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <span className={`mt-1 ${group}`}>Mixes</span>
        <label className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[14px]">Stereo pairs as one strip</span>
            <span className="block text-[12px] text-muted-foreground">USB 1–2, 3–4, 5–6 and linked Inputs 3–4</span>
          </span>
          <Switch checked={s.pairs} onCheckedChange={(pairs) => updateSettings({ pairs })} />
        </label>
      </PopoverContent>
    </Popover>
  );
}

/** Front-panel light brightness. */
export function LedPopover() {
  const level = useStore(app, (s) => s.mixer?.ledIntensity);
  if (level === undefined) return null;
  return (
    <Popover>
      <Hint text="Front-panel brightness" side="bottom">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-8 text-muted-foreground" aria-label="Front-panel brightness">
            <SunIcon className="size-4" />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="w-auto p-3">
        <p className="mb-2 text-[13px] font-medium">Front-panel brightness</p>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(level)}
          onValueChange={(v) => v && setLed(+v)}
          aria-label="Front-panel brightness"
        >
          {LED_LEVELS.map((l, i) => (
            <ToggleGroupItem key={i} value={String(i)} className="px-2 text-[13px] data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              {l.replace(" %", "%")}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <About />
      </PopoverContent>
    </Popover>
  );
}
