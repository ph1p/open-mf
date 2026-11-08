import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Small uppercase heading over a group of settings. */
export const groupLabel = "text-[12px] font-semibold tracking-wide text-muted-foreground uppercase";
