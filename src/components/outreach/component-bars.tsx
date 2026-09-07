import { floors } from "@/lib/fit/taxonomy";
import type { FloorComponent, FloorTier } from "@/lib/fit/types";
import type { SuggestionFit } from "@/lib/outreach/queries";
import { cn } from "@/lib/utils/cn";

/** The eight scored components in the order the spec names them (§8); E is a pass/fail gate and is not a bar. */
const BARS: Array<{ key: "P" | "U" | "D" | "T" | "M" | "O" | "K" | "A"; label: string; help: string }> = [
  { key: "P", label: "Paradigm", help: "How the work asks its questions — the gating axis." },
  { key: "U", label: "Unit", help: "The level of organization studied." },
  { key: "D", label: "Design", help: "Study designs the evidence uses against those the notice requires." },
  { key: "T", label: "Topic", help: "Coded overlap on MeSH / RCDC with depth and IDF, item embeddings, BM25." },
  { key: "M", label: "Methods", help: "Required methods and capabilities met." },
  { key: "O", label: "Objective", help: "Scientific objective alignment; scored, never gates." },
  { key: "K", label: "Track record", help: "Mechanisms held against the notice's activity code." },
  { key: "A", label: "Actionability", help: "Runway to the deadline, pipeline state, load." },
];

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
 * The evidence view's component bars (plan § PR 3.2): P U D T M O K A from
 * `fit_results.components`, with the caps that held the tier. The colours
 * read against `taxonomy.tiers`' floors (`barTone`), never a number typed
 * here. Server-safe.
 */
export function ComponentBars({ fit }: { fit: SuggestionFit }) {
  return (
    <div className="rounded-card border border-line px-3.5 py-3">
      <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {BARS.map((b) => {
          const v = Math.max(0, Math.min(1, Number(fit.components?.[b.key] ?? 0)));
          const tone = barTone(b.key, v);
          return (
            <div key={b.key} className="grid grid-cols-[14px_96px_minmax(0,1fr)_40px] items-center gap-2 text-dense" title={`${b.help} ${tone.title}.`}>
              <span className="font-mono text-meta text-ink-muted">{b.key}</span>
              <span className="text-ink-body">{b.label}</span>
              <span className="block h-1.5 overflow-hidden rounded-full bg-line-row" aria-hidden>
                <span className={cn("block h-full rounded-full", tone.className)} style={{ width: `${v * 100}%` }} />
              </span>
              <span className="text-right font-mono text-meta tabular-nums text-ink">{v.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
      <p className="mb-0 mt-2 text-meta leading-normal text-ink-muted">
        S {fit.score.toFixed(1)} · tier {fit.tier}
        {fit.caps.length ? ` · caps: ${fit.caps.map((c) => c.replace(/_/g, " ")).join(", ")}` : " · no cap"}
        {fit.judged ? ` · ${fit.judged.label}` : ""}. Components are the explanation: a tier is the floors these clear, S only orders within a tier. Teal clears the Moderate floor, amber the Exploratory floor, grey neither; O and A have no floor.
      </p>
    </div>
  );
}
