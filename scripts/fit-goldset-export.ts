/**
 * Fit engine · PR 2.4 · the stratified gold set (spec §14).
 *
 *   npm run fit:goldset-export -- --seed 1                       # writes docs/fit-engine/goldset/goldset-v1.csv + goldset-v1.manifest.json
 *   npm run fit:goldset-export -- --seed 1 --out /tmp/goldset    # elsewhere (the page imports the docs copy at build time)
 *   npm run fit:goldset-export -- --seed 1 --force               # redraw an existing version (refused while fit_labels holds gold rows)
 *   npm run fit:goldset-export -- --seed 2 --version v2          # a new version beside the old one
 *
 * Read-only against the database: loads the open notice corpus (the
 * service's own loader — profiles, facts, vectors), the investigator page's
 * candidate set (every open notice with an embedding — wider than the
 * profiled corpus), the roster's stored profiles, the stored document /
 * evidence vectors (Float64, the same cosine the metrics compute), every
 * `fit_results` tier and the legacy `outreach_suggestions` snapshots,
 * reproduces the page's window per investigator (top 20 by cosine over the
 * candidate set, the first 5 over the floor shown — goldset/legacy.ts),
 * scores every roster × corpus pair under that rule in memory, draws the
 * 200 pairs deterministically from `--seed` (goldset/stratify.ts) plus the
 * synthetic pairs for the cells the roster cannot fill (goldset/synthetic.ts)
 * and the supplementary fit-v1 stratum, resolves the summaries a labeler
 * needs (names, dominant paradigm, top evidence titles, notice title,
 * designation, Part 1 Purpose excerpt) and writes the CSV with EMPTY label
 * columns beside the manifest (the versioned set: pairs, strata, cells,
 * seed, engine and taxonomy versions, the grid tallies behind the 30 %
 * rule). The versioned set is FROZEN: an existing manifest is never
 * overwritten without `--force`, and never while `fit_labels` holds gold
 * rows — a new draw is a new `--version`. Never writes to the database,
 * never calls a model or an embedding endpoint.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { ENGINE_VERSION } from "../src/lib/fit/engine";
import { forbiddenCellPairs } from "../src/lib/fit/engine/fixtures";
import { csvRowFor, serializeCsv } from "../src/lib/fit/goldset/csv";
import { designationLabel, purposeExcerpt } from "../src/lib/fit/goldset/excerpt";
import { investigatorFamily, noticeFamily } from "../src/lib/fit/goldset/families";
import { LEGACY_EVIDENCE_ITEMS, LEGACY_SHOWN_TOP_N, LEGACY_TOP_HITS, LEGACY_TIERS, legacyRanks, legacyScorePair, type LegacyTier } from "../src/lib/fit/goldset/legacy";
import { loadEvidenceTitles, loadEvidenceVectors, loadGoldLabels, loadGoldsetRoster, loadInvestigatorVectors, loadLegacyCandidates, loadNoticeExtras, loadOutreachSnapshots, loadStoredFitTiers } from "../src/lib/fit/goldset/load";
import { diffManifestPairs, type FitResultsGridTally, type GoldsetManifest, type LegacyGridTally, type ManifestInvestigator, type ManifestPair } from "../src/lib/fit/goldset/manifest";
import { GOLDSET_QUOTAS, pairKey, STRATA, stratifyGoldset, type PairSignals, type StratifyInvestigator, type StratifyNotice } from "../src/lib/fit/goldset/stratify";
import { syntheticInvestigators, syntheticStratifyInvestigators } from "../src/lib/fit/goldset/synthetic";
import { supabaseFitStore } from "../src/lib/fit/service";
import { categoryLabel, TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import type { Confidence, Tier } from "../src/lib/fit/types";
import { SIM } from "../src/lib/outreach/suggest";
import type { SuggestionTier } from "../src/lib/outreach/types";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []))[0];
const SEED = Number(opt("--seed") ?? 1);
const VERSION = opt("--version") ?? "v1";
const OUT = opt("--out") ?? "docs/fit-engine/goldset";
const FORCE = flag("--force");
if (!Number.isInteger(SEED) || SEED < 0) {
  console.error("usage: fit:goldset-export -- [--seed N] [--version v1] [--out docs/fit-engine/goldset] [--force]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
const log = (line: string) => console.error(line);

const emptyLegacyTally = () => Object.fromEntries(LEGACY_TIERS.map((t) => [t, 0])) as Record<LegacyTier, number>;

async function main(): Promise<void> {
  const now = new Date();
  const manifestPath = path.join(OUT, `goldset-${VERSION}.manifest.json`);
  const csvPath = path.join(OUT, `goldset-${VERSION}.csv`);
  log(`fit:goldset-export — ${VERSION} — seed ${SEED} — ${now.toISOString()}`);

  // The versioned set is frozen (goldset/manifest.ts).
  const existing: GoldsetManifest | null = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as GoldsetManifest) : null;
  if (existing && !FORCE) {
    console.error(`${manifestPath} exists (${existing.pairs.length} pairs, seed ${existing.seed}, generated ${existing.generated_at}) — the versioned set is frozen. Pass --force to redraw it (only while fit_labels holds no gold rows), or --version <new> for a new set.`);
    process.exit(2);
  }
  if (existing) {
    const gold = await loadGoldLabels(supabase);
    if (gold.error) throw new Error(gold.error);
    if (gold.rows.length) {
      console.error(`fit_labels holds ${gold.rows.length} gold row(s) labeled against ${VERSION}; redrawing it would orphan them. Export a new --version instead.`);
      process.exit(2);
    }
    log(`--force: ${manifestPath} will be replaced (fit_labels holds no gold rows)`);
  }

  const store = supabaseFitStore(supabase, { log });
  const corpus = await store.loadCorpus(now);
  log(`corpus: ${corpus.notices.length} open notices with a fit profile (${corpus.with_vector} embedded)`);
  const roster = await loadGoldsetRoster(supabase);
  log(`roster: ${roster.length} investigators with a stored profile`);
  const [docVectors, evidence, fitTiers, snapshots, extras, candidates] = await Promise.all([
    loadInvestigatorVectors(supabase, roster.map((r) => r.investigator_id)),
    loadEvidenceVectors(supabase),
    loadStoredFitTiers(supabase),
    loadOutreachSnapshots(supabase),
    loadNoticeExtras(supabase, corpus.notices.map((n) => n.profile.opportunity_id)),
    loadLegacyCandidates(supabase, corpus.today),
  ]);
  const evidenceVectors = Array.from(evidence.values()).reduce((s, l) => s + l.length, 0);
  log(`vectors: ${docVectors.size} document, ${evidenceVectors} evidence over ${evidence.size} investigators; legacy candidates ${candidates.size} open embedded notices; fit_results ${fitTiers.available ? `${fitTiers.rows.length} rows` : "not on the database"}; outreach snapshots ${snapshots.length}`);

  const noticeById = new Map(corpus.notices.map((n) => [n.profile.opportunity_id, n]));
  const rosterById = new Map(roster.map((r) => [r.investigator_id, r]));
  const candidateList = Array.from(candidates, ([id, vector]) => ({ id, vector }));

  // The page's window per investigator, and the legacy tally over roster × candidates (the 30 % rule's legacy side).
  const windows = new Map<string, Map<string, number>>();
  const legacyGrid: LegacyGridTally = { investigators: docVectors.size, candidates: candidates.size, pairs: roster.length * candidates.size, ...emptyLegacyTally(), shown_outside_corpus: 0 };
  for (const r of roster) {
    const doc = docVectors.get(r.investigator_id) ?? null;
    const ranks = legacyRanks(doc, candidateList);
    windows.set(r.investigator_id, ranks);
    for (const [id, rank] of ranks) {
      const s = legacyScorePair(doc, candidates.get(id) ?? null, evidence.get(r.investigator_id) ?? [], rank);
      legacyGrid[s.tier] += 1;
      if (s.tier !== "dropped" && s.tier !== "not_shown" && !noticeById.has(id)) legacyGrid.shown_outside_corpus += 1;
    }
  }
  legacyGrid.dropped = legacyGrid.pairs - legacyGrid.strong - legacyGrid.potential - legacyGrid.exploratory - legacyGrid.not_shown;
  log(`legacy page rule over roster × candidates (${legacyGrid.pairs} pairs): strong ${legacyGrid.strong}, potential ${legacyGrid.potential}, exploratory ${legacyGrid.exploratory}, not_shown ${legacyGrid.not_shown}, dropped ${legacyGrid.dropped}; shown outside the profiled corpus ${legacyGrid.shown_outside_corpus}`);

  // Stored fit_results over roster × corpus (the 30 % rule's fit-v1 side).
  const fitTier = new Map<string, Tier>();
  const fitGrid: FitResultsGridTally = { investigators: roster.length, notices: corpus.notices.length, pairs: roster.length * corpus.notices.length, strong: 0, moderate: 0, exploratory: 0, poor: 0, none: 0 };
  for (const row of fitTiers.rows) {
    if (!rosterById.has(row.investigator_id) || !noticeById.has(row.opportunity_id)) continue;
    fitTier.set(pairKey(row.investigator_id, row.opportunity_id), row.tier);
    fitGrid[row.tier] += 1;
  }
  fitGrid.none = fitGrid.pairs - fitGrid.strong - fitGrid.moderate - fitGrid.exploratory - fitGrid.poor;
  log(`fit_results over roster × corpus (${fitGrid.pairs} pairs): strong ${fitGrid.strong}, moderate ${fitGrid.moderate}, exploratory ${fitGrid.exploratory}, poor ${fitGrid.poor}, no row ${fitGrid.none}`);

  const snapshot = new Map<string, SuggestionTier>();
  for (const s of snapshots) {
    const k = pairKey(s.investigator_id, s.opportunity_id);
    if (!snapshot.has(k) && noticeById.has(s.opportunity_id)) snapshot.set(k, s.tier as SuggestionTier);
  }
  const investigators: StratifyInvestigator[] = roster.map((r) => ({
    id: r.investigator_id,
    family: investigatorFamily(r.profile).family,
    item_count: r.item_count,
    paradigm_confidence: (r.confidence?.paradigm ?? r.profile.confidence?.paradigm ?? "low") as Confidence,
    pending_items: r.pending_items,
  }));
  const notices: StratifyNotice[] = corpus.notices.map((n) => ({ id: n.profile.opportunity_id, family: noticeFamily(n.profile).family }));
  const synthetic = syntheticInvestigators();

  const memo = new Map<string, PairSignals>();
  const signals = (inv: string, opp: string): PairSignals => {
    const k = pairKey(inv, opp);
    const hit = memo.get(k);
    if (hit) return hit;
    const rank = windows.get(inv)?.get(opp) ?? null;
    const legacy = legacyScorePair(docVectors.get(inv) ?? null, candidates.get(opp) ?? null, evidence.get(inv) ?? [], rank);
    const s: PairSignals = { legacy: legacy.tier, legacy_similarity: legacy.similarity === null ? null : Number(legacy.similarity.toFixed(4)), legacy_rank: legacy.rank, fit_v1: fitTier.get(k) ?? null, outreach: snapshot.get(k) ?? null };
    memo.set(k, s);
    return s;
  };

  const result = stratifyGoldset({ investigators, notices, signals, synthetic: syntheticStratifyInvestigators(synthetic) }, { seed: SEED, forbidden: forbiddenCellPairs() });
  const gridTally = emptyLegacyTally();
  for (const s of memo.values()) gridTally[s.legacy] += 1;
  log(`legacy rule over roster × corpus (${memo.size} pairs): ${LEGACY_TIERS.map((t) => `${t} ${gridTally[t]}`).join(", ")}`);

  // Display data.
  const wanted = new Map<string, string[]>();
  for (const p of result.pairs) {
    if (p.synthetic || wanted.has(p.investigator_id)) continue;
    const r = rosterById.get(p.investigator_id)!;
    const fam = investigatorFamily(r.profile);
    const prov = r.profile.provenance ?? [];
    const own = prov.find((x) => x.axis === "paradigm" && x.category === fam.category)?.top_items ?? prov.find((x) => x.axis === "paradigm")?.top_items ?? [];
    wanted.set(p.investigator_id, own.slice(0, 3));
  }
  const titles = await loadEvidenceTitles(supabase, Array.from(wanted.entries()).map(([investigator_id, ids]) => ({ investigator_id, ids })));
  const syntheticById = new Map(synthetic.map((s) => [s.id, s]));

  const investigatorBlock = (investigatorId: string): ManifestInvestigator => {
    const s = syntheticById.get(investigatorId);
    if (s) {
      const fam = investigatorFamily(s.profile);
      return {
        name: `${s.name} (synthetic)`,
        dominant: { category: fam.category, label: fam.category ? categoryLabel(fam.category) : "no paradigm evidence", family: fam.family, weight: Number(fam.weight.toFixed(3)), view: fam.view },
        evidence: s.narrative,
        item_count: 0,
        pending_items: 0,
        paradigm_confidence: s.profile.confidence.paradigm,
        evidence_vectors: 0,
      };
    }
    const r = rosterById.get(investigatorId)!;
    const fam = investigatorFamily(r.profile);
    return {
      name: r.name,
      dominant: { category: fam.category, label: fam.category ? categoryLabel(fam.category) : "no paradigm evidence", family: fam.family, weight: Number(fam.weight.toFixed(3)), view: fam.view },
      evidence: titles.get(investigatorId) ?? [],
      item_count: r.item_count,
      pending_items: r.pending_items,
      paradigm_confidence: (r.confidence?.paradigm ?? r.profile.confidence?.paradigm ?? "low") as Confidence,
      evidence_vectors: evidence.get(investigatorId)?.length ?? 0,
    };
  };

  const pairs: ManifestPair[] = result.pairs.map((p, i) => {
    const n = noticeById.get(p.opportunity_id)!;
    const nf = noticeFamily(n.profile);
    const x = extras.get(p.opportunity_id);
    const excerpt = purposeExcerpt(x?.guide_sections, x?.description);
    return {
      id: `g${String(i + 1).padStart(3, "0")}`,
      investigator_id: p.investigator_id,
      opportunity_id: p.opportunity_id,
      stratum: p.stratum,
      cell: p.cell,
      forbidden: p.forbidden,
      synthetic: p.synthetic,
      synthetic_source: p.synthetic_source,
      sources: p.sources,
      at_export: { fit_v1_tier: p.signals.fit_v1, legacy_tier: p.signals.legacy, legacy_rank: p.signals.legacy_rank, legacy_similarity: p.signals.legacy_similarity, outreach_tier: p.signals.outreach, source: p.source },
      investigator: investigatorBlock(p.investigator_id),
      notice: {
        number: n.profile.number || n.facts.opportunity_number || p.opportunity_id,
        title: n.facts.title ?? "",
        designation: designationLabel(x?.clinical_trial_designation ?? (n.profile.mechanism.clinical_trial === "unknown" ? null : n.profile.mechanism.clinical_trial)),
        activity_code: n.facts.activity_code ?? n.profile.mechanism.activity_code,
        family: nf.family,
        family_from: nf.from,
        excerpt: excerpt.text,
        excerpt_source: excerpt.source,
      },
    };
  });

  const manifest: GoldsetManifest = {
    version: VERSION,
    seed: SEED,
    generated_at: now.toISOString(),
    taxonomy_version: TAXONOMY_VERSION,
    engine_version: ENGINE_VERSION,
    legacy: { sim: { ...SIM }, top_hits: LEGACY_TOP_HITS, shown_top_n: LEGACY_SHOWN_TOP_N, evidence_items: LEGACY_EVIDENCE_ITEMS },
    quotas: GOLDSET_QUOTAS,
    counts: result.counts,
    corpus: { investigators: roster.length, notices: corpus.notices.length, investigators_with_vector: docVectors.size, notices_with_vector: corpus.with_vector, legacy_candidates: candidates.size, evidence_vectors: evidenceVectors, fit_results_available: fitTiers.available, outreach_snapshots: snapshot.size },
    legacy_grid: legacyGrid,
    fit_results_grid: fitGrid,
    current_mix: result.current,
    fit_v1_mix: result.fit_v1,
    cells: {
      covered: result.cells.covered.map((c) => ({ key: c.key, forbidden: c.forbidden, synthetic: c.synthetic, candidates: c.candidates, pairs: c.pairs })),
      uncovered: result.cells.uncovered.map((c) => ({ key: c.key, forbidden: c.forbidden, reason: c.reason })),
      forbidden_total: result.cells.forbidden_total,
      forbidden_covered: result.cells.forbidden_covered,
      synthetic: result.cells.synthetic,
    },
    synthetic_investigators: synthetic.map((s) => ({ id: s.id, source: s.source, name: s.name, family: s.family, pairs: pairs.filter((p) => p.investigator_id === s.id).length })),
    dropped_investigators: result.dropped.investigators.map((d) => ({ ...d, name: rosterById.get(d.id)?.name ?? d.id })),
    shortfalls: result.shortfalls,
    pairs,
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(csvPath, serializeCsv(pairs.map((p) => csvRowFor(p))));

  // Report.
  console.log(`# fit:goldset-export — ${VERSION} — seed ${SEED} — ${now.toISOString()} — taxonomy ${TAXONOMY_VERSION}, engine ${ENGINE_VERSION}`);
  console.log(`wrote ${manifestPath} and ${csvPath} (${pairs.length} pairs: ${pairs.filter((p) => !p.synthetic).length} real, ${pairs.filter((p) => p.synthetic).length} synthetic)`);
  if (existing) {
    const diff = diffManifestPairs(existing, manifest);
    console.log(`\n--force against the previous ${VERSION} (${existing.pairs.length} pairs, seed ${existing.seed}): ${diff.kept} kept, ${diff.added.length} added, ${diff.removed.length} removed`);
    for (const p of diff.removed) console.log(`  - ${p.id} ${p.stratum.padEnd(11)} ${p.investigator.name} × ${p.notice.number}`);
    for (const p of diff.added) console.log(`  + ${p.id} ${p.stratum.padEnd(11)} ${p.investigator.name} × ${p.notice.number}`);
  }
  console.log(`\nstrata: ${STRATA.map((s) => `${s} ${result.counts[s]}${s === "fit_v1" ? " (supplementary, no quota)" : ` / ${GOLDSET_QUOTAS[s]}`}`).join(" · ")}`);
  console.log(`\ncurrent mix — pool: ${Object.entries(result.current.pool).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`current mix — drawn: ${Object.entries(result.current.drawn).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`fit-v1 supplementary — pool: ${Object.entries(result.fit_v1.pool).map(([k, v]) => `${k} ${v}`).join(", ")}; drawn elsewhere ${result.fit_v1.drawn_elsewhere}; appended ${result.fit_v1.supplementary}`);
  console.log(`\nadversarial cells — ${result.cells.covered.length} covered of 30 off-diagonal (${result.cells.synthetic} synthetic; forbidden ${result.cells.forbidden_covered} of ${result.cells.forbidden_total}):`);
  for (const c of result.cells.covered) console.log(`  ${c.key.padEnd(32)} ${c.forbidden ? "FORBIDDEN" : "         "} ${c.synthetic ? "synthetic" : "real     "} candidates ${String(c.candidates).padStart(5)}  pairs ${c.pairs}`);
  for (const c of result.cells.uncovered) console.log(`  ${c.key.padEnd(32)} ${c.forbidden ? "FORBIDDEN" : "         "} uncovered — ${c.reason}`);
  console.log(`synthetic investigators: ${manifest.synthetic_investigators.map((s) => `${s.name} (${s.family}, fixture ${s.source}, ${s.pairs} pairs)`).join("; ")}`);
  console.log(`\nrandom pool at or above the exploratory floor: ${result.random.pool} pairs`);
  console.log(`\ndropped stratum — investigators (thinnest first): ${result.dropped.investigators.map((d) => `${rosterById.get(d.id)?.name ?? d.id} (${d.item_count} items, ${d.paradigm_confidence}${d.pairs > 1 ? `, ${d.pairs} pairs` : ""})`).join("; ")}`);
  if (result.shortfalls.length) console.log(`\nshortfalls: ${result.shortfalls.join("; ")}`);
  const famTally = (side: "investigator" | "notice") => {
    const t: Record<string, number> = {};
    for (const x of side === "investigator" ? investigators : notices) t[x.family] = (t[x.family] ?? 0) + 1;
    return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  };
  console.log(`\nroster by dominant family (engine view): ${famTally("investigator")}`);
  console.log(`corpus by required family: ${famTally("notice")}`);
  const atExport = { fit: { strong: 0, moderate: 0, exploratory: 0, poor: 0, none: 0 }, legacy: emptyLegacyTally() };
  for (const p of pairs) {
    atExport.fit[p.at_export.fit_v1_tier ?? "none"] += 1;
    atExport.legacy[p.at_export.legacy_tier] += 1;
  }
  console.log(`\nstored tiers at export over the ${pairs.length} pairs — fit-v1 (fit_results): ${Object.entries(atExport.fit).map(([k, v]) => `${k} ${v}`).join(", ")}; legacy page rule: ${Object.entries(atExport.legacy).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`\n30 % rule inputs — grid: fit_results strong ${fitGrid.strong} / moderate ${fitGrid.moderate} vs legacy page-shown strong ${legacyGrid.strong} / potential ${legacyGrid.potential} (ratio Strong ${legacyGrid.strong ? (fitGrid.strong / legacyGrid.strong).toFixed(2) : "—"})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
