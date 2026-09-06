/**
 * Fit engine · PR 2.4 · the stratified gold set (spec §14).
 *
 *   npm run fit:goldset-export -- --seed 1                       # writes docs/fit-engine/goldset/goldset-v1.csv + goldset-v1.manifest.json
 *   npm run fit:goldset-export -- --seed 1 --out /tmp/goldset    # elsewhere (the page imports the docs copy at build time)
 *
 * Read-only against the database: loads the open notice corpus (the
 * service's own loader — profiles, facts, vectors), the roster's stored
 * profiles, the stored document / evidence vectors, every `fit_results`
 * tier and the legacy `outreach_suggestions` snapshots, scores every pair
 * under the legacy cosine rule in memory, draws the 200 pairs
 * deterministically from `--seed` (goldset/stratify.ts), resolves the
 * summaries a labeler needs (names, dominant paradigm, top evidence
 * titles, notice title, designation, Part 1 Purpose excerpt) and writes the
 * CSV with EMPTY label columns beside the manifest (the versioned set: pairs,
 * strata, cells, seed, engine and taxonomy versions). Never writes to the
 * database, never calls a model or an embedding endpoint.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { ENGINE_VERSION } from "../src/lib/fit/engine";
import { forbiddenCellPairs } from "../src/lib/fit/engine/fixtures";
import { csvRowFor, serializeCsv } from "../src/lib/fit/goldset/csv";
import { designationLabel, purposeExcerpt } from "../src/lib/fit/goldset/excerpt";
import { investigatorFamily, noticeFamily } from "../src/lib/fit/goldset/families";
import { LEGACY_EVIDENCE_ITEMS, LEGACY_TOP_HITS, legacyScorePair } from "../src/lib/fit/goldset/legacy";
import { loadEvidenceTitles, loadEvidenceVectors, loadGoldsetRoster, loadInvestigatorVectors, loadNoticeExtras, loadOutreachSnapshots, loadStoredFitTiers } from "../src/lib/fit/goldset/load";
import type { GoldsetManifest, ManifestPair } from "../src/lib/fit/goldset/manifest";
import { GOLDSET_QUOTAS, pairKey, STRATA, stratifyGoldset, type PairSignals, type StratifyInvestigator, type StratifyNotice } from "../src/lib/fit/goldset/stratify";
import { supabaseFitStore } from "../src/lib/fit/service";
import { categoryLabel, TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import type { Confidence, Tier } from "../src/lib/fit/types";
import { SIM } from "../src/lib/outreach/suggest";
import type { SuggestionTier } from "../src/lib/outreach/types";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []))[0];
const SEED = Number(opt("--seed") ?? 1);
const VERSION = opt("--version") ?? "v1";
const OUT = opt("--out") ?? "docs/fit-engine/goldset";
if (!Number.isInteger(SEED) || SEED < 0) {
  console.error("usage: fit:goldset-export -- [--seed N] [--version v1] [--out docs/fit-engine/goldset]");
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

async function main(): Promise<void> {
  const now = new Date();
  const store = supabaseFitStore(supabase, { log });
  log(`fit:goldset-export — seed ${SEED} — ${now.toISOString()}`);

  const corpus = await store.loadCorpus(now);
  log(`corpus: ${corpus.notices.length} open notices with a fit profile (${corpus.with_vector} embedded)`);
  const roster = await loadGoldsetRoster(supabase);
  log(`roster: ${roster.length} investigators with a stored profile`);
  const [docVectors, evidence, fitTiers, snapshots, extras] = await Promise.all([
    loadInvestigatorVectors(supabase, roster.map((r) => r.investigator_id)),
    loadEvidenceVectors(supabase),
    loadStoredFitTiers(supabase),
    loadOutreachSnapshots(supabase),
    loadNoticeExtras(supabase, corpus.notices.map((n) => n.profile.opportunity_id)),
  ]);
  const evidenceVectors = Array.from(evidence.values()).reduce((s, l) => s + l.length, 0);
  log(`vectors: ${docVectors.size} document, ${evidenceVectors} evidence over ${evidence.size} investigators; fit_results ${fitTiers.available ? `${fitTiers.rows.length} rows` : "not on the database"}; outreach snapshots ${snapshots.length}`);

  const noticeById = new Map(corpus.notices.map((n) => [n.profile.opportunity_id, n]));
  const fitTier = new Map(fitTiers.rows.map((r) => [pairKey(r.investigator_id, r.opportunity_id), r.tier]));
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

  const memo = new Map<string, PairSignals>();
  const signals = (inv: string, opp: string): PairSignals => {
    const k = pairKey(inv, opp);
    const hit = memo.get(k);
    if (hit) return hit;
    const legacy = legacyScorePair(docVectors.get(inv) ?? null, noticeById.get(opp)?.vector ?? null, evidence.get(inv) ?? []);
    const s: PairSignals = { legacy: legacy.tier, legacy_similarity: legacy.similarity === null ? null : Number(legacy.similarity.toFixed(4)), fit_v1: (fitTier.get(k) as Tier | undefined) ?? null, outreach: snapshot.get(k) ?? null };
    memo.set(k, s);
    return s;
  };

  const result = stratifyGoldset({ investigators, notices, signals }, { seed: SEED, forbidden: forbiddenCellPairs() });
  const legacyTally = { strong: 0, potential: 0, exploratory: 0, dropped: 0 };
  for (const s of memo.values()) legacyTally[s.legacy] += 1;
  log(`legacy rule over the grid (${memo.size} pairs): strong ${legacyTally.strong}, potential ${legacyTally.potential}, exploratory ${legacyTally.exploratory}, dropped ${legacyTally.dropped}`);

  // Display data.
  const rosterById = new Map(roster.map((r) => [r.investigator_id, r]));
  const wanted = new Map<string, string[]>();
  for (const p of result.pairs) {
    if (wanted.has(p.investigator_id)) continue;
    const r = rosterById.get(p.investigator_id)!;
    const fam = investigatorFamily(r.profile);
    const prov = r.profile.provenance ?? [];
    const own = prov.find((x) => x.axis === "paradigm" && x.category === fam.category)?.top_items ?? prov.find((x) => x.axis === "paradigm")?.top_items ?? [];
    wanted.set(p.investigator_id, own.slice(0, 3));
  }
  const titles = await loadEvidenceTitles(supabase, Array.from(wanted.entries()).map(([investigator_id, ids]) => ({ investigator_id, ids })));

  const pairs: ManifestPair[] = result.pairs.map((p, i) => {
    const r = rosterById.get(p.investigator_id)!;
    const n = noticeById.get(p.opportunity_id)!;
    const fam = investigatorFamily(r.profile);
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
      sources: p.sources,
      at_export: { fit_v1_tier: p.signals.fit_v1, legacy_tier: p.signals.legacy, legacy_similarity: p.signals.legacy_similarity, outreach_tier: p.signals.outreach },
      investigator: {
        name: r.name,
        dominant: { category: fam.category, label: fam.category ? categoryLabel(fam.category) : "no paradigm evidence", family: fam.family, weight: Number(fam.weight.toFixed(3)), view: fam.view },
        evidence: titles.get(p.investigator_id) ?? [],
        item_count: r.item_count,
        pending_items: r.pending_items,
        paradigm_confidence: (r.confidence?.paradigm ?? r.profile.confidence?.paradigm ?? "low") as Confidence,
      },
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
    legacy: { sim: { ...SIM }, top_hits: LEGACY_TOP_HITS, evidence_items: LEGACY_EVIDENCE_ITEMS },
    quotas: GOLDSET_QUOTAS,
    counts: result.counts,
    corpus: { investigators: roster.length, notices: corpus.notices.length, investigators_with_vector: docVectors.size, notices_with_vector: corpus.with_vector, evidence_vectors: evidenceVectors, fit_results_available: fitTiers.available, outreach_snapshots: snapshot.size },
    current_mix: result.current,
    cells: {
      covered: result.cells.covered.map((c) => ({ key: c.key, forbidden: c.forbidden, candidates: c.candidates, pairs: c.pairs })),
      uncovered: result.cells.uncovered.map((c) => ({ key: c.key, forbidden: c.forbidden, reason: c.reason })),
      forbidden_total: result.cells.forbidden_total,
      forbidden_covered: result.cells.forbidden_covered,
    },
    dropped_investigators: result.dropped.investigators.map((d) => ({ ...d, name: rosterById.get(d.id)?.name ?? d.id })),
    shortfalls: result.shortfalls,
    pairs,
  };

  mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, `goldset-${VERSION}.manifest.json`);
  const csvPath = path.join(OUT, `goldset-${VERSION}.csv`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(csvPath, serializeCsv(pairs.map((p) => csvRowFor(p))));

  // Report.
  console.log(`# fit:goldset-export — ${VERSION} — seed ${SEED} — ${now.toISOString()} — taxonomy ${TAXONOMY_VERSION}, engine ${ENGINE_VERSION}`);
  console.log(`wrote ${manifestPath} and ${csvPath} (${pairs.length} pairs)`);
  console.log(`\nstrata: ${STRATA.map((s) => `${s} ${result.counts[s]} / ${GOLDSET_QUOTAS[s]}`).join(" · ")}`);
  console.log(`\ncurrent mix — pool: ${Object.entries(result.current.pool).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`current mix — drawn: ${Object.entries(result.current.drawn).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`\nadversarial cells — ${result.cells.covered.length} covered of 30 off-diagonal (forbidden ${result.cells.forbidden_covered} of ${result.cells.forbidden_total}):`);
  for (const c of result.cells.covered) console.log(`  ${c.key.padEnd(32)} ${c.forbidden ? "FORBIDDEN" : "         "} candidates ${String(c.candidates).padStart(5)}  pairs ${c.pairs}`);
  for (const c of result.cells.uncovered) console.log(`  ${c.key.padEnd(32)} ${c.forbidden ? "FORBIDDEN" : "         "} uncovered — ${c.reason}`);
  console.log(`\nrandom pool above the exploratory floor: ${result.random.pool} pairs`);
  console.log(`\ndropped stratum — investigators (thinnest first): ${result.dropped.investigators.map((d) => `${rosterById.get(d.id)?.name ?? d.id} (${d.item_count} items, ${d.paradigm_confidence}${d.pairs > 1 ? `, ${d.pairs} pairs` : ""})`).join("; ")}`);
  if (result.shortfalls.length) console.log(`\nshortfalls: ${result.shortfalls.join("; ")}`);
  const famTally = (side: "investigator" | "notice") => {
    const t: Record<string, number> = {};
    for (const x of side === "investigator" ? investigators : notices) t[x.family] = (t[x.family] ?? 0) + 1;
    return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  };
  console.log(`\nroster by dominant family (engine view): ${famTally("investigator")}`);
  console.log(`corpus by required family: ${famTally("notice")}`);
  const atExport = { fit: { strong: 0, moderate: 0, exploratory: 0, poor: 0, none: 0 }, legacy: { strong: 0, potential: 0, exploratory: 0, dropped: 0 } };
  for (const p of pairs) {
    atExport.fit[p.at_export.fit_v1_tier ?? "none"] += 1;
    atExport.legacy[p.at_export.legacy_tier] += 1;
  }
  console.log(`\nstored tiers at export over the ${pairs.length} pairs — fit-v1 (fit_results): ${Object.entries(atExport.fit).map(([k, v]) => `${k} ${v}`).join(", ")}; legacy rule: ${Object.entries(atExport.legacy).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
