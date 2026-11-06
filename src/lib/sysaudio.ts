import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { toast } from "sonner";
import { createStore } from "./store";

/** What the OS does with sound: its outputs, the MiniFuse's system volume, apps playing to it. */
export type SystemAudio = {
  /** False on OSes without a backend (Windows for now). */
  supported: boolean;
  outputs: { id: string; name: string; isDefault: boolean }[];
  /** The MiniFuse's output id, when the OS sees it. */
  device: string | null;
  /** 0..1. Null when the OS has no software volume for the MiniFuse. */
  volume: number | null;
  muted: boolean | null;
  /** Null when this OS version cannot list apps (macOS before 14.2). */
  apps: { id: string; name: string; volume: number | null }[] | null;
};

export const sysAudio = createStore<SystemAudio | null>(null);

const fail = (e: unknown) => toast.error(String(e));
/** Polls skip results that would undo a local change still settling. */
let writeAt = 0;

async function refresh() {
  if (performance.now() - writeAt < 1000) return;
  try {
    const next = await invoke<SystemAudio>("system_audio");
    if (performance.now() - writeAt < 1000) return;
    if (JSON.stringify(next) !== JSON.stringify(sysAudio.get())) sysAudio.set(next);
  } catch {
    sysAudio.set(null);
  }
}

function local(fn: (s: SystemAudio) => SystemAudio) {
  writeAt = performance.now();
  sysAudio.set((s) => (s ? fn(s) : s));
}

/** Polls while a component that shows system audio is mounted. */
export function useSystemAudio() {
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refresh();
      if (alive) t = setTimeout(poll, document.hasFocus() ? 1500 : 5000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);
}

export async function makeDefaultOutput(id: string) {
  local((s) => ({ ...s, outputs: s.outputs.map((o) => ({ ...o, isDefault: o.id === id })) }));
  await invoke("set_default_output", { id }).catch(fail);
  writeAt = 0;
  void refresh();
}

export async function setSystemVolume(volume: number) {
  local((s) => ({ ...s, volume }));
  await invoke("set_system_volume", { volume }).catch(fail);
}

export async function setSystemMute(on: boolean) {
  local((s) => ({ ...s, muted: on }));
  await invoke("set_system_mute", { on }).catch(fail);
}

export async function setAppVolume(id: string, volume: number) {
  local((s) => ({ ...s, apps: s.apps?.map((a) => (a.id === id ? { ...a, volume } : a)) ?? null }));
  await invoke("set_app_volume", { id, volume }).catch(fail);
}
