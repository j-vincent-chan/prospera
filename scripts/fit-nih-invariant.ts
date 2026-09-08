/**
 * Fit engine · PR 5.0a NIH invariant harness. READ-ONLY.
 *
 * The Phase 5 constraint (NON_NIH_PLAN § "The NIH invariant") is that for any
 * team whose `fit_corpus` is `'nih'`, every NIH notice's parsed sections, built
 * profile, extraction cache keys, `fit_results` rows and rendered rationale are
 * identical to what `main` produced before the phase began — for the whole
 * phase, not only at the end. This makes that checkable in one command.
 *
 *   npm run fit:nih-invariant -- --capture          # write the baseline (needs .env.local)
 *   npm run fit:nih-invariant -- --verify           # recompute from DB + checkout, diff
 *   npm run fit:nih-invariant -- --verify --offline # the pure half only, no credentials
 *
 * `--verify --offline` is the mode every Phase 5 PR must keep green, and the
 * one CI runs: it re-renders the extractor prompts from the committed Guide
 * HTML fixtures, recomputes their `extractionCacheKey`s, and re-runs
 * `scorePair` over a committed sample of real investigator × notice pairs.
 * Nothing in it touches Supabase or the network.
 *
 * Baseline: docs/fit-engine/nih-baseline/{notices,prompts,profiles,results}.json
 * — hashes and small canonical records, written compactly, under a megabyte.
 *
 * Exit codes: 0 identical; 1 a fatal error (missing baseline, failed read);
 * 2 at least one difference — the first 20 are printed with the notice number
 * and the field path.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import { ENGINE_VERSION, scorePair } from "../src/lib/fit/engine";
import type { ExtractorPriors, NoticeHeader } from "../src/lib/fit/profile/opportunity-extract";
import { deterministicOverlays, noticeHeader, noticeText, NIH_NOTICE_FILTER, type NoticeRecord } from "../src/lib/fit/profile/opportunity";
import { openNoticeFilter } from "../src/lib/ingestion/reporter/exemplars";
import { buildScoreContext, supabaseFitStore } from "../src/lib/fit/service";
import type { OpportunityFitProfile } from "../src/lib/fit/types";
// The pure half lives under src/ so `npm test` can run it (nih-invariant.test.ts).
import {
  BASELINE_DIR,
  DP,
  FIXED_NOW,
  FIXTURE_DIR,
  compareFields,
  compareKeyed,
  expectedFromResult,
  flattenFixtures,
  groupRecords,
  h,
  pairKey,
  promptFixtureRecords,
  verifyOffline as verifyOfflineCheck,
  type Diff,
  type GroupRecord,
  type OfflineBundle,
  type PromptFixture,
  type PromptFixtureInput,
} from "../src/lib/fit/nih-invariant";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const doCapture = args.includes("--capture");
const doVerify = args.includes("--verify");
const offline = args.includes("--offline");

function numArg(name: string, fallback: number): number {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} expects a non-negative number`);
    process.exit(1);
  }
  return n;
}
function strArg(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const outDir = strArg("--out") ?? BASELINE_DIR;
/** How many investigators and notices the committed offline scoring sample covers. */
const sampleInvestigators = numArg("--sample-investigators", 3);
const sampleNotices = numArg("--sample-notices", 4);
/** Pairs given per-field hashes so a results difference can be localised to a field path. */
const samplePairs = numArg("--sample-pairs", 200);
const maxDiffs = numArg("--max-diffs", 20);

if (!doCapture && !doVerify) {
  console.error("usage: fit-nih-invariant --capture | --verify [--offline]");
  process.exit(1);
}
if (doCapture && doVerify) {
  console.error("--capture and --verify are separate runs");
  process.exit(1);
}
if (doCapture && offline) {
  console.error("--capture needs the database; --offline applies to --verify only");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Baseline files
// ---------------------------------------------------------------------------

type Meta = { captured_at: string; taxonomy_version: string; engine_version: string; counts: Record<string, number> };

type NoticesFile = {
  meta: Meta;
  notices: Array<{
    number: string;
    guide_sections_sha256: string | null;
    clinical_trial_designation: string | null;
    program_division: string | null;
    activity_code: string | null;
    guide_source: string | null;
    guide_html_hash: string | null;
    text_source: string;
  }>;
};

type PromptsFile = { meta: Meta; corpus: Array<{ number: string; groups: GroupRecord[] }>; offline: { fixtures: PromptFixture[] } };

type ProfilesFile = {
  meta: Meta;
  corpus: Array<{ number: string; profile_sha256: string; confidence: string; text_source: string; complete: boolean; sources_sha256: string }>;
};

type ResultsFile = {
  meta: Meta;
  by_investigator: Array<{ investigator_id: string; rows: number; tiers: Record<string, number>; sha256: string }>;
  pairs: Array<{ investigator_id: string; number: string; tier: string; score: string; caps_sha256: string; components_sha256: string; provenance_sha256: string; rationale_sha256: string }>;
  offline: OfflineBundle;
};

function writeJson(name: string, value: unknown): number {
  mkdirSync(outDir, { recursive: true });
  const text = JSON.stringify(value);
  writeFileSync(path.join(outDir, name), text + "\n");
  return text.length;
}

function readJson<T>(name: string): T {
  const file = path.join(outDir, name);
  if (!existsSync(file)) {
    console.error(`baseline missing: ${file}\nRun \`npm run fit:nih-invariant -- --capture\` on a clean checkout first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

// ---------------------------------------------------------------------------
// Database reads (capture and online verify only)
// ---------------------------------------------------------------------------

const NOTICE_SELECT =
  "id, opportunity_number, title, agency, agency_code, activity_code, clinical_trial_designation, program_division, " +
  "guide_sections, guide_html_hash, guide_source, description, nih_ic_tokens, forecasted, posted_date";

const PAGE = 500;

function connect(): SupabaseClient {
  config({ path: ".env.local", quiet: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Every open NIH notice, by the Guide sync's own filter, in `opportunity_number` order. */
async function loadNihNotices(db: SupabaseClient, today: string): Promise<NoticeRecord[]> {
  const rows: NoticeRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("funding_opportunities")
      .select(NOTICE_SELECT)
      .or(openNoticeFilter(today))
      .or(NIH_NOTICE_FILTER)
      .order("opportunity_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`funding_opportunities: ${error.message}`);
    const page = (data ?? []) as unknown as NoticeRecord[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

type StoredProfile = { opportunity_id: string; profile: OpportunityFitProfile; confidence: string; sources: Record<string, unknown> };

async function loadStoredProfiles(db: SupabaseClient): Promise<Map<string, StoredProfile>> {
  const out = new Map<string, StoredProfile>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("opportunity_fit_profiles")
      .select("opportunity_id, profile, confidence, sources")
      .order("opportunity_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`opportunity_fit_profiles: ${error.message}`);
    const page = (data ?? []) as unknown as StoredProfile[];
    for (const p of page) out.set(p.opportunity_id, p);
    if (page.length < PAGE) break;
  }
  return out;
}

type ResultRow = {
  investigator_id: string;
  opportunity_id: string;
  tier: string;
  score: number;
  caps: string[];
  components: Record<string, unknown>;
  provenance: Record<string, unknown>;
  rationale: string | null;
};

/** Every `fit_results` row whose notice is one of `noticeIds`, investigator then notice order. */
async function loadResults(db: SupabaseClient, noticeIds: Set<string>): Promise<ResultRow[]> {
  const rows: ResultRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("fit_results")
      .select("investigator_id, opportunity_id, tier, score, caps, components, provenance, rationale")
      .order("investigator_id")
      .order("opportunity_id")
      .range(from, from + 999);
    if (error) throw new Error(`fit_results: ${error.message}`);
    const page = (data ?? []) as unknown as ResultRow[];
    rows.push(...page.filter((r) => noticeIds.has(r.opportunity_id)));
    if (page.length < 1000) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Building the four files from the database
// ---------------------------------------------------------------------------

type Built = { notices: NoticesFile; prompts: PromptsFile; profiles: ProfilesFile; results: ResultsFile };

async function build(db: SupabaseClient): Promise<Built> {
  const today = new Date().toISOString().slice(0, 10);
  process.stderr.write("Reading notices…\n");
  const notices = await loadNihNotices(db, today);
  const withNumber = notices.filter((n) => (n.opportunity_number ?? "").trim());
  const byId = new Map(notices.map((n) => [n.id, n]));

  process.stderr.write("Rendering prompts…\n");
  const noticeRecords: NoticesFile["notices"] = [];
  const promptCorpus: PromptsFile["corpus"] = [];
  for (const n of withNumber) {
    const overlays = deterministicOverlays(n);
    const text = noticeText(n);
    noticeRecords.push({
      number: n.opportunity_number!,
      guide_sections_sha256: n.guide_sections ? h(n.guide_sections) : null,
      clinical_trial_designation: n.clinical_trial_designation,
      program_division: n.program_division,
      activity_code: n.activity_code,
      guide_source: n.guide_source,
      guide_html_hash: n.guide_html_hash,
      text_source: text.source,
    });
    if (text.sections.length) {
      promptCorpus.push({ number: n.opportunity_number!, groups: groupRecords(text.sections, noticeHeader(n, overlays), overlays.priors) });
    }
  }

  process.stderr.write("Reading profiles…\n");
  const stored = await loadStoredProfiles(db);
  const profileCorpus: ProfilesFile["corpus"] = [];
  for (const n of withNumber) {
    const p = stored.get(n.id);
    if (!p) continue;
    const sources = (p.sources ?? {}) as { text?: unknown; complete?: unknown };
    profileCorpus.push({
      number: n.opportunity_number!,
      profile_sha256: h(p.profile),
      confidence: String(p.confidence),
      text_source: typeof sources.text === "string" ? sources.text : String(sources.text ?? "∅"),
      complete: sources.complete !== false,
      sources_sha256: h(sources),
    });
  }

  process.stderr.write("Reading fit_results…\n");
  const results = await loadResults(db, new Set(notices.map((n) => n.id)));
  const numberOf = (oppId: string) => byId.get(oppId)?.opportunity_number ?? oppId;

  const byInvestigator = new Map<string, ResultRow[]>();
  for (const r of results) {
    const list = byInvestigator.get(r.investigator_id);
    if (list) list.push(r);
    else byInvestigator.set(r.investigator_id, [r]);
  }
  const canonicalRow = (r: ResultRow) => ({
    number: numberOf(r.opportunity_id),
    tier: r.tier,
    score: r.score.toFixed(DP),
    caps: r.caps ?? [],
    components: r.components,
    provenance: r.provenance,
    rationale: r.rationale ?? "",
  });
  const resultsByInvestigator: ResultsFile["by_investigator"] = [...byInvestigator.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([investigator_id, rows]) => {
      const tiers: Record<string, number> = {};
      for (const r of rows) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;
      const sorted = [...rows].sort((a, b) => numberOf(a.opportunity_id).localeCompare(numberOf(b.opportunity_id)));
      return { investigator_id, rows: rows.length, tiers, sha256: h(sorted.map(canonicalRow)) };
    });

  // A bounded, evenly-spaced slice gets per-field hashes so a difference can be
  // named down to `provenance` or `rationale` rather than only to an investigator.
  const spaced = results.length <= samplePairs ? results : Array.from({ length: samplePairs }, (_, i) => results[Math.floor((i * results.length) / samplePairs)]!);
  const resultPairs: ResultsFile["pairs"] = spaced.map((r) => ({
    investigator_id: r.investigator_id,
    number: numberOf(r.opportunity_id),
    tier: r.tier,
    score: r.score.toFixed(DP),
    caps_sha256: h(r.caps ?? []),
    components_sha256: h(r.components),
    provenance_sha256: h(r.provenance),
    rationale_sha256: h(r.rationale ?? ""),
  }));

  process.stderr.write("Building the offline sample…\n");
  const offlineBundle = await buildOfflineBundle(db, byId);

  const meta: Meta = {
    captured_at: new Date().toISOString(),
    taxonomy_version: TAXONOMY_VERSION,
    engine_version: ENGINE_VERSION,
    counts: {
      open_nih_notices: withNumber.length,
      with_sections: promptCorpus.length,
      with_profile: profileCorpus.length,
      investigators: resultsByInvestigator.length,
      result_rows: results.length,
      sampled_pairs: resultPairs.length,
      offline_pairs: offlineBundle.expected.length,
    },
  };

  return {
    notices: { meta, notices: noticeRecords },
    prompts: { meta, corpus: promptCorpus, offline: { fixtures: promptFixtureRecords(fixtureInputs(byId)) } },
    profiles: { meta, corpus: profileCorpus },
    results: { meta, by_investigator: resultsByInvestigator, pairs: resultPairs, offline: offlineBundle },
  };
}

/**
 * The header and priors for each committed HTML fixture, taken from the live
 * notice row where one exists so the offline prompts are the prompts the
 * pipeline really renders; a fixture with no row falls back to the parser's
 * own reading of the page.
 */
function fixtureInputs(byId: Map<string, NoticeRecord>): Array<{ file: string; number: string; header: NoticeHeader; priors: ExtractorPriors }> {
  const files: Array<[string, string]> = [
    ["PA-25-303.html", "PA-25-303"],
    ["PAR-27-026.html", "PAR-27-026"],
    ["PAR-27-064-Full-Announcement.html", "PAR-27-064"],
    ["RFA-CA-27-020-Full-Announcement.html", "RFA-CA-27-020"],
  ];
  const byNumber = new Map([...byId.values()].map((n) => [(n.opportunity_number ?? "").toUpperCase(), n]));
  const out: Array<{ file: string; number: string; header: NoticeHeader; priors: ExtractorPriors }> = [];
  for (const [file, number] of files) {
    if (!existsSync(path.join(FIXTURE_DIR, file))) continue;
    const row = byNumber.get(number.toUpperCase());
    const notice: NoticeRecord = row ?? {
      id: `fixture:${number}`,
      opportunity_number: number,
      title: number,
      agency: null,
      agency_code: "HHS-NIH11",
      activity_code: null,
      clinical_trial_designation: null,
      program_division: null,
      guide_sections: null,
      guide_html_hash: null,
      guide_source: null,
      description: null,
    };
    const overlays = deterministicOverlays(notice);
    out.push({ file, number, header: noticeHeader(notice, overlays), priors: overlays.priors });
  }
  return out;
}

/** Real pairs, chosen deterministically: the investigators with the fewest items (so the bundle stays small) and the notices with the most distinct clinical-trial designations. */
async function buildOfflineBundle(db: SupabaseClient, byId: Map<string, NoticeRecord>): Promise<OfflineBundle> {
  const store = supabaseFitStore(db);
  const corpus = await store.loadCorpus(new Date());
  const roster = await store.loadRoster();

  const loaded: Array<NonNullable<Awaited<ReturnType<typeof store.loadInvestigator>>>> = [];
  for (const entry of [...roster].sort((a, b) => a.investigator_id.localeCompare(b.investigator_id))) {
    const inv = await store.loadInvestigator(entry.investigator_id, new Date());
    if (inv && inv.items.length >= 10) loaded.push(inv);
    if (loaded.length >= 40) break;
  }
  const investigators = loaded
    .sort((a, b) => a.items.length - b.items.length || a.profile.investigator_id.localeCompare(b.profile.investigator_id))
    .slice(0, sampleInvestigators);

  const withProfile = corpus.notices.filter((n) => byId.has(n.profile.opportunity_id));
  const seen = new Set<string>();
  const picked: typeof withProfile = [];
  for (const n of [...withProfile].sort((a, b) => (byId.get(a.profile.opportunity_id)?.opportunity_number ?? "").localeCompare(byId.get(b.profile.opportunity_id)?.opportunity_number ?? ""))) {
    const designation = String(byId.get(n.profile.opportunity_id)?.clinical_trial_designation ?? "unknown");
    if (seen.has(designation)) continue;
    seen.add(designation);
    picked.push(n);
    if (picked.length >= sampleNotices) break;
  }
  for (const n of withProfile) {
    if (picked.length >= sampleNotices) break;
    if (!picked.includes(n)) picked.push(n);
  }

  const cosines: Record<string, Array<number | null>> = {};
  const expected: OfflineBundle["expected"] = [];
  for (const inv of investigators) {
    for (const notice of picked) {
      const ctx = buildScoreContext(inv, notice, corpus, FIXED_NOW);
      cosines[pairKey(inv.profile.investigator_id, notice.profile.opportunity_id)] = ctx.topic.items.map((i) => i.cosine);
      expected.push(expectedFromResult(inv.profile.investigator_id, notice.profile.opportunity_id, scorePair(inv.profile, notice.profile, ctx)));
    }
  }

  return {
    fixed_now: FIXED_NOW,
    idf: corpus.idf.table,
    term_df: corpus.termDf,
    doc_count: corpus.notices.length,
    investigators: investigators.map((inv) => ({
      investigator_id: inv.profile.investigator_id,
      pending_items: inv.pending_items,
      profile: inv.profile,
      items: inv.items.map((i) => ({ id: i.id, paradigm: i.paradigm, design: i.design, tf: i.tf, length: i.length })),
    })),
    notices: picked.map((n) => ({
      opportunity_id: n.profile.opportunity_id,
      number: byId.get(n.profile.opportunity_id)?.opportunity_number ?? null,
      complete: n.complete,
      runway_weeks: n.runway_weeks,
      profile: n.profile,
    })),
    cosines,
    expected,
  };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/** Collected across both halves; the module's comparators append to it. */
const diffs: Diff[] = [];

/** The pure half, delegated to the module the suite also runs. */
function verifyOffline(): void {
  const check = verifyOfflineCheck(outDir, FIXTURE_DIR);
  diffs.push(...check.diffs);
  process.stderr.write(`offline: ${check.fixtures} prompt fixtures, ${check.pairs} scored pairs\n`);
}

/** The database half, on top of the pure half. */
async function verifyOnline(db: SupabaseClient): Promise<void> {
  const built = await build(db);
  const baseNotices = readJson<NoticesFile>("notices.json");
  const basePrompts = readJson<PromptsFile>("prompts.json");
  const baseProfiles = readJson<ProfilesFile>("profiles.json");
  const baseResults = readJson<ResultsFile>("results.json");
  const rows = (v: unknown) => v as unknown as Array<Record<string, unknown>>;

  compareKeyed(diffs, "notice", rows(baseNotices.notices), rows(built.notices.notices), (r) => String(r.number));

  const flattenCorpus = (f: PromptsFile) =>
    f.corpus.flatMap((n) => n.groups.map((g) => ({ key: `${n.number} group ${g.tag}`, prompt_sha256: g.prompt_sha256, cache_key: g.cache_key })));
  compareKeyed(diffs, "prompt", rows(flattenCorpus(basePrompts)), rows(flattenCorpus(built.prompts)), (r) => String(r.key));

  compareKeyed(diffs, "profile", rows(baseProfiles.corpus), rows(built.profiles.corpus), (r) => String(r.number));

  compareKeyed(diffs, "results", rows(baseResults.by_investigator), rows(built.results.by_investigator), (r) => `for investigator ${String(r.investigator_id).slice(0, 8)}`);
  compareKeyed(diffs, "pair", rows(baseResults.pairs), rows(built.results.pairs), (r) => `${String(r.investigator_id).slice(0, 8)} × ${r.number}`);

  process.stderr.write(
    `online: ${built.notices.notices.length} notices, ${built.prompts.corpus.length} with sections, ` +
      `${built.profiles.corpus.length} profiles, ${built.results.by_investigator.length} investigators\n`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  if (doCapture) {
    const built = await build(connect());
    const sizes = [
      ["notices.json", writeJson("notices.json", built.notices)],
      ["prompts.json", writeJson("prompts.json", built.prompts)],
      ["profiles.json", writeJson("profiles.json", built.profiles)],
      ["results.json", writeJson("results.json", built.results)],
    ] as const;
    const total = sizes.reduce((s, [, n]) => s + n, 0);
    for (const [name, n] of sizes) console.log(`  ${name.padEnd(14)} ${(n / 1024).toFixed(1)} KB`);
    console.log(`  ${"total".padEnd(14)} ${(total / 1024).toFixed(1)} KB${total > 1024 * 1024 ? "  ** over the 1 MB budget **" : ""}`);
    console.log(`\nCaptured into ${outDir}: ${JSON.stringify(built.notices.meta.counts)}`);
    return total > 1024 * 1024 ? 2 : 0;
  }

  verifyOffline();
  if (!offline) await verifyOnline(connect());

  if (diffs.length === 0) {
    console.log(offline ? "NIH invariant holds (offline: prompts, cache keys and scorePair)." : "NIH invariant holds.");
    return 0;
  }
  console.error(`\n${diffs.length} difference${diffs.length === 1 ? "" : "s"} from the baseline — the NIH invariant is broken.\n`);

  // The shape first: with 655 notices in the corpus, a single changed function
  // produces thousands of differences, and the first 20 alone would suggest the
  // damage stops at whatever sorts first.
  const byClass = new Map<string, { count: number; subjects: Set<string>; paths: Set<string> }>();
  for (const d of diffs) {
    const cls = d.subject.split(" ")[0] ?? d.subject;
    const entry = byClass.get(cls) ?? { count: 0, subjects: new Set<string>(), paths: new Set<string>() };
    entry.count += 1;
    entry.subjects.add(d.subject);
    entry.paths.add(d.path);
    byClass.set(cls, entry);
  }
  console.error("  Summary");
  for (const [cls, e] of [...byClass.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.error(`    ${cls.padEnd(10)} ${String(e.count).padStart(6)} difference(s) across ${e.subjects.size} subject(s) · fields: ${[...e.paths].sort().join(", ")}`);
  }
  console.error("");

  // Round-robin across the classes so the sample is not all of whichever sorts first.
  const queues = [...byClass.keys()].map((cls) => diffs.filter((d) => (d.subject.split(" ")[0] ?? d.subject) === cls));
  const sample: Diff[] = [];
  for (let i = 0; sample.length < maxDiffs && queues.some((q) => q.length > i); i += 1) {
    for (const q of queues) {
      if (sample.length >= maxDiffs) break;
      if (q[i]) sample.push(q[i]!);
    }
  }
  for (const d of sample) {
    console.error(`  ${d.subject}\n    ${d.path}\n      baseline: ${d.baseline}\n      now:      ${d.current}`);
  }
  if (diffs.length > sample.length) console.error(`\n  … and ${diffs.length - sample.length} more.`);
  console.error("\nA PR in Phase 5 that cannot keep this green is wrong, not close enough — bring the diff to a person.");
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
