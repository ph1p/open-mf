import { useEffect, useState } from "react";
import { ChannelStrip } from "@/components/ChannelStrip";
import { MasterStrip } from "@/components/MasterStrip";
import { PlusIcon } from "lucide-react";
import { Hint } from "@/components/Hint";
import { AddMenu, MixerToolbar } from "@/components/MixerToolbar";
import { Sidebar } from "@/components/Sidebar";
import { SidebarToggle, TitleBar } from "@/components/TitleBar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { app, inMix, startApp, unitsOf, type Unit } from "@/lib/app";
import { INPUT_CHANNELS, USB_CHANNELS, type Mixer } from "@/lib/device";
import { useMediaQuery } from "@/lib/hooks";
import { OS } from "@/lib/platform";
import { settings } from "@/lib/settings";
import { useStore } from "@/lib/store";

function MixerView({ mixer }: { mixer: Mixer }) {
  const bus = useStore(app, (s) => s.bus);
  const focusUnit = useStore(app, (s) => s.focusUnit);
  const pairs = useStore(settings, (s) => s.pairs);
  const showAll = useStore(settings, (s) => s.showAll);
  const kept = useStore(settings, (s) => s.kept);

  const strips = mixer.buses[bus].strips;
  const anySolo = strips.some((s) => s.solo);
  const inputs = unitsOf(mixer, INPUT_CHANNELS, pairs);
  const usb = unitsOf(mixer, USB_CHANNELS, pairs);
  const isIn = (u: Unit) => inMix(mixer, bus, u, kept);
  const shownIn = showAll ? inputs : inputs.filter(isIn);
  const shownUsb = showAll ? usb : usb.filter(isIn);
  const missing = [...inputs, ...usb].filter((u) => !isIn(u));

  const strip = (u: Unit) => (
    <ChannelStrip key={u.key} unit={u} bus={bus} strips={strips} anySolo={anySolo} focused={focusUnit === u.key} />
  );

  return (
    // One fader height for every strip and the master, so 0 dB lines up across the mixer.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col [--fader-h:clamp(200px,calc(100dvh-360px),420px)]">
      <MixerToolbar mixer={mixer} bus={bus} missing={missing} />
      <div className="flex min-h-0 flex-1">
        {/* Native overflow: Radix ScrollArea wraps content in display:table, which breaks the height stretch. */}
        <div className="min-w-0 flex-1 overflow-auto">
          <div className="flex w-max min-w-full items-start gap-2 p-3">
            {shownIn.length > 0 && (
              <StripGroup title="Inputs" dot="bg-sky-500" hint="Mics, instruments and line gear plugged into the front and back of the MiniFuse.">
                {shownIn.map(strip)}
              </StripGroup>
            )}
            {shownIn.length > 0 && shownUsb.length > 0 && <div className="mx-1 w-px shrink-0 self-stretch bg-border" aria-hidden="true" />}
            {shownUsb.length > 0 && (
              <StripGroup
                title="From computer"
                dot="bg-violet-500"
                hint="Sound your computer sends to the MiniFuse. System audio and most apps play on USB 1–2; a DAW can use 3–6."
              >
                {shownUsb.map(strip)}
              </StripGroup>
            )}
            {!showAll && missing.length > 0 && (
              <div className="flex shrink-0 flex-col gap-1.5">
                {/* Same height as a group title, so the tile lines up with the strips. */}
                <span className="invisible text-[12px] font-semibold" aria-hidden="true">.</span>
                <AddMenu missing={missing} align="start">
                  <button
                    type="button"
                    className="flex h-(--fader-h) w-[84px] shrink-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-[13px] text-muted-foreground transition hover:border-ring/60 hover:bg-card/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <PlusIcon className="size-5" />
                    Add channel
                  </button>
                </AddMenu>
              </div>
            )}
            {shownIn.length + shownUsb.length === 0 && missing.length === 0 && (
              <p className="m-auto max-w-56 text-center text-[14px] text-muted-foreground">Nothing plays in this mix.</p>
            )}
          </div>
        </div>
        <div className="shrink-0 overflow-y-auto border-l bg-card/50 p-3">
          <MasterStrip mixer={mixer} bus={bus} />
        </div>
      </div>
    </div>
  );
}

function StripGroup({ title, dot, hint, children }: { title: string; dot: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <Hint text={hint} side="bottom" delay={500}>
        <span tabIndex={0} className="flex w-fit items-center gap-1.5 rounded px-0.5 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
          {title}
        </span>
      </Hint>
      <div className="flex items-start gap-2">{children}</div>
    </div>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="m-auto max-w-md px-6 text-center">
      <p className="text-[16px] font-medium">{title}</p>
      <p className="mt-2 text-[14px] text-muted-foreground">{children}</p>
    </div>
  );
}

export default function App() {
  useEffect(() => startApp(), []);
  const stat = useStore(app, (s) => s.stat);
  const mixer = useStore(app, (s) => s.mixer);
  const wide = useMediaQuery("(min-width: 960px)");
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (wide) setSheetOpen(false);
  }, [wide]);

  const ready = stat.supported && stat.connected && mixer;
  const osName = OS === "windows" ? "Windows" : "Linux";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground select-none">
      <TitleBar sidebarToggle={ready && !wide ? <SidebarToggle onClick={() => setSheetOpen(true)} /> : undefined} />
      {stat.error && (
        <p role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-[13px] text-destructive">
          {stat.error}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        {!stat.supported ? (
          <Empty title={`Device control isn't available on ${osName} yet`}>
            Open MF talks to the MiniFuse over USB. On {OS === "windows" ? "Windows the Arturia driver" : "Linux the audio driver"} owns
            that connection, so the app can't reach the mixer without interrupting your audio. Audio itself works as usual. Today,
            mixer control works on macOS.
          </Empty>
        ) : !ready ? (
          <Empty title="Connect your MiniFuse 4">Plug it in over USB. Open MF picks it up automatically.</Empty>
        ) : (
          <>
            <MixerView mixer={mixer} />
            {wide && (
              // Native overflow: Radix ScrollArea's display:table wrapper let wide rows spill past the edge.
              <div className="w-[320px] shrink-0 overflow-x-hidden overflow-y-auto border-l bg-sunk">
                <Sidebar />
              </div>
            )}
          </>
        )}
      </div>
      {ready && !wide && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side="right"
            className="w-[320px] gap-0 bg-sunk p-0 sm:max-w-[320px]"
            // Focusing the first control would pop its tooltip on open.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Inputs and outputs</SheetTitle>
              <SheetDescription>Front-panel inputs and what each output plays.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <Sidebar />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
