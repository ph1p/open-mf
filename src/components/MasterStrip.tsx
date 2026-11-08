import { ControlMenu } from "@/components/ControlMenu";
import { DbReadout } from "@/components/DbReadout";
import { Fader } from "@/components/Fader";
import { Hint } from "@/components/Hint";
import { Meter } from "@/components/Meter";
import { busMeter, defaultOf, masterKey, moveMaster, resetMaster, setMasterDefault, startDrag, typeMaster } from "@/lib/app";
import { fmtDb, MIXES, type Mixer } from "@/lib/device";

/** Overall level of the shown mix. Meters show the mix after this level. */
export function MasterStrip({ mixer, bus }: { mixer: Mixer; bus: number }) {
  const db = mixer.buses[bus].masterDb;
  return (
    <section
      aria-label="Mix level"
      className="relative flex w-[100px] shrink-0 flex-col items-center gap-2 rounded-md border bg-card px-2 pt-0 pb-2"
    >
      <span className="absolute inset-x-2 top-0 h-0.5 rounded-b bg-primary" aria-hidden="true" />
      <Hint text="Meters show the mix after this level">
        <h3 tabIndex={0} className="mt-2 h-5 rounded px-1 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Mix level
        </h3>
      </Hint>
      <div className="flex h-(--fader-h) w-full justify-center gap-1.5">
        <div className="flex gap-0.5 py-1.5">
          {([0, 1] as const).map((side) => (
            <Meter key={side} select={(v) => busMeter(mixer, v, bus, side)} label={`Mix ${side ? "right" : "left"} signal`} />
          ))}
        </div>
        <ControlMenu
          className="h-full"
          defaultText={fmtDb(defaultOf(masterKey(bus)))}
          onReset={resetMaster}
          onSetDefault={setMasterDefault}
          shortcut={{ kind: "master", bus }}
        >
          <Fader
            value={db}
            max={0}
            label={`Mix level for ${MIXES[bus].name}`}
            onChange={moveMaster}
            onReset={resetMaster}
            onDragStart={startDrag}
          />
        </ControlMenu>
      </div>
      <DbReadout value={db} max={0} label="Mix level" onCommit={typeMaster} />
      <span className="text-[12px] text-muted-foreground">Overall</span>
    </section>
  );
}
