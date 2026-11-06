import type { ReactNode } from "react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const RESET_HINT = "Double-click / ⌥-click / ⌫: reset";

/**
 * Wraps a control with the reset hint and a right-click menu: reset it, make its current
 * value the default, reset the whole strip.
 */
export function ControlMenu({
  children,
  className,
  defaultText,
  onReset,
  onSetDefault,
  onResetStrip,
}: {
  children: ReactNode;
  className?: string;
  /** What "Reset" goes to, e.g. "0.0 dB" or "C". */
  defaultText: string;
  onReset: () => void;
  onSetDefault: () => void;
  onResetStrip?: () => void;
}) {
  return (
    <ContextMenu>
      <Tooltip delayDuration={1500}>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <div className={className}>{children}</div>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{RESET_HINT}</TooltipContent>
      </Tooltip>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={onReset}>
          Reset to default <span className="text-muted-foreground">({defaultText})</span>
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onSetDefault}>Set current as default</ContextMenuItem>
        {onResetStrip && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onResetStrip}>
              Reset whole strip
              <ContextMenuShortcut>R</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
