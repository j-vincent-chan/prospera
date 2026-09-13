"use client";

import { useCallback, useRef, useTransition, type TransitionStartFunction } from "react";

/**
 * `useTransition` for a write. The 2026-09-13 audit found that
 * `disabled={pending}` alone does not stop a double-click: `isPending` turns
 * true only after React re-renders, so two clicks in the same tick both
 * start a transition and the server action runs twice — three clicks on
 * "Add note" wrote three notes. The guard here is synchronous: while one
 * submission is in flight, another call is ignored. Same tuple as
 * `useTransition`, so a component swaps the hook and nothing else.
 */
export function useSubmitTransition(): [boolean, TransitionStartFunction] {
  const [pending, start] = useTransition();
  const inFlight = useRef(false);
  const guarded = useCallback(
    (fn: () => void | Promise<void>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      start(async () => {
        try {
          await fn();
        } finally {
          inFlight.current = false;
        }
      });
    },
    [start],
  );
  return [pending, guarded as TransitionStartFunction];
}

/** Pure. The guard itself, for the test: a `start` that runs the callback, wrapped so re-entry while one is in flight is dropped. */
export function makeGuardedStart(start: (fn: () => Promise<void>) => void): (fn: () => void | Promise<void>) => void {
  let inFlight = false;
  return (fn) => {
    if (inFlight) return;
    inFlight = true;
    start(async () => {
      try {
        await fn();
      } finally {
        inFlight = false;
      }
    });
  };
}
