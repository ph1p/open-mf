import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelRightIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { Hint } from "@/components/Hint";
import { PresetMenu } from "@/components/PresetMenu";
import { LedPopover, PrefsPopover } from "@/components/PrefsPopover";
import { Button } from "@/components/ui/button";
import { app, redo, undo } from "@/lib/app";
import { OS } from "@/lib/platform";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const MOD = OS === "mac" ? "⌘" : "Ctrl+";

function Logo() {
  return (
    <svg viewBox="0 0 16 16" className="pointer-events-none size-4 text-primary" aria-hidden="true">
      <rect x="2" y="2" width="2" height="12" rx="1" fill="currentColor" opacity=".35" />
      <rect x="7" y="2" width="2" height="12" rx="1" fill="currentColor" opacity=".35" />
      <rect x="12" y="2" width="2" height="12" rx="1" fill="currentColor" opacity=".35" />
      <rect x="1" y="9" width="4" height="2.5" rx="1" fill="currentColor" />
      <rect x="6" y="4" width="4" height="2.5" rx="1" fill="currentColor" />
      <rect x="11" y="7" width="4" height="2.5" rx="1" fill="currentColor" />
    </svg>
  );
}

function Status() {
  const stat = useStore(app, (s) => s.stat);
  return (
    <span
      data-tauri-drag-region
      className={cn(
        "flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[12px]",
        stat.connected ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className={cn("pointer-events-none size-1.5 rounded-full", stat.connected ? "bg-primary" : "bg-muted-foreground/40")} />
      <span className="pointer-events-none">{stat.connected ? "MiniFuse 4" : stat.supported ? "No device" : "Not supported here"}</span>
      {stat.sampleRate && <span className="pointer-events-none text-muted-foreground">{(stat.sampleRate / 1000).toFixed(1)} kHz</span>}
    </span>
  );
}

function UndoRedo() {
  const undoLabel = useStore(app, (s) => s.undoLabel);
  const redoLabel = useStore(app, (s) => s.redoLabel);
  const applying = useStore(app, (s) => s.applying);
  return (
    <span className="flex">
      <Hint text={undoLabel ? `Undo ${undoLabel} (${MOD}Z)` : "Nothing to undo"} side="bottom">
        <span>
          <Button variant="ghost" size="icon-sm" className="size-8" aria-label="Undo" disabled={!undoLabel || applying} onClick={() => void undo()}>
            <Undo2Icon className="size-4" />
          </Button>
        </span>
      </Hint>
      <Hint text={redoLabel ? `Redo ${redoLabel} (${OS === "mac" ? "⇧⌘Z" : "Ctrl+Y"})` : "Nothing to redo"} side="bottom">
        <span>
          <Button variant="ghost" size="icon-sm" className="size-8" aria-label="Redo" disabled={!redoLabel || applying} onClick={() => void redo()}>
            <Redo2Icon className="size-4" />
          </Button>
        </span>
      </Hint>
    </span>
  );
}

/** Minimize / maximize / close for undecorated windows (Windows, Linux). */
function WindowButtons() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized).catch(() => {});
    sync();
    const off = win.onResized(sync);
    return () => void off.then((f) => f());
  }, []);
  const win = getCurrentWindow();
  const btn =
    OS === "windows"
      ? "grid h-full w-[46px] place-items-center text-foreground/80 transition-colors hover:bg-foreground/10"
      : "grid size-6 place-items-center rounded-full bg-foreground/5 text-foreground/80 transition-colors hover:bg-foreground/15";
  return (
    <div className={cn("flex", OS === "windows" ? "h-full" : "gap-2")}>
      <button type="button" className={btn} aria-label="Minimize" title="Minimize" onClick={() => void win.minimize()}>
        <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button
        type="button"
        className={btn}
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void win.toggleMaximize()}
      >
        <svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          {maximized ? (
            <>
              <rect x="1" y="3" width="6" height="6" />
              <path d="M3 3V1h6v6H7" />
            </>
          ) : (
            <rect x="1" y="1" width="8" height="8" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className={cn(btn, OS === "windows" ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-red-500 hover:text-white")}
        aria-label="Close"
        title="Close"
        onClick={() => void win.close()}
      >
        <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}

/**
 * Custom title bar. macOS keeps its native traffic lights (overlay title bar), so we only
 * leave room for them. Windows and Linux are undecorated and get our own buttons.
 * `data-tauri-drag-region` only applies to the element that carries it, not children.
 */
export function TitleBar({ sidebarToggle }: { sidebarToggle?: ReactNode }) {
  const hasMixer = useStore(app, (s) => s.mixer !== null);
  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative z-10 flex h-10 shrink-0 items-center gap-2 border-b bg-card",
        OS === "mac" ? "pl-[84px]" : "pl-3",
        OS === "windows" ? "pr-0" : "pr-2",
      )}
    >
      <span data-tauri-drag-region className="flex items-center gap-2">
        <Logo />
        <span data-tauri-drag-region className="text-[14px] tracking-tight">
          <span className="pointer-events-none font-normal text-muted-foreground">Open </span>
          <span className="pointer-events-none font-semibold">MF</span>
        </span>
      </span>
      <Status />
      {hasMixer && (
        <>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <PresetMenu />
        </>
      )}
      <span data-tauri-drag-region className="h-full flex-1" />
      {hasMixer && <UndoRedo />}
      <LedPopover />
      <PrefsPopover />
      {sidebarToggle}
      {OS !== "mac" && (
        <>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <WindowButtons />
        </>
      )}
    </header>
  );
}

export function SidebarToggle({ onClick }: { onClick: () => void }) {
  return (
    <Hint text="Inputs and outputs" side="bottom">
      <Button variant="ghost" size="icon-sm" className="size-8 text-muted-foreground" aria-label="Inputs and outputs" onClick={onClick}>
        <PanelRightIcon className="size-4" />
      </Button>
    </Hint>
  );
}
