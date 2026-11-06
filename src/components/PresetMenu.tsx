import { useState } from "react";
import { CheckIcon, ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { app, applyPreset, deletePreset, presetMatches, savePreset } from "@/lib/app";
import { BUILTIN_PRESETS } from "@/lib/presets";
import { useStore } from "@/lib/store";

/** Presets dropdown in the title bar. "Save current as…" opens a small popover. */
export function PresetMenu() {
  const mixer = useStore(app, (s) => s.mixer);
  const applying = useStore(app, (s) => s.applying);
  const userPresets = useStore(app, (s) => s.userPresets);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  if (!mixer) return null;

  const builtins = BUILTIN_PRESETS.map((p) => ({ p, data: p.build() }));
  const active =
    builtins.find((b) => presetMatches(mixer, b.data))?.p.name ?? userPresets.find((p) => presetMatches(mixer, p.data))?.name;

  const save = () => {
    if (!name.trim()) return;
    savePreset(name);
    setName("");
    setSaving(false);
  };

  return (
    <Popover open={saving} onOpenChange={setSaving}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={applying} className="h-7 gap-1 px-2 text-[13px]">
              <span className="text-muted-foreground">Preset</span>
              <span className="max-w-40 truncate font-medium">{active ?? "Custom"}</span>
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel className="text-[12px] text-muted-foreground">Built in</DropdownMenuLabel>
          {builtins.map(({ p, data }) => (
            <DropdownMenuItem key={p.id} onSelect={() => void applyPreset(p.name, data)} className="items-start gap-2">
              <CheckIcon className={presetMatches(mixer, data) ? "mt-0.5 size-3.5" : "mt-0.5 size-3.5 opacity-0"} />
              <span className="flex flex-col">
                <span className="text-[14px]">{p.name}</span>
                <span className="text-[12px] text-muted-foreground">{p.desc}</span>
              </span>
            </DropdownMenuItem>
          ))}
          {userPresets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[12px] text-muted-foreground">Yours</DropdownMenuLabel>
              {userPresets.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => void applyPreset(p.name, p.data)} className="group/item items-start gap-2">
                  <CheckIcon className={presetMatches(mixer, p.data) ? "mt-0.5 size-3.5" : "mt-0.5 size-3.5 opacity-0"} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px]">{p.name}</span>
                    <span className="text-[12px] text-muted-foreground">
                      Saved {new Date(p.savedAt).toLocaleString()}. Includes mix levels.
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete ${p.name}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      deletePreset(p);
                    }}
                    className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)} className="gap-2 text-[14px]">
            <PlusIcon className="size-3.5" />
            Save current as…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent align="start" className="w-72 p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={32}
            placeholder="Name this setup"
            aria-label="Preset name"
            onChange={(e) => setName(e.currentTarget.value)}
            className="h-8 text-[14px]"
          />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            Save
          </Button>
        </form>
        <p className="mt-2 text-[12px] text-muted-foreground">Saving under an existing name updates it.</p>
      </PopoverContent>
    </Popover>
  );
}
