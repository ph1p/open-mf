import { CopyIcon, EllipsisIcon, PlusIcon } from "lucide-react";
import { Tabs } from "radix-ui";
import { Hint } from "@/components/Hint";
import { Meter } from "@/components/Meter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  addUnit, app, busMeter, clearSolo, copyMix, heardOn, muteAll, resetMix, setBus, setSource, unitName, type Unit,
} from "@/lib/app";
import { DESTINATIONS, MIXES, type Mixer } from "@/lib/device";
import { settings, updateSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function MiniMeters({ mixer, bus }: { mixer: Mixer; bus: number }) {
  return (
    <span className="flex h-4 gap-px" aria-hidden="true">
      {([0, 1] as const).map((side) => (
        <Meter key={side} select={(v) => busMeter(mixer, v, bus, side)} label="" className="h-full w-[3px]" />
      ))}
    </span>
  );
}

/** Menu of channels that are not in the shown mix; picking one adds it. */
export function AddMenu({
  missing,
  side = "bottom",
  align = "end",
  children,
}: {
  missing: Unit[];
  side?: "bottom" | "right";
  align?: "start" | "center" | "end";
  children: React.ReactNode;
}) {
  const names = useStore(settings, (s) => s.names);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-52">
        <DropdownMenuLabel className="text-[12px] text-muted-foreground">Add to this mix</DropdownMenuLabel>
        {missing.map((u) => (
          <DropdownMenuItem key={u.key} onSelect={() => addUnit(u)} className="text-[14px]">
            {unitName(u, names)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mix tabs, then what to do with the shown mix. */
export function MixerToolbar({ mixer, bus, missing }: { mixer: Mixer; bus: number; missing: Unit[] }) {
  const showAll = useStore(settings, (s) => s.showAll);
  const applying = useStore(app, (s) => s.applying);
  const strips = mixer.buses[bus].strips;
  const anySolo = strips.some((s) => s.solo);
  const anyMuted = strips.some((s) => s.mute);
  const heard = heardOn(mixer, bus);

  return (
    <div className="flex flex-col gap-2.5 border-b px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs.Root value={String(bus)} onValueChange={(v) => setBus(+v)}>
          <Tabs.List aria-label="Mix to edit" className="flex gap-1 rounded-xl border bg-muted/40 p-1">
            {MIXES.map((m, i) => (
              <Hint key={i} text={`${DESTINATIONS[i].hint}. Shortcut: ${i + 1}`} side="bottom" delay={600}>
                <Tabs.Trigger
                  value={String(i)}
                  className={cn(
                    "group/tab relative flex flex-col items-start rounded-lg px-4 py-2 text-left text-muted-foreground transition outline-none",
                    "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    "aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-sm aria-selected:ring-1 aria-selected:ring-primary/50",
                  )}
                >
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    <MiniMeters mixer={mixer} bus={i} />
                    {m.name}
                  </span>
                  <span className="pl-[15px] text-[12px] group-aria-selected/tab:font-medium group-aria-selected/tab:text-primary">
                    {m.tag}
                  </span>
                  {/* Underline marks the mix being edited, readable without color alone. Styled via
                      aria-selected: the tooltip wrapper overwrites data-state with its own. */}
                  <span
                    className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-primary opacity-0 transition group-aria-selected/tab:opacity-100"
                    aria-hidden="true"
                  />
                </Tabs.Trigger>
              </Hint>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <span className="flex-1" />
        {!showAll && (
          <AddMenu missing={missing}>
            <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[13px]" disabled={!missing.length}>
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          </AddMenu>
        )}
        <Hint text="Show every channel, including ones that are off in this mix" side="bottom">
          <Label className="flex items-center gap-1.5 text-[13px] font-normal text-muted-foreground">
            <Switch size="sm" checked={showAll} onCheckedChange={(v) => updateSettings({ showAll: v })} />
            Show all
          </Label>
        </Hint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Mix actions" disabled={applying}>
              <EllipsisIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 text-[14px]">
            <DropdownMenuItem disabled={!anySolo} onSelect={clearSolo}>Clear solo</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => muteAll(true)}>Mute all</DropdownMenuItem>
            <DropdownMenuItem disabled={!anyMuted} onSelect={() => muteAll(false)}>Unmute all</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <CopyIcon className="size-3.5" />
                Copy this mix to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {MIXES.map((m, i) =>
                  i === bus ? null : (
                    <DropdownMenuItem key={i} onSelect={() => copyMix(bus, i)}>
                      Mix for {m.name}
                      <DropdownMenuShortcut>{m.tag}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={resetMix}>
              Reset mix to defaults
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
        <p className="min-w-0">
          <span className="font-semibold">Editing the {MIXES[bus].mixName}.</span>{" "}
          <span className="text-muted-foreground">{MIXES[bus].about}</span>
        </p>
        <p className="ml-auto flex flex-wrap items-center gap-1.5">
          {heard.length ? (
            <>
              <span className="text-muted-foreground">Heard on</span>
              {heard.map((d) => (
                <span key={d} className="rounded bg-primary/10 px-1.5 py-px font-medium text-primary">
                  {DESTINATIONS[d].name}
                </span>
              ))}
            </>
          ) : (
            <>
              <span className="rounded bg-amber-500/15 px-1.5 py-px font-medium text-amber-700 dark:text-amber-400">
                Not heard anywhere
              </span>
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => setSource(bus, MIXES[bus].ownSource)}
              >
                Play it on {DESTINATIONS[bus].name}
              </button>
            </>
          )}
        </p>
      </div>
      {anySolo && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-amber-400/15 px-3 py-1.5 text-[13px]">
          <span className="font-semibold text-amber-700 dark:text-amber-400">Solo is on</span>
          <span className="text-muted-foreground">This mix plays only the soloed channels.</span>
          <Button variant="link" size="xs" className="ml-auto h-auto p-0 text-[13px]" onClick={clearSolo}>
            Clear solo
          </Button>
        </p>
      )}
    </div>
  );
}
