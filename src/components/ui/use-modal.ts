"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Modal plumbing shared by Dialog and SlideOver: traps Tab inside the panel,
 * closes on Esc, moves focus in on open and returns it to the trigger on close,
 * and locks background scroll while open.
 */
export function useModal(
  ref: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
) {
  const restoreTo = useRef<HTMLElement | null>(null);
  // Kept in a ref so a re-rendered parent's callback is picked up without
  // tearing down the trap (which would pull focus back to the top of the panel).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const panel = ref.current;
    if (panel) {
      // Prefer the first real control; fall back to the panel itself.
      const first = focusable(panel)[0];
      (first ?? panel).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;

      const items = focusable(ref.current);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !ref.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const returnFocusTo = restoreTo.current;

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
