/**
 * Pure aggregations and formatting behind scripts/fit-profile-report.ts
 * (plan § PR 1.4 acceptance: dominant paradigm, top designs and evidence
 * counts per investigator for the spot check, plus a roster summary). Works
 * from a stored `InvestigatorFitProfile` alone (`--report`) or from a build
 * with diagnostics (`--dry-run`), which knows exactly which categories the
 * thin-evidence cap touched.
 */
import { AXES, type Axis } from "@/lib/fit/classify/contracts";
import { CONFIDENCE_ORDER, dominantParadigm, type AggregateDiagnostics, type DominantParadigm } from "@/lib/fit/profile/aggregate";
import { familyOf, thinEvidence } from "@/lib/fit/taxonomy";
import type { AxisConfidence, Confidence, InvestigatorFitProfile, ParadigmFamily } from "@/lib/fit/types";

export type TopEntry = { id: string; weight: number };

export type ProfileReportLine = {
  investigator_id: string;
  name: string | null;
  item_count: number;
  dominant_career: DominantParadigm | null;
  dominant_recent: DominantParadigm | null;
  /** Paradigm categories in the career view, heaviest first. */
  top_paradigms: TopEntry[];
  top_designs: TopEntry[];
  evidence: { publications_verified: number; grants: number; trials: number; trials_as_pi: number; biosketch: string; self_declared: boolean };
  confidence: AxisConfidence;
  /**
   * The dominant career paradigm sits under the thin-evidence cap. Exact from
   * diagnostics; from a stored profile alone it is approximated as fewer than
   * `thin_evidence.min_items` provenance ids behind the category.
   */
  thin: boolean;
  thin_exact: boolean;
  /** Present for builds: the classifier's work behind the profile. */
  model: { needed: number; called: number; skipped: number; cache_hits: number } | null;
  incomplete: boolean;
  computed_at: string;
  aspirations: string[];
};

export type ProfileReportExtras = {
  name?: string | null;
  item_count?: number;
  diagnostics?: AggregateDiagnostics;
  model?: ProfileReportLine["model"];
  incomplete?: boolean;
};

function topOf(weights: Record<string, number | undefined>, n: number): TopEntry[] {
  return Object.entries(weights)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([id, weight]) => ({ id, weight }));
}

export const TOP_N = 3;

/** One report line from a profile (stored or just built). Pure. */
export function summarizeProfile(profile: InvestigatorFitProfile, extras: ProfileReportExtras = {}): ProfileReportLine {
  const dominant_career = dominantParadigm(profile.paradigm.career);
  const dominant_recent = dominantParadigm(profile.paradigm.recent);
  let thin = false;
  let thin_exact = false;
  if (dominant_career) {
    const detail = extras.diagnostics?.axes.paradigm.career.categories[dominant_career.category];
    if (detail) {
      thin = detail.capped;
      thin_exact = true;
    } else {
      const prov = profile.provenance.find((p) => p.axis === "paradigm" && p.category === dominant_career.category);
      thin = (prov?.top_items.length ?? 0) < thinEvidence().min_items;
    }
  }
  const e = profile.evidence_summary;
  return {
    investigator_id: profile.investigator_id,
    name: extras.name ?? null,
    item_count: extras.item_count ?? extras.diagnostics?.item_count ?? 0,
    dominant_career,
    dominant_recent,
    top_paradigms: topOf(profile.paradigm.career, TOP_N),
    top_designs: topOf(profile.design, TOP_N),
    evidence: { publications_verified: e.publications_verified, grants: e.grants, trials: e.trials, trials_as_pi: e.trials_as_pi, biosketch: e.biosketch, self_declared: e.self_declared },
    confidence: profile.confidence,
    thin,
    thin_exact,
    model: extras.model ?? null,
    incomplete: extras.incomplete ?? false,
    computed_at: profile.computed_at,
    aspirations: profile.aspirations,
  };
}

export type Distribution = Array<{ id: string; count: number; share: number }>;

export type RosterSummary = {
  investigators: number;
  items: number;
  /** Investigators with no paradigm evidence at all. */
  no_paradigm: number;
  dominant_career_categories: Distribution;
  dominant_career_families: Distribution;
  dominant_recent_categories: Distribution;
  dominant_recent_families: Distribution;
  /** Career and recent dominant family differ. */
  moved_family: number;
  thin: { count: number; share: number; exact: boolean };
  confidence: Record<Axis | "topic", Record<Confidence, number>>;
  model: { needed: number; called: number; skipped: number; cache_hits: number } | null;
  incomplete: number;
  evidence_totals: { publications_verified: number; grants: number; trials: number; trials_as_pi: number; biosketch_on_file: number; self_declared: number };
};

function distribution(ids: Array<string | null>, total: number): Distribution {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id ?? "(none)", (counts.get(id ?? "(none)") ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, count, share: total ? count / total : 0 }));
}

/** The roster summary the plan asks for: distribution of dominant paradigms, share thin-evidence, confidence per axis. Pure. */
export function summarizeRoster(lines: ProfileReportLine[]): RosterSummary {
  const n = lines.length;
  const confidence = {} as RosterSummary["confidence"];
  for (const axis of [...AXES, "topic"] as Array<Axis | "topic">) {
    const c = { low: 0, medium: 0, high: 0 } as Record<Confidence, number>;
    for (const l of lines) c[l.confidence[axis]] += 1;
    confidence[axis] = c;
  }
  const withModel = lines.filter((l) => l.model);
  const model = withModel.length
    ? withModel.reduce((s, l) => ({ needed: s.needed + l.model!.needed, called: s.called + l.model!.called, skipped: s.skipped + l.model!.skipped, cache_hits: s.cache_hits + l.model!.cache_hits }), { needed: 0, called: 0, skipped: 0, cache_hits: 0 })
    : null;
  const family = (d: DominantParadigm | null): ParadigmFamily | null => (d ? familyOf(d.category) : null);
  const thinCount = lines.filter((l) => l.thin).length;
  return {
    investigators: n,
    items: lines.reduce((s, l) => s + l.item_count, 0),
    no_paradigm: lines.filter((l) => !l.dominant_career).length,
    dominant_career_categories: distribution(lines.map((l) => l.dominant_career?.category ?? null), n),
    dominant_career_families: distribution(lines.map((l) => family(l.dominant_career)), n),
    dominant_recent_categories: distribution(lines.map((l) => l.dominant_recent?.category ?? null), n),
    dominant_recent_families: distribution(lines.map((l) => family(l.dominant_recent)), n),
    moved_family: lines.filter((l) => l.dominant_career && l.dominant_recent && family(l.dominant_career) !== family(l.dominant_recent)).length,
    thin: { count: thinCount, share: n ? thinCount / n : 0, exact: lines.every((l) => l.thin_exact || !l.dominant_career) },
    confidence,
    model,
    incomplete: lines.filter((l) => l.incomplete).length,
    evidence_totals: {
      publications_verified: lines.reduce((s, l) => s + l.evidence.publications_verified, 0),
      grants: lines.reduce((s, l) => s + l.evidence.grants, 0),
      trials: lines.reduce((s, l) => s + l.evidence.trials, 0),
      trials_as_pi: lines.reduce((s, l) => s + l.evidence.trials_as_pi, 0),
      biosketch_on_file: lines.filter((l) => l.evidence.biosketch === "on_file").length,
      self_declared: lines.filter((l) => l.evidence.self_declared).length,
    },
  };
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const show = (d: DominantParadigm | null) => (d ? `${d.category} ${d.weight.toFixed(2)}` : "—");
const showTop = (list: TopEntry[]) => (list.length ? list.map((t) => `${t.id} ${t.weight.toFixed(2)}`).join(", ") : "—");
const confShort: Record<Confidence, string> = { low: "L", medium: "M", high: "H" };

/** One line per investigator: name · items · career · recent · designs · evidence · confidence per axis. */
export function formatProfileLine(l: ProfileReportLine): string {
  const conf = ([...AXES, "topic"] as Array<Axis | "topic">).map((a) => `${a[0]!.toUpperCase()}${confShort[l.confidence[a]]}`).join(" ");
  const ev = `pubs ${l.evidence.publications_verified} · grants ${l.evidence.grants} · trials ${l.evidence.trials}${l.evidence.trials_as_pi ? ` (PI ${l.evidence.trials_as_pi})` : ""} · biosketch ${l.evidence.biosketch}${l.evidence.self_declared ? " · self-declared" : ""}`;
  const model = l.model ? ` · model needed ${l.model.needed} / called ${l.model.called} / cached ${l.model.cache_hits} / skipped ${l.model.skipped}` : "";
  return [
    `${l.name ?? l.investigator_id}${l.incomplete ? " [INCOMPLETE]" : ""}${l.thin ? " [thin]" : ""}`,
    `  items ${l.item_count} · career ${show(l.dominant_career)} · recent ${show(l.dominant_recent)}`,
    `  paradigms ${showTop(l.top_paradigms)}`,
    `  designs ${showTop(l.top_designs)}`,
    `  ${ev}`,
    `  confidence ${conf}${model}${l.aspirations.length ? ` · aspirations ${l.aspirations.join(", ")}` : ""}`,
  ].join("\n");
}

export function formatRosterSummary(s: RosterSummary): string {
  const dist = (d: Distribution, n = 12) => d.slice(0, n).map((x) => `${x.id} ${x.count} (${pct(x.share)})`).join(", ") || "—";
  const conf = ([...AXES, "topic"] as Array<Axis | "topic">).map((a) => `${a}: ${CONFIDENCE_ORDER.map((c) => `${c} ${s.confidence[a][c]}`).join(" / ")}`).join("; ");
  const lines = [
    `investigators ${s.investigators} · items ${s.items} · no paradigm evidence ${s.no_paradigm} · incomplete ${s.incomplete}`,
    `evidence: publications ${s.evidence_totals.publications_verified}, grants ${s.evidence_totals.grants}, trials ${s.evidence_totals.trials} (PI ${s.evidence_totals.trials_as_pi}), biosketch on file ${s.evidence_totals.biosketch_on_file}, self-declared ${s.evidence_totals.self_declared}`,
    `dominant paradigm (career), by family: ${dist(s.dominant_career_families)}`,
    `dominant paradigm (career), by category: ${dist(s.dominant_career_categories)}`,
    `dominant paradigm (recent), by family: ${dist(s.dominant_recent_families)}`,
    `dominant paradigm (recent), by category: ${dist(s.dominant_recent_categories)}`,
    `career and recent dominant family differ: ${s.moved_family}`,
    `thin evidence (dominant career paradigm under the cap${s.thin.exact ? "" : "; approximated from provenance"}): ${s.thin.count} (${pct(s.thin.share)})`,
    `confidence — ${conf}`,
  ];
  if (s.model) lines.push(`classifier: model needed ${s.model.needed}, called ${s.model.called}, cache hits ${s.model.cache_hits}, skipped ${s.model.skipped}`);
  return lines.join("\n");
}

export function formatProfileReport(lines: ProfileReportLine[], summary: RosterSummary = summarizeRoster(lines)): string {
  return [...lines.map(formatProfileLine), "", "## Roster summary", formatRosterSummary(summary)].join("\n");
}
