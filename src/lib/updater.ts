import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { createStore } from "./store";

// Updates come from the GitHub release feed (latest.json, signed in CI). Open MF checks a few
// seconds after launch and every few hours, offers new versions in a toast and in the title
// bar, and installs on request, then restarts.

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; version: string; progress: number | null }
  | { kind: "error"; message: string };

export const updater = createStore<{ current: string | null; state: UpdateState }>({
  current: null,
  state: { kind: "idle" },
});

const set = (state: UpdateState) => updater.set((u) => ({ ...u, state }));
let pending: Update | null = null;

const busy = () => ["checking", "downloading"].includes(updater.get().state.kind);

/** Looks for a newer release. `manual` also reports "up to date" and errors. */
export async function checkForUpdates(manual = false) {
  if (busy()) return;
  set({ kind: "checking" });
  try {
    const u = await check();
    pending = u;
    if (!u) {
      set({ kind: "idle" });
      if (manual) toast("Open MF is up to date", { id: "update" });
      return;
    }
    set({ kind: "available", version: u.version, notes: u.body ?? "" });
    toast(`Open MF ${u.version} is available`, {
      id: "update",
      duration: manual ? 10000 : 15000,
      action: { label: "Update and restart", onClick: () => installUpdate() },
    });
  } catch (e) {
    const message = String(e);
    set({ kind: "error", message });
    if (manual) toast.error(`Couldn't check for updates: ${message}`, { id: "update" });
  }
}

/** Downloads and installs the found update, then restarts the app. */
export async function installUpdate() {
  const u = pending;
  if (!u || busy()) return;
  let total = 0;
  let got = 0;
  set({ kind: "downloading", version: u.version, progress: null });
  try {
    await u.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      if (e.event === "Progress") {
        got += e.data.chunkLength;
        set({ kind: "downloading", version: u.version, progress: total ? got / total : null });
      }
    });
    await relaunch();
  } catch (e) {
    const message = String(e);
    set({ kind: "available", version: u.version, notes: u.body ?? "" });
    toast.error(`Update failed: ${message}`, { id: "update" });
  }
}

const EVERY = 6 * 60 * 60 * 1000;

/** Checks shortly after launch and then every few hours. Release builds only. */
export function startUpdater() {
  getVersion().then((current) => updater.set((u) => ({ ...u, current })), () => {});
  if (!import.meta.env.PROD) return () => {};
  const first = setTimeout(() => checkForUpdates(), 5000);
  const again = setInterval(() => {
    if (updater.get().state.kind !== "available") checkForUpdates();
  }, EVERY);
  return () => {
    clearTimeout(first);
    clearInterval(again);
  };
}
