import { useEffect, useState } from "react";
import { CheckIcon, KeyboardIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { app } from "@/lib/app";
import { fmtDb } from "@/lib/device";
import { settings } from "@/lib/settings";
import { OS } from "@/lib/platform";
import {
  DB_STEPS, PERCENT_STEPS, STARTER_SETS, VERBS, addSet, addShortcut, allowMediaKeys, closeShortcuts, defaultAmount,
  deleteShortcut, formatKeys, formatTrigger, hasAmount, hasSet, keysFromEvent, midiOnly, onCapture, openShortcuts,
  setRecording, setValuesFor, shortcutUi, shortcuts, subjectGroups, subjectLabel, updateShortcut, usedBy, verbLabel,
  verbName, type Captured, type Shortcut, type StarterSet, type Subject, type Verb,
} from "@/lib/shortcuts";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const group = "text-[12px] font-semibold tracking-wide text-muted-foreground uppercase";
const NONE = "inf";
const enc = (v: number | null) => (v === null ? NONE : String(v));
const dec = (v: string) => (v === NONE ? null : +v);

export function ShortcutsButton() {
  return (
    <Hint text="Shortcuts" side="bottom">
      <Button variant="ghost" size="icon-sm" className="size-8 text-muted-foreground" aria-label="Shortcuts" onClick={() => openShortcuts()}>
        <KeyboardIcon className="size-4" />
      </Button>
    </Hint>
  );
}

/** Captures the next key combination, media key or MIDI control while active. Esc cancels, ⌫ clears. */
function KeyRecorder({ sc, onError }: { sc: Shortcut; onError: (msg: string | null) => void }) {
  const recording = useStore(shortcutUi, (s) => s.recording === sc.id);

  useEffect(() => {
    if (!recording) return;
    const accept = (c: Captured) => {
      if ("keys" in c) {
        if (midiOnly(sc.verb)) return onError("Keys can't say where to. Move a knob or fader on your MIDI controller.");
        const other = usedBy(c.keys, sc.id);
        if (other) return onError(`${formatKeys(c.keys)} already does: ${subjectLabel(other.subject)}`);
        updateShortcut(sc.id, { keys: c.keys });
      } else {
        if (midiOnly(sc.verb) && c.midi.type !== "cc" && c.midi.type !== "pb") {
          return onError("That's a button. Move a knob or fader instead.");
        }
        updateShortcut(sc.id, { midi: c.midi });
      }
      onError(null);
      setRecording(null);
    };
    const down = (e: KeyboardEvent) => {
      // Capture phase on window: runs before the sheet's own Escape handling.
      e.preventDefault();
      e.stopPropagation();
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (plain && e.key === "Escape") return setRecording(null);
      if (plain && (e.code === "Backspace" || e.code === "Delete")) {
        updateShortcut(sc.id, { keys: "", midi: null });
        onError(null);
        return setRecording(null);
      }
      const r = keysFromEvent(e);
      if (!r) return;
      if ("error" in r) return onError(r.error);
      accept(r);
    };
    window.addEventListener("keydown", down, true);
    const off = onCapture(accept);
    return () => {
      window.removeEventListener("keydown", down, true);
      off();
    };
  }, [recording, sc.id, sc.verb, onError]);

  const label = formatTrigger(sc);
  return (
    <button
      type="button"
      onClick={() => setRecording(recording ? null : sc.id)}
      onBlur={() => recording && setRecording(null)}
      aria-label={label ? `Trigger ${label}, click to change` : "Set trigger"}
      title={label || undefined}
      className={cn(
        "h-8 max-w-44 min-w-24 shrink-0 truncate rounded-md border px-2 font-mono text-[13px] tabular-nums transition outline-none focus-visible:ring-2 focus-visible:ring-ring",
        recording
          ? "animate-pulse border-primary bg-primary/10 text-primary"
          : label
            ? "bg-muted/60 hover:bg-muted"
            : "border-dashed text-muted-foreground hover:text-foreground",
      )}
    >
      {recording ? "Listening…" : label || (midiOnly(sc.verb) ? "Set knob" : "Set keys")}
    </button>
  );
}

function ShortcutRow({ sc }: { sc: Shortcut }) {
  const failed = useStore(shortcutUi, (s) => s.failed[sc.id]);
  const recording = useStore(shortcutUi, (s) => s.recording === sc.id);
  const fired = useStore(shortcutUi, (s) => s.fired === sc.id);
  const mediaBlocked = useStore(shortcutUi, (s) => s.mediaBlocked);
  // Re-render on renames and preset changes.
  useStore(settings, (s) => s.names);
  useStore(app, (s) => s.userPresets);
  const [error, setError] = useState<string | null>(null);
  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 transition-colors duration-300",
        fired && "border-primary/60 bg-primary/5 duration-0",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{subjectLabel(sc.subject)}</p>
          <p className="truncate text-[12px] text-muted-foreground">{verbLabel(sc.subject, sc.verb, sc.amount)}</p>
        </div>
        <KeyRecorder sc={sc} onError={setError} />
        <Hint text="Delete shortcut" side="left">
          <Button variant="ghost" size="icon-sm" className="size-8 text-muted-foreground" aria-label="Delete shortcut" onClick={() => deleteShortcut(sc.id)}>
            <Trash2Icon className="size-4" />
          </Button>
        </Hint>
      </div>
      {recording && !error && (
        <p className="text-[12px] text-muted-foreground">
          {midiOnly(sc.verb)
            ? "Move a knob or fader on your MIDI controller. Esc cancels."
            : "Press keys, or a button on a MIDI controller. Esc cancels, ⌫ clears."}
          {OS === "mac" && mediaBlocked && !midiOnly(sc.verb) && (
            <>
              {" "}Volume and media keys need{" "}
              <button type="button" className="underline underline-offset-2" onMouseDown={(e) => e.preventDefault()} onClick={() => allowMediaKeys()}>
                Accessibility access
              </button>
              .
            </>
          )}
        </p>
      )}
      {error && <p className="text-[12px] text-destructive">{error}</p>}
      {failed && !recording && !error && (
        <p className="text-[12px] text-destructive">The system or another app already uses these keys. Pick others.</p>
      )}
    </li>
  );
}

function AmountSelect({ subject, verb, value, onChange }: {
  subject: Subject;
  verb: Verb;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const steps = verb === "set" ? setValuesFor(subject) : subject.kind === "system" ? PERCENT_STEPS : DB_STEPS;
  const label = (v: number | null) => (verb === "set" ? fmtDb(v) : `${v}${subject.kind === "system" ? " %" : " dB"}`);
  return (
    <Select value={enc(value)} onValueChange={(v) => onChange(dec(v))}>
      <SelectTrigger size="sm" className="w-full text-[13px]" aria-label={verb === "set" ? "Level" : "Step"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {steps.map((v) => (
          <SelectItem key={enc(v)} value={enc(v)} className="text-[13px]">
            {label(v)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddForm() {
  const draft = useStore(shortcutUi, (s) => s.draft);
  // The list depends on the device, its mixer layout, presets and names.
  useStore(app, (s) => s.stat.device?.controls.join());
  useStore(app, (s) => s.mixer?.link34);
  useStore(app, (s) => s.mixer !== null);
  useStore(app, (s) => s.userPresets);
  useStore(settings, (s) => s.pairs);
  useStore(settings, (s) => s.names);

  const groups = subjectGroups();
  const first = groups[0].items[0];
  const [subject, setSubject] = useState<Subject>(draft ?? first);
  const [verb, setVerb] = useState<Verb>(VERBS[(draft ?? first).kind][0]);
  const [amount, setAmount] = useState<number | null>(defaultAmount(draft ?? first, VERBS[(draft ?? first).kind][0]));

  const pick = (s: Subject, v?: Verb) => {
    const nv = v && VERBS[s.kind].includes(v) ? v : VERBS[s.kind][0];
    setSubject(s);
    setVerb(nv);
    setAmount(defaultAmount(s, nv));
  };
  useEffect(() => {
    if (draft) pick(draft);
  }, [draft]);

  const key = JSON.stringify(subject);
  const known = groups.some((g) => g.items.some((s) => JSON.stringify(s) === key));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <Label className="text-[13px] text-muted-foreground">Control</Label>
      <Select value={key} onValueChange={(v) => pick(JSON.parse(v), verb)}>
        <SelectTrigger size="sm" className="w-full text-[13px]" aria-label="Control">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {!known && (
            <SelectItem value={key} className="text-[13px]">
              {subjectLabel(subject)}
            </SelectItem>
          )}
          {groups.map((g) => (
            <SelectGroup key={g.label}>
              <SelectLabel className="text-[12px]">{g.label}</SelectLabel>
              {g.items.map((s) => {
                const v = JSON.stringify(s);
                return (
                  <SelectItem key={v} value={v} className="text-[13px]">
                    {subjectLabel(s)}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[13px] text-muted-foreground">Does</Label>
          <Select
            value={verb}
            onValueChange={(v) => {
              setVerb(v as Verb);
              setAmount(defaultAmount(subject, v as Verb));
            }}
          >
            <SelectTrigger size="sm" className="w-full text-[13px]" aria-label="Action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VERBS[subject.kind].map((v) => (
                <SelectItem key={v} value={v} className="text-[13px]">
                  {verbName(subject, v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hasAmount(verb) && (
          <div className="flex flex-col gap-1">
            <Label className="text-[13px] text-muted-foreground">{verb === "set" ? "Level" : "Step"}</Label>
            <AmountSelect subject={subject} verb={verb} value={amount} onChange={setAmount} />
          </div>
        )}
      </div>
      {verb === "set" && (
        <p className="text-[12px] text-muted-foreground">Press once to jump there, again to go back. Good for dimming speakers.</p>
      )}
      {verb === "follow" && (
        <p className="text-[12px] text-muted-foreground">The level follows a knob or fader on a MIDI controller, along the same curve as the fader here.</p>
      )}
      <Button size="sm" className="mt-1 self-start" onClick={() => addShortcut(subject, verb, amount)}>
        <PlusIcon className="size-4" />
        {midiOnly(verb) ? "Add and move a knob" : "Add and press keys"}
      </Button>
    </div>
  );
}

function SetCard({ set }: { set: StarterSet }) {
  // Re-check when shortcuts change.
  useStore(shortcuts, (s) => s);
  const added = hasSet(set);
  const keys = set.items().map((i) => formatKeys(i.keys));
  return (
    <li className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">{set.name}</p>
        <p className="text-[12px] text-muted-foreground">{set.hint}</p>
        <p className="mt-1 flex flex-wrap gap-1">
          {keys.map((k) => (
            <kbd key={k} className="rounded border bg-muted/60 px-1.5 font-mono text-[11px] text-muted-foreground">
              {k}
            </kbd>
          ))}
        </p>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" disabled={added} onClick={() => addSet(set)}>
        {added ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
        {added ? "Added" : "Add"}
      </Button>
    </li>
  );
}

function StarterSets() {
  const hasMixer = useStore(app, (s) => s.mixer !== null);
  const sets = STARTER_SETS.filter((x) => hasMixer || !x.mixer);
  return (
    <ul className="flex flex-col gap-2">
      {sets.map((x) => (
        <SetCard key={x.id} set={x} />
      ))}
    </ul>
  );
}

function MediaKeysBanner() {
  const blocked = useStore(shortcutUi, (s) => s.mediaBlocked);
  const usesMedia = useStore(shortcuts, (l) => l.some((x) => /\+?(Audio|Media)\w+$/.test(x.keys)));
  if (OS !== "mac" || !blocked || !usesMedia) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px]">
      <p>
        Volume and media keys need Accessibility access. Allow Open MF in System Settings › Privacy &amp; Security ›
        Accessibility, then come back here.
      </p>
      <Button size="sm" variant="outline" className="self-start" onClick={() => allowMediaKeys()}>
        Allow access
      </Button>
    </div>
  );
}

function MidiStatus() {
  const ports = useStore(shortcutUi, (s) => s.midiPorts);
  if (ports === null) return null;
  return (
    <p className="text-[12px] text-muted-foreground">
      {ports.length
        ? `MIDI: ${ports.join(", ")}. Any button, key, knob or fader on these can be a trigger.`
        : "No MIDI controller found. Plug one in to use its buttons and knobs; apps with virtual MIDI ports work too."}
    </p>
  );
}

/** Lists, records and deletes global shortcuts. */
export function ShortcutsSheet() {
  const open = useStore(shortcutUi, (s) => s.open);
  const list = useStore(shortcuts, (s) => s);
  return (
    <Sheet open={open} onOpenChange={(o) => (o ? openShortcuts() : closeShortcuts())}>
      <SheetContent side="right" className="w-[420px] gap-0 p-0 sm:max-w-[420px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader className="border-b">
          <SheetTitle>Shortcuts</SheetTitle>
          <SheetDescription>
            Keys and MIDI controls that work from any app, even with Open MF in the background.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <MediaKeysBanner />
          <span className={group}>Your shortcuts</span>
          {list.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              None yet. Start with a set below, add your own, or right-click a fader and pick “Add shortcut…”.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((sc) => (
                <ShortcutRow key={sc.id} sc={sc} />
              ))}
            </ul>
          )}
          <span className={cn(group, "mt-2")}>New shortcut</span>
          <AddForm />
          <MidiStatus />
          <span className={cn(group, "mt-2")}>Ready-made sets</span>
          <StarterSets />
        </div>
      </SheetContent>
    </Sheet>
  );
}
