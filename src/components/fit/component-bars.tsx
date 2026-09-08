import { FIT_TIER_WORD } from "@/lib/fit/inspect/display-labels";
import type { ComponentRow } from "@/lib/fit/pair-detail";
import type { FloorTier } from "@/lib/fit/types";
import { cn } from "@/lib/utils/cn";

/**
 * The eight scored components behind one pair (§8), in the inspector's
 * register: a weight bar, the number, and — in words, never in colour alone —
 * whether it clears the floor the tier above sets on it. E is a pass/fail
 * gate, not a bar: an ineligible pair has no stored row at all.
 *
 * `against` is the tier being measured towards, so the same 0.42 reads
 * "clears the Exploratory floor 0.35" on an Exploratory row and "below the
 * Strong floor 0.60" on a Moderate one. Server-safe.
 */
export function ComponentBars({ rows, against, className }: { rows: readonly ComponentRow[]; against: FloorTier | null; className?: string }) {
  return (
    <div className={cn("rounded-card border border-line bg-card px-3.5 py-3", className)}>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[104px_minmax(0,1fr)_40px] items-center gap-2 text-dense" title={r.help}>
            <span className="truncate text-ink-body">{r.label}</span>
            <span className="relative block h-1.5 overflow-hidden rounded-full bg-line-row">
              <span className={cn("block h-full rounded-full", r.met === false ? "bg-line-control" : "bg-teal")} style={{ width: `${r.value * 100}%` }} />
              {r.floor !== null ? <span aria-hidden className="absolute top-[-2px] block h-[10px] w-px bg-ink-muted" style={{ left: `${r.floor * 100}%` }} /> : null}
            </span>
            <span className="text-right font-mono text-meta tabular-nums text-ink">{r.value.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <p className="mb-0 mt-2.5 text-meta leading-normal text-ink-muted">
        {against
          ? `The tick on each bar is the floor ${FIT_TIER_WORD[against]} sets on that component. A tier is the set of floors a pair clears, not a score band — S only orders pairs inside one tier.`
          : "Every floor is met; S only orders pairs inside a tier."}
      </p>
      <dl className="mb-0 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-meta text-ink-muted">
        {rows
          .filter((r) => r.floor !== null)
          .map((r) => (
            <div key={r.key} className="contents">
              <dt className="truncate">{r.label}</dt>
              <dd className={cn("m-0 text-right tabular-nums", r.met ? "text-ink-body" : "text-warning")}>
                {r.value.toFixed(2)} {r.met ? "clears" : "below"} {r.floor!.toFixed(2)}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
