/**
 * Fit engine · PR 2.4 · both engines over the gold set, against the labels.
 *
 *   npm run fit:metrics                                 # the gold set; writes docs/fit-engine/METRICS.md
 *   npm run fit:metrics -- --json                       # also prints the report as JSON
 *   npm run fit:metrics -- --all-labels                 # every fit_labels pair with a tier (gold, override, dismissal), the gold set included
 *   npm run fit:metrics -- --labels-csv labels.csv      # labels for SYNTHETIC pairs without a fit_labels row, from a labeled CSV (the alternative while the synthetic migration is not applied)
 *   npm run fit:metrics -- --out /tmp/METRICS.md [--labeler-a <email|uuid>] [--labeler-b …] [--adjudicator …]
 *
 * Read-only. Loads the open corpus through the service's own loader, the
 * investigator page's candidate set (every open embedded notice), each
 * investigator's evidence exactly as the sweep does (`loadInvestigator`:
 * rules + the item cache, never the model; stored vectors), scores every
 * pair with fit-v1 (`scorePair` with `buildScoreContext`) and with the
 * legacy rule over the same Float64 vectors the export used — the page's
 * window per investigator (top 20 by cosine over the candidate set, the
 * first 5 over the floor shown; goldset/legacy.ts) — scores the synthetic
 * pairs with fit-v1 from the fixture's profile and context merged with the
 * real notice's runway and completeness (never with legacy: no vector),
 * joins the adjudicated label (derived: the adjudicator's row, else A = B —
 * from `fit_labels` for real and synthetic pairs alike, a synthetic row
 * keyed by its `synthetic_source`; `--labels-csv` fills in synthetic pairs
 * without a row),
 * computes tier precision (overall, per stratum, per draw source), the
 * wrong-type rate (structural and labeled), precision@5 per investigator
 * and precision@10 per notice, the family confusion matrices, the recall
 * check and the Strong-list ratio (the manifest's grid tallies as the
 * primary reading), and writes METRICS.md. Runs cleanly with zero labels:
 * the label sections say so and the engine-vs-engine tier distribution
 * stands as the pre-label baseline.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { ENGINE_VERSION, scorePair } from "../src/lib/fit/engine";
import { forbiddenCellPairs } from "../src/lib/fit/engine/fixtures";
import { LABEL_SLOTS, parseCsv } from "../src/lib/fit/goldset/csv";
import { forbiddenCellKeys, investigatorFamily, noticeFamily } from "../src/lib/fit/goldset/families";
import { adjudicate, assignSlots, FIT_LABELS_SYNTHETIC_MIGRATION, latestByLabeler, rowPairKey, slotLabelsFor, type GoldLabelRow, type Slot } from "../src/lib/fit/goldset/labels";
import { legacyRanks, legacyScorePair } from "../src/lib/fit/goldset/legacy";
import { loadEvidenceVectors, loadGoldLabels, loadLabelerIdentities, loadLegacyCandidates } from "../src/lib/fit/goldset/load";
import { GOLDSET_MANIFEST, LABELER_CONFIG } from "../src/lib/fit/goldset/manifest";
import { computeMetrics, renderMetricsMarkdown, type MetricPair } from "../src/lib/fit/goldset/metrics";
import { parseGoldLabel } from "../src/lib/fit/goldset/reasons";
import { isSyntheticId, pairKey, type Stratum } from "../src/lib/fit/goldset/stratify";
import { syntheticInvestigators, syntheticScoreContext } from "../src/lib/fit/goldset/synthetic";
import { buildScoreContext, supabaseFitStore } from "../src/lib/fit/service";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import type { Tier } from "../src/lib/fit/types";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []))[0];
const ALL_LABELS = flag("--all-labels");
const JSON_OUT = flag("--json");
const OUT = opt("--out") ?? "docs/fit-engine/METRICS.md";
const LABELS_CSV = opt("--labels-csv");
const LABELERS = { a: opt("--labeler-a") ?? LABELER_CONFIG.a, b: opt("--labeler-b") ?? LABELER_CONFIG.b, adjudicator: opt("--adjudicator") ?? LABELER_CONFIG.adjudicator };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
const log = (line: string) => console.error(line);

type SetPair = { id: string; investigator_id: string; opportunity_id: string; stratum: Stratum | "extra"; synthetic: boolean; source: string };

/** The synthetic pairs' labels from a labeled CSV, adjudicated the same way (the adjudicator's column, else A = B). */
function syntheticLabelsFromCsv(file: string): Map<string, MetricPair["label"]> {
  const parsed = parseCsv(readFileSync(file, "utf8"));
  const out = new Map<string, MetricPair["label"]>();
  for (const row of parsed.rows) {
    if (!isSyntheticId(row.investigator_id)) continue;
    const labels: Record<Slot, { tier: Tier; reason: string | null; axis_reason: string | null } | null> = { a: null, b: null, adjudicator: null };
    for (const k of LABEL_SLOTS) {
      const tier = row[`tier_${k}`];
      if (!tier) continue;
      const p = parseGoldLabel({ tier, reason: row[`reason_${k}`], axis_reason: row[`axis_reason_${k}`] });
      if (!p.ok) {
        log(`labels-csv: ${row.pair_id} ${k}: ${p.error} — ignored`);
        continue;
      }
      labels[k === "adj" ? "adjudicator" : k] = p.value;
    }
    const adj = adjudicate(labels);
    out.set(pairKey(row.investigator_id, row.opportunity_id), { tier: adj.tier, status: adj.status, reason: adj.reason, axis_reason: adj.axis_reason });
  }
  return out;
}

async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const notes: string[] = [];
  log(`fit:metrics — ${ALL_LABELS ? "all labels" : `gold set ${GOLDSET_MANIFEST.version} (seed ${GOLDSET_MANIFEST.seed})`} — ${nowIso}`);

  // 1 · the pairs and their labels.
  const gold = await loadGoldLabels(supabase);
  if (!gold.available) notes.push("`fit_labels` is not on the database (apply supabase/migrations/20260916100000_fit_labels.sql); no labels were read.");
  if (gold.error) throw new Error(gold.error);
  if (gold.available && !gold.synthetic_available) notes.push(`\`fit_labels.synthetic_source\` is not on the database (apply ${FIT_LABELS_SYNTHETIC_MIGRATION}); a synthetic pair's label can only come from \`--labels-csv\` until then.`);
  const other = ALL_LABELS ? await loadGoldLabels(supabase, { sources: ["override", "dismissal"], withTier: true }) : { rows: [] as GoldLabelRow[], available: true, error: null };
  if (other.error) throw new Error(other.error);
  const identities = await loadLabelerIdentities(supabase, [...gold.rows.map((r) => r.labeler), LABELERS.a, LABELERS.b, LABELERS.adjudicator]);
  const assignment = assignSlots({ a: LABELERS.a, b: LABELERS.b, adjudicator: LABELERS.adjudicator }, identities, gold.rows);
  const latest = latestByLabeler(gold.rows);
  const otherLatest = new Map<string, GoldLabelRow>();
  for (const r of other.rows) {
    const k = rowPairKey(r);
    if (k && r.tier) otherLatest.set(k, r);
  }
  const csvLabels = LABELS_CSV ? syntheticLabelsFromCsv(LABELS_CSV) : new Map<string, MetricPair["label"]>();
  log(`labels: ${gold.rows.length} gold rows over ${latest.size} pairs; slots a ${assignment.slots.a ?? "—"}, b ${assignment.slots.b ?? "—"}, adjudicator ${assignment.slots.adjudicator ?? "—"} (${assignment.mode})${ALL_LABELS ? `; ${other.rows.length} override / dismissal rows` : ""}${LABELS_CSV ? `; ${csvLabels.size} synthetic pair(s) labeled in ${LABELS_CSV}` : ""}`);
  if (LABELS_CSV) notes.push(`Synthetic pairs' labels read from \`${LABELS_CSV}\` (${Array.from(csvLabels.values()).filter((l) => l.tier).length} adjudicated) for the synthetic pairs without a \`fit_labels\` row.`);

  const set: SetPair[] = GOLDSET_MANIFEST.pairs.map((p) => ({ id: p.id, investigator_id: p.investigator_id, opportunity_id: p.opportunity_id, stratum: p.stratum, synthetic: p.synthetic, source: p.at_export.source }));
  if (ALL_LABELS) {
    const known = new Set(set.map((p) => pairKey(p.investigator_id, p.opportunity_id)));
    const extras = new Set<string>([...latest.keys(), ...otherLatest.keys()]);
    let n = 0;
    for (const k of Array.from(extras).sort()) {
      if (known.has(k)) continue;
      const [inv, opp] = k.split("|");
      n += 1;
      set.push({ id: `x${String(n).padStart(3, "0")}`, investigator_id: inv!, opportunity_id: opp!, stratum: "extra", synthetic: isSyntheticId(inv!), source: "extra" });
    }
    notes.push(`Run with --all-labels: ${n} labeled pair(s) outside the gold set are included as stratum "extra".`);
  }

  const labelFor = (inv: string, opp: string): MetricPair["label"] => {
    const k = pairKey(inv, opp);
    const byLabeler = latest.get(k);
    if (byLabeler) {
      const adj = adjudicate(slotLabelsFor(byLabeler, assignment.slots as Record<Slot, string | null>));
      if (adj.tier || !otherLatest.has(k)) return { tier: adj.tier, status: adj.status, reason: adj.reason, axis_reason: adj.axis_reason };
    }
    // A synthetic pair without a fit_labels row: the CSV's labels, when given.
    if (isSyntheticId(inv) && !byLabeler) {
      const c = csvLabels.get(k);
      if (c) return c;
    }
    const o = otherLatest.get(k);
    if (o?.tier) return { tier: o.tier as Tier, status: "adjudicated", reason: o.reason, axis_reason: o.axis_reason };
    return { tier: null, status: "unlabeled", reason: null, axis_reason: null };
  };

  // 2 · the corpus, the candidate set and the engines.
  const store = supabaseFitStore(supabase, { log });
  const corpus = await store.loadCorpus(now);
  const noticeById = new Map(corpus.notices.map((n) => [n.profile.opportunity_id, n]));
  const candidates = await loadLegacyCandidates(supabase, corpus.today);
  const candidateList = Array.from(candidates, ([id, vector]) => ({ id, vector }));
  log(`corpus: ${corpus.notices.length} open notices with a fit profile (${corpus.with_vector} embedded), IDF ${corpus.idf.rows.length} codes; legacy candidates ${candidates.size} open embedded notices`);
  const investigatorIds = Array.from(new Set(set.filter((p) => !p.synthetic).map((p) => p.investigator_id))).sort();
  const evidence = await loadEvidenceVectors(supabase, investigatorIds);
  const synthetic = new Map(syntheticInvestigators().map((s) => [s.id, s]));
  log(`evidence vectors for ${evidence.size} of ${investigatorIds.length} investigators; scoring ${set.length} pairs (${set.filter((p) => p.synthetic).length} synthetic)…`);

  const forbidden = forbiddenCellKeys(forbiddenCellPairs());
  const scored: MetricPair[] = [];
  let unscoredInv = 0;
  let unscoredNotice = 0;
  const bySetInvestigator = new Map<string, SetPair[]>();
  for (const p of set) (bySetInvestigator.get(p.investigator_id) ?? bySetInvestigator.set(p.investigator_id, []).get(p.investigator_id)!).push(p);
  let done = 0;
  for (const invId of investigatorIds) {
    const inv = await store.loadInvestigator(invId);
    const items = evidence.get(invId) ?? [];
    const ranks = legacyRanks(inv?.docVector ?? null, candidateList);
    for (const p of bySetInvestigator.get(invId) ?? []) {
      const notice = noticeById.get(p.opportunity_id) ?? null;
      if (!inv) unscoredInv += 1;
      if (!notice) unscoredNotice += 1;
      const fit = inv && notice ? scorePair(inv.profile, notice.profile, buildScoreContext(inv, notice, corpus, nowIso)) : null;
      const legacy = legacyScorePair(inv?.docVector ?? null, candidates.get(p.opportunity_id) ?? null, items, ranks.get(p.opportunity_id) ?? null);
      const invFam = inv ? investigatorFamily(inv.profile).family : "none";
      const notFam = notice ? noticeFamily(notice.profile).family : "none";
      scored.push({
        id: p.id,
        investigator_id: p.investigator_id,
        opportunity_id: p.opportunity_id,
        stratum: p.stratum,
        forbidden: forbidden.has(`${invFam}->${notFam}`),
        synthetic: false,
        source: p.source,
        investigator_family: invFam,
        notice_family: notFam,
        clinical_trial: notice?.profile.mechanism.clinical_trial ?? "unknown",
        fit_v1: fit ? { tier: fit.tier, score: fit.score, caps: [...fit.caps] } : null,
        legacy: { tier: legacy.tier, similarity: legacy.similarity, rank: legacy.rank },
        label: labelFor(p.investigator_id, p.opportunity_id),
      });
    }
    done += 1;
    if (done % 10 === 0) log(`  ${done} / ${investigatorIds.length} investigators`);
  }
  // Synthetic pairs: the fixture's profile and context, the real notice's runway and completeness; no vector, so no legacy score.
  let unscoredSynthetic = 0;
  for (const p of set.filter((x) => x.synthetic)) {
    const s = synthetic.get(p.investigator_id);
    const notice = noticeById.get(p.opportunity_id) ?? null;
    if (!s || !notice) unscoredSynthetic += 1;
    const fit = s && notice ? scorePair(s.profile, notice.profile, syntheticScoreContext(s.ctx, notice, nowIso)) : null;
    const invFam = s ? s.family : "none";
    const notFam = notice ? noticeFamily(notice.profile).family : "none";
    scored.push({
      id: p.id,
      investigator_id: p.investigator_id,
      opportunity_id: p.opportunity_id,
      stratum: p.stratum,
      forbidden: forbidden.has(`${invFam}->${notFam}`),
      synthetic: true,
      source: p.source,
      investigator_family: invFam,
      notice_family: notFam,
      clinical_trial: notice?.profile.mechanism.clinical_trial ?? "unknown",
      fit_v1: fit ? { tier: fit.tier, score: fit.score, caps: [...fit.caps] } : null,
      legacy: { tier: "dropped", similarity: null, rank: null },
      label: labelFor(p.investigator_id, p.opportunity_id),
    });
  }
  scored.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (unscoredInv) notes.push(`${unscoredInv} pair(s) could not be scored by fit-v1: the investigator has no stored profile any more.`);
  if (unscoredNotice) notes.push(`${unscoredNotice} pair(s) could not be scored by fit-v1: the notice is no longer in the open profiled corpus.`);
  if (unscoredSynthetic) notes.push(`${unscoredSynthetic} synthetic pair(s) could not be scored: the fixture case or the notice is gone.`);
  notes.push(`Legacy tiers follow the investigator page's rule over stored vectors (goldset/legacy.ts): the top ${GOLDSET_MANIFEST.legacy.top_hits} of ${candidates.size} open embedded notices by cosine, the first ${GOLDSET_MANIFEST.legacy.shown_top_n} over the floor shown; a pair behind them is "not shown" and counts as Poor. The Outreach snapshots recorded at export are in the manifest's \`at_export\`.`);

  // 3 · the report.
  const report = computeMetrics(scored, {
    forbidden,
    generated_at: nowIso,
    goldset_version: GOLDSET_MANIFEST.version,
    seed: ALL_LABELS ? null : GOLDSET_MANIFEST.seed,
    taxonomy_version: TAXONOMY_VERSION,
    engine_version: ENGINE_VERSION,
    source: ALL_LABELS ? "all_labels" : "goldset",
    grid: { legacy: GOLDSET_MANIFEST.legacy_grid, fit_results: GOLDSET_MANIFEST.fit_results_grid },
    notes,
  });
  writeFileSync(OUT, renderMetricsMarkdown(report));
  const d = report.distribution;
  console.log(`# fit:metrics — ${nowIso} — ${report.pairs} pairs (${report.synthetic} synthetic), ${report.labels.labeled} labeled — wrote ${OUT}`);
  console.log(`fit-v1: strong ${d.fit_v1.strong} / moderate ${d.fit_v1.moderate} / exploratory ${d.fit_v1.exploratory} / poor ${d.fit_v1.poor} / unscored ${d.fit_v1.unscored}; synthetic: strong ${d.synthetic.strong} / moderate ${d.synthetic.moderate} / exploratory ${d.synthetic.exploratory} / poor ${d.synthetic.poor}`);
  console.log(`legacy: strong ${d.legacy_raw.strong} / potential ${d.legacy_raw.potential} / exploratory ${d.legacy_raw.exploratory} / not_shown ${d.legacy_raw.not_shown} / dropped ${d.legacy_raw.dropped}`);
  const g = report.strong_ratio_grid;
  console.log(`strong-list ratio — grid ${g ? `${g.ratio === null ? "—" : g.ratio.toFixed(2)} (${g.fit_v1_strong} / ${g.legacy_strong})` : "n/a"}; set ${report.strong_ratio.ratio === null ? "—" : report.strong_ratio.ratio.toFixed(2)} (${report.strong_ratio.fit_v1_strong} / ${report.strong_ratio.legacy_strong}); structural wrong-type: fit-v1 ${report.wrong_type.structural.fit_v1.wrong} of ${report.wrong_type.structural.fit_v1.shown}, legacy ${report.wrong_type.structural.legacy.wrong} of ${report.wrong_type.structural.legacy.shown}`);
  console.log(`forbidden-cell mass shown: fit-v1 ${report.confusion.recommended.fit_v1.forbidden_mass}, legacy ${report.confusion.recommended.legacy.forbidden_mass}; dropped stratum surfaced: fit-v1 ${report.recall.fit_v1.dropped.surfaced}, legacy ${report.recall.legacy.dropped.surfaced}`);
  if (JSON_OUT) console.log(JSON.stringify({ report, pairs: scored }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
