import { useSyncExternalStore } from "react";

/** Minimal external store. Actions live outside React, so polling and shortcuts never see stale state. */
export type Store<T> = {
  get: () => T;
  set: (next: T | ((s: T) => T)) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === "function" ? (next as (s: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      subs.forEach((fn) => fn());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Subscribe to a slice. The selector must return a stable value (a primitive or a stored object). */
export function useStore<T, S>(store: Store<T>, select: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
