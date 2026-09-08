"use client";

import { toggleLabel } from "@/components/fit/verdict-row-view";
import { cn } from "@/lib/utils/cn";

/**
 * The fit row's one interactive element that has to be a client component
 * (fit-UX PR 2): the disclosure toggle.
 *
 * `verdict-row.tsx` itself is a server component — it is markup over a pure
 * class table and holds no state, no effect and no browser API. This button
 * is split out so the client boundary is exactly one `<button>` wide rather
 * than the whole row: a server list that renders `VerdictRow` ships this and
 * nothing else to the browser.
 *
 * The open state is **not** held here. One row open at a time is the list's
 * job (README §"Interactions & behaviour"; PR 3's shell holds
 * `{ open, selected, filter, … }`), so `open` arrives as a prop and the
 * button only reports the intent. A local `useState` would be a second source
 * of truth and would let two rows sit open at once.
 *
 * A11y: a real `<button>` with `aria-expanded` and `aria-controls` pointing at
 * a region that is always in the DOM (`verdict-row.tsx` hides it with
 * `hidden`, never by unmounting it), so the reference never dangles. Focus is
 * the app-wide 2px teal ring from `globals.css` — no per-component ring.
 */
export function DisclosureToggle({
  panelId,
  open,
  onToggle,
  className,
}: {
  /** The id of the region this button controls. */
  panelId: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className={cn("ml-1 rounded-control text-meta font-medium text-teal hover:text-navy", className)}
    >
      {toggleLabel(open)}
    </button>
  );
}
