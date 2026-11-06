import { useEffect, useRef, useState, type RefObject } from "react";

/** Ref that always holds the latest value, for listeners bound once. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Wheel steps on an element. Needs a non-passive listener so the page doesn't scroll.
 * `onStep` gets +1 or -1 per 25 px of travel.
 */
export function useWheelSteps(ref: RefObject<HTMLElement | null>, onStep: (dir: 1 | -1) => void, horizontal = false) {
  const cb = useLatest(onStep);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += horizontal && Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY;
      while (Math.abs(acc) >= 25) {
        cb.current(acc > 0 ? 1 : -1);
        acc -= Math.sign(acc) * 25;
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [ref, cb, horizontal]);
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
