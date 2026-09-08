import { floorPairText, type ComponentRow } from "@/lib/fit/audit-view";
import { floors } from "@/lib/fit/taxonomy";
import type { FloorComponent, FloorTier } from "@/lib/fit/types";
import { cn } from "@/lib/utils/cn";

const FLOORED = new Set<string>(["P", "U", "D", "T", "M", "K"]);

/** The numeric floor a tier sets on a component (`taxonomy.tiers`, §10); undefined when the tier sets none — "any". */
function floorOf(tier: FloorTier, key: string): number | undefined {
  if (!FLOORED.has(key)) return undefined;
  const v = floors(tier)[key as FloorComponent];
  return typeof v === "number" ? v : undefined;
}

/** The colour a bar takes against the taxonomy's floors: teal at or above the Moderate floor, amber at or above the Exploratory floor, grey below; a component no tier floors (O, A) is drawn in one neutral colour. */
export function barTone(key: string, v: number): { className: string; title: string } {
  const moderate = floorOf("moderate", key);
  const exploratory = floorOf("exploratory", key);
  if (moderate === undefined) return { className: "bg-navy/40", title: "no floor in any tier" };
  const title = `Moderate floor ${moderate.toFixed(2)}${exploratory !== undefined ? ` · Exploratory floor ${exploratory.toFixed(2)}` : ""}`;
  if (v >= moderate) return { className: "bg-teal", title };
  if (exploratory !== undefined && v >= exploratory) return { className: "bg-warning", title };
  return { className: "bg-line-control", title };
}

/**
 * One row: id, label, bar, value, and the floor pair `taxonomy.json` states
 * for it.
 *
 * **The floor track is 168px because the pair needs 156.** Measured at 1366px
 * against the repo's compiled Tailwind, in Geist: "Strong 0.40 · Moderate
 * 0.25" is 156.0px at `text-meta`, and at the 152px the prototype uses every
 * floored component wrapped to two lines — the eight rows went 19.5px to
 * 34.8px each and the open block from 344px to 467px, for a string that is the
 * same length on every row. `whitespace-nowrap` keeps it one line whatever a
 * future floor value is; 168 is the width that lets it. The bar takes what is
 * left, and has 296px on the narrower of the two surfaces.
 */
const BAR_ROW = "grid grid-cols-[14px_110px_minmax(0,1fr)_44px_168px] items-center gap-2 text-dense";

/**
 * The component bars (plan § PR 3.2; **moved inside the audit layer's
 * collapsed "Engine internals" block in fit-UX PR 4**, README §"Screens /
 * views" 4.8 — these numbers are inputs to the verdicts above, not a decision
 * surface of their own, which is §2.5's complaint).
 *
 * What changed with the move: the rows arrive already built by
 * `audit-view.componentRows`, so the **real floor pair** ("Strong 0.75 ·
 * Moderate 0.50") is printed beside each bar rather than hidden in a `title`,
 * and it is read from `taxonomy.json` at render time — never typed here
 * (CLAUDE.md). The S / caps / stage-8 line moved out to the block itself,
 * where `auditInternals` composes it; this component is bars.
 *
 * Server-safe.
 */
export function ComponentBars({ rows }: { rows: readonly ComponentRow[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((b) => {
        const tone = barTone(b.key, b.value);
        return (
          <div key={b.key} className={BAR_ROW}>
            <span className="font-mono text-meta text-ink-muted">{b.key}</span>
            <span className="text-ink-body">{b.label}</span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-line-row" aria-hidden>
              <span className={cn("block h-full rounded-full", tone.className)} style={{ width: `${b.value * 100}%` }} />
            </span>
            <span className="text-right font-mono text-meta tabular-nums text-ink">{b.value.toFixed(2)}</span>
            <span className="whitespace-nowrap text-meta text-ink-muted">{floorPairText(b)}</span>
          </div>
        );
      })}
    </div>
  );
}
