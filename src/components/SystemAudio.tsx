import { CheckIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Intro } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { app } from "@/lib/app";
import { OS } from "@/lib/platform";
import { useStore } from "@/lib/store";
import {
  makeDefaultOutput, setAppVolume, setSystemMute, setSystemVolume, sysAudio, useSystemAudio,
} from "@/lib/sysaudio";
import { cn } from "@/lib/utils";

const HINT = "How your computer sends sound to the MiniFuse.";
const MIXER_HINT = `${HINT} It arrives in the mixer as USB 1–2.`;

/** 0..1 slider with a percent readout. */
function Level({ value, label, disabled, onChange }: {
  value: number;
  label: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(+e.target.value / 100)}
        className="min-w-0 flex-1 accent-primary disabled:opacity-50"
      />
      <output className="w-10 text-right text-[12px] tabular-nums">{Math.round(value * 100)}%</output>
    </>
  );
}

function Note({ children }: { children: string }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

/** System output, system volume and the apps playing to the MiniFuse. Hidden parts per OS. */
export function SystemAudio() {
  useSystemAudio();
  const s = useStore(sysAudio, (v) => v);
  const mixer = useStore(app, (v) => v.stat.device?.mixer ?? false);

  let body;
  if (OS === "windows" || (s && !s.supported)) {
    body = <Note>Not available on this system yet. Pick the MiniFuse in your sound settings instead.</Note>;
  } else if (!s) {
    body = <Note>Reading system audio…</Note>;
  } else if (!s.device) {
    body = <Note>Your computer does not list the MiniFuse as a sound output. Check the USB cable.</Note>;
  } else {
    const isDefault = s.outputs.some((o) => o.id === s.device && o.isDefault);
    const current = s.outputs.find((o) => o.isDefault)?.name;
    body = (
      <div className="flex flex-col gap-3">
        {isDefault ? (
          <p className="flex items-center gap-1.5 text-[13px]">
            <CheckIcon className="size-4 text-primary" />
            Your computer plays its sound here.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Note>{`Your computer plays its sound on ${current ?? "another output"}. Apps that pick an output themselves can still play here.`}</Note>
            <Button size="sm" onClick={() => void makeDefaultOutput(s.device!)}>
              Play computer sound on the MiniFuse
            </Button>
          </div>
        )}

        {s.volume !== null || s.muted !== null ? (
          <div className="flex items-center gap-2">
            {s.muted !== null && (
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-8", s.muted && "text-warn")}
                aria-label={s.muted ? "Unmute computer sound" : "Mute computer sound"}
                aria-pressed={s.muted}
                onClick={() => void setSystemMute(!s.muted)}
              >
                {s.muted ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
              </Button>
            )}
            {s.volume !== null && (
              <Level value={s.volume} label="Computer volume" disabled={s.muted === true} onChange={setSystemVolume} />
            )}
          </div>
        ) : (
          <Note>
            {mixer
              ? "Volume: use the USB 1–2 fader in the mixer, or the monitor knob on the device."
              : "Volume: use the monitor knob on the device."}
          </Note>
        )}

        <div>
          <h3 className="mb-1.5 text-[13px] font-medium">Playing now</h3>
          {s.apps === null ? (
            <Note>Needs macOS 14.2 or newer.</Note>
          ) : s.apps.length === 0 ? (
            <Note>Nothing is playing to the MiniFuse.</Note>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {s.apps.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[13px]">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-violet-500" aria-hidden="true" />
                  <span className={cn("truncate", a.volume !== null ? "w-24 shrink-0" : "min-w-0 flex-1")}>{a.name}</span>
                  {a.volume !== null && (
                    <Level value={a.volume} label={`${a.name} volume`} onChange={(v) => void setAppVolume(a.id, v)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <section>
      <Intro>{mixer ? MIXER_HINT : HINT}</Intro>
      {body}
    </section>
  );
}
