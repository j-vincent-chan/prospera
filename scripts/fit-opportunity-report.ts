/**
 * Fit engine · PR 1.5 · opportunity fit profiles, read-only.
 *
 *   npm run fit:opportunity-report -- --dry-run                       # 20 open NIH notices with sections: overlays + exemplar prior (rules only); nothing written
 *   npm run fit:opportunity-report -- --dry-run --limit 30            # N notices
 *   npm run fit:opportunity-report -- --dry-run --extract RFA-DK-26-315,PAR-25-122   # ≤ 3 notices also through the real extractor (≤ 12 model calls in all)
 *   npm run fit:opportunity-report -- --fixtures                      # the six prompt-spec fixtures through the mocked model (no network, no database)
 *   npm run fit:opportunity-report -- --report                        # the stored opportunity_fit_profiles rows (empty until the cron has run)
 *
 * The dry run builds profiles in memory with buildOpportunityFitProfileFrom:
 * the deterministic overlays, the RePORTER exemplar prior classified by the
 * rules alone (no item-classifier model calls), and — only for the numbers in
 * --extract, at most three — the real notice extractor over the stored Guide
 * sections (OPENAI_API_KEY from .env.local, model FIT_MODEL_EXTRACT, default
 * gpt-4o), printing every verified field beside the quote and section it
 * cites and the dropped-claim log. Caches are in memory. The database is read
 * (funding_opportunities, opportunity_exemplars, mesh_descriptors) and never
 * written. Hard cap of 12 model calls per run.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ModelFn } from "../src/lib/fit/classify/llm";
import { loadMeshIndex } from "../src/lib/fit/classify/mesh-db";
import { DEFAULT_RULE_TABLES, evaluateRules, type EvaluateContext } from "../src/lib/fit/classify/rules";
import {
  buildOpportunityFitProfileFrom,
  EXEMPLAR_COLUMNS,
  extractModelName,
  InMemoryNoticeExtractionCache,
  groupSections,
  ModelBudget,
  NIH_NOTICE_FILTER,
  NOTICE_COLUMNS,
  openaiExtractor,
  verifyQuote,
  type ExemplarRecord,
  type NoticeRecord,
  type OpportunityFitProfileRow,
  type ProfileBuild,
} from "../src/lib/fit/profile/opportunity";
import { checkNoticeFixture, fixtureModel, formatNoticeChecks, NOTICE_FIXTURES } from "../src/lib/fit/profile/opportunity-fixtures";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import type { OpportunityFitProfile } from "../src/lib/fit/types";
import { openNoticeFilter } from "../src/lib/ingestion/reporter/exemplars";

config({ path: ".env.local", quiet: true });

const MAX_CALLS = 12;
const MAX_EXTRACT = 3;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const REPORT = flag("--report");
const FIXTURES = flag("--fixtures");
const LIMIT = Number(opt("--limit") ?? 20);
const EXTRACT = (opt("--extract") ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

if (!DRY_RUN && !REPORT && !FIXTURES) {
  console.error("usage: fit:opportunity-report -- --dry-run [--limit N] [--extract NUM,NUM,NUM] | --fixtures | --report");
  process.exit(1);
}
if (EXTRACT.length > MAX_EXTRACT) {
  console.error(`--extract takes at most ${MAX_EXTRACT} notices`);
  process.exit(1);
}

const line = (s = "", width = 110) => console.log(s.padEnd(width, "─"));
const weights = (m: Record<string, number | undefined>, n = 6) =>
  Object.entries(m)
    .filter((e): e is [string, number] => typeof e[1] === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(", ") || "(none)";
const list = (l: readonly string[]) => (l.length ? l.join(", ") : "(none)");

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function printProfile(build: ProfileBuild, verbose: boolean): void {
  const p = build.profile;
  const o = build.overlays;
  console.log(`  overlays: ${list(o.applied)}${o.notes.length ? ` · notes: ${o.notes.join("; ")}` : ""}`);
  console.log(`  text: ${build.text.source} (${build.text.sections.length} sections, ${build.text.sections.reduce((a, s) => a + s.text.length, 0)} chars)${build.runs.length ? ` · groups ${build.runs.map((r) => `${r.group}${r.of > 1 ? `/${r.chunk}` : ""}:${r.cache}${r.model_called ? " called" : ""}${r.skipped ? ` skipped(${r.skipped})` : ""}${r.extraction && !r.extraction.usable ? " UNUSABLE" : ""}`).join(" ")}` : " · extractor not run"}`);
  const ex = build.exemplar;
  console.log(`  exemplars: ${ex.classified} classified of ${ex.rows} rows · blend exemplar ${build.blend.weights.exemplar} / text ${build.blend.weights.text} · model calls ${ex.model_calls} · prior paradigm: ${weights(ex.axes.paradigm)}${Object.keys(ex.axes.design).length ? ` · design: ${weights(ex.axes.design, 4)}` : ""}`);
  console.log(`  paradigm required: ${weights(p.paradigm.required)}${Object.keys(p.paradigm.required_any).length ? ` · required_any: ${weights(p.paradigm.required_any)}` : ""}`);
  console.log(`  paradigm allowed:  ${weights(p.paradigm.allowed)} · excluded: ${weights(p.paradigm.excluded)}`);
  console.log(`  unit: required ${list(p.unit.required)}${p.unit.required_any.length ? ` · required_any ${list(p.unit.required_any)}` : ""} · allowed ${list(p.unit.allowed)}`);
  console.log(`  design: required_any ${list(p.design.required_any)}${p.design.required_any_2.length ? ` · required_any_2 ${list(p.design.required_any_2)}` : ""} · allowed ${list(p.design.allowed)} · prohibited ${list(p.design.prohibited)}`);
  console.log(`  materials: required ${list(p.materials.required)}${p.materials.required_any.length ? ` · required_any ${list(p.materials.required_any)}` : ""} · expected ${list(p.materials.expected)} · human_required ${String(p.materials.human_required)}`);
  console.log(`  objective: ${weights(p.objective)} · population: ${p.population ?? "(none)"}`);
  console.log(`  mechanism: ${p.mechanism.activity_code ?? "?"} · CT ${p.mechanism.clinical_trial}${p.mechanism.besh ? " (BESH)" : ""} · ceiling ${p.mechanism.ceiling_direct_per_year ?? "?"} · period ${p.mechanism.period_years ?? "?"} y · IC ${p.mechanism.issuing_ic ?? "?"} · division ${p.mechanism.program_division ?? "(none)"}`);
  console.log(`  confidence ${p.confidence}${p.needs_review ? " · NEEDS REVIEW" : ""} · topic terms: ${list(p.topic.terms.slice(0, 8))} · rcdc: ${p.topic.rcdc.slice(0, 5).join("; ") || "(none)"}`);
  if (p.non_responsive.length) console.log(`  non-responsive (${p.non_responsive.length}): ${p.non_responsive.map((s) => `"${s.length > 110 ? `${s.slice(0, 107)}…` : s}"`).join(" | ")}`);
  const el = p.eligibility;
  if (el.investigator_rules.length || el.esi_only || el.new_investigator_only || el.clinician_required || el.degree_required || el.independent_appointment_required || el.citizenship_rule) {
    console.log(`  eligibility: ${JSON.stringify({ ...el, investigator_rules: el.investigator_rules.map((r) => (r.length > 90 ? `${r.slice(0, 87)}…` : r)) })}`);
  }
  if (p.team.multi_pi_allowed !== null || p.team.consortium_required !== null || p.team.required_partners.length) console.log(`  team: ${JSON.stringify(p.team)}`);
  for (const l of build.merged.overrides_applied) console.log(`  prior override: ${l}`);
  for (const l of build.merged.log) console.log(`  merge: ${l}`);
  for (const l of build.blend.log) console.log(`  blend: ${l}`);
  if (!verbose) return;
  for (const run of build.runs) {
    const e = run.extraction;
    line(`  ── group ${run.group}${run.of > 1 ? ` chunk ${run.chunk}/${run.of}` : ""} · ${run.chars} chars · ${run.cache}${run.model_called ? " · model called" : ""}${run.skipped ? ` · skipped: ${run.skipped}` : ""} `);
    if (!e) continue;
    console.log(`  model ${e.model} · usable ${e.usable} · confidence ${e.output.confidence ?? "(none)"}`);
    const o = e.output;
    if (run.group === 1) {
      console.log(`  paradigm: required ${weights(o.paradigm.required)} · required_any ${weights(o.paradigm.required_any)} · allowed ${weights(o.paradigm.allowed)} · excluded ${weights(o.paradigm.excluded)}`);
      console.log(`  unit: required ${list(o.unit.required)} · allowed ${list(o.unit.allowed)}`);
      console.log(`  design: required_any ${list(o.design.required_any)} · required_any_2 ${list(o.design.required_any_2)} · allowed ${list(o.design.allowed)} · prohibited ${list(o.design.prohibited)}`);
      console.log(`  materials: expected ${list(o.materials.expected)} · human_required ${String(o.materials.human_required)} · population ${o.population ?? "(none)"}`);
      console.log(`  objective: ${weights(o.objective)} · topic: ${list([...o.topic.distinguishing_terms, ...o.topic.diseases, ...o.topic.biological_processes])}`);
    }
    if (run.group === 2) {
      console.log(`  excluded ${weights(o.paradigm.excluded)} · prohibited ${list(o.design.prohibited)} · mechanism ${JSON.stringify(o.mechanism)} · clinical_trial_text ${o.clinical_trial_text ? `"${o.clinical_trial_text}"` : "(none)"}`);
      console.log(`  non_responsive (${o.non_responsive.length}): ${o.non_responsive.map((s) => `"${s}"`).join(" | ") || "(none)"}`);
    }
    if (run.group === 3) console.log(`  eligibility ${JSON.stringify(o.eligibility)} · team ${JSON.stringify(o.team)}`);
    const rawEvidence = Array.isArray((e.raw as { evidence?: unknown })?.evidence) ? ((e.raw as { evidence: unknown[] }).evidence as Array<{ field?: unknown; quote?: unknown; section?: unknown }>) : [];
    console.log(`  evidence (${o.evidence.length} of ${rawEvidence.length} quotes verified):`);
    for (const q of rawEvidence) {
      const quote = typeof q.quote === "string" ? q.quote : JSON.stringify(q.quote);
      const check = verifyQuote(quote, typeof q.section === "string" ? q.section : null, run.extraction ? build.text.sections.filter((s) => groupSections([s])[run.group].length) : []);
      console.log(`    ${check.ok ? (check.corrected ? "OK*" : "OK ") : "FAIL"} ${String(q.field).padEnd(38)} "${quote.length > 240 ? `${quote.slice(0, 237)}…` : quote}"  [${String(q.section)}]${check.ok && check.fragments > 1 ? ` (${check.fragments} fragments)` : ""}${!check.ok ? ` — ${check.reason}` : ""}`);
    }
    for (const ov of o.prior_overrides) console.log(`    OVERRIDE ${ov.field}: ${JSON.stringify(ov.from)} → ${JSON.stringify(ov.to)} "${ov.quote}" [${ov.section}]`);
    console.log(`  dropped-claim log (${e.dropped.length}):`);
    for (const d of e.dropped) console.log(`    ${d}`);
  }
}

async function loadExemplars(supabase: SupabaseClient, number: string): Promise<ExemplarRecord[]> {
  const { data, error } = await supabase.from("opportunity_exemplars").select(EXEMPLAR_COLUMNS).eq("opportunity_number", number).order("fiscal_year", { ascending: false }).order("project_num");
  if (error) throw new Error(`opportunity_exemplars read failed: ${error.message}`);
  return (data ?? []) as ExemplarRecord[];
}

async function dryRun(): Promise<void> {
  const supabase = db();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`fit:opportunity-report · DRY RUN · taxonomy ${TAXONOMY_VERSION} · extractor ${EXTRACT.length ? `${extractModelName()} on ${EXTRACT.join(", ")}` : "not run"} · exemplar classification: rules only · ${new Date().toISOString()}`);
  console.error("loading mesh_descriptors …");
  const mesh = await loadMeshIndex(supabase);
  const ctx: EvaluateContext = { mesh, tables: DEFAULT_RULE_TABLES };
  const rules = (item: Parameters<typeof evaluateRules>[0]) => evaluateRules(item, ctx);

  const { data, error } = await supabase
    .from("funding_opportunities")
    .select(NOTICE_COLUMNS)
    .or(openNoticeFilter(today))
    .or(NIH_NOTICE_FILTER)
    .not("guide_sections", "is", null)
    .order("posted_date", { ascending: false, nullsFirst: false })
    .order("id")
    .limit(LIMIT);
  if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
  const notices = (data ?? []) as NoticeRecord[];
  const missing = EXTRACT.filter((n) => !notices.some((x) => x.opportunity_number?.toUpperCase() === n));
  if (missing.length) {
    const { data: extra, error: e2 } = await supabase.from("funding_opportunities").select(NOTICE_COLUMNS).in("opportunity_number", missing).not("guide_sections", "is", null);
    if (e2) throw new Error(`funding_opportunities read failed: ${e2.message}`);
    notices.push(...((extra ?? []) as NoticeRecord[]));
  }
  console.log(`${notices.length} open NIH notices with Guide sections (newest posted first, limit ${LIMIT}${missing.length ? ` + ${missing.length} named for extraction` : ""})`);

  let calls = 0;
  const real = EXTRACT.length ? openaiExtractor() : null;
  const counted: ModelFn | null = real
    ? async (req) => {
        calls += 1;
        if (calls > MAX_CALLS) throw new Error(`model call cap of ${MAX_CALLS} reached`);
        return real(req);
      }
    : null;
  if (real && !process.env.OPENAI_API_KEY?.trim()) {
    console.error("OPENAI_API_KEY missing in .env.local");
    process.exit(1);
  }
  const extractionCache = new InMemoryNoticeExtractionCache();
  const budget = new ModelBudget(MAX_CALLS);
  const rows: OpportunityFitProfileRow[] = [];
  const started = Date.now();
  let extracted = 0;
  for (const n of notices) {
    const withExtractor = counted !== null && EXTRACT.includes((n.opportunity_number ?? "").toUpperCase());
    line(`── ${n.opportunity_number} · ${n.title.slice(0, 90)} `);
    const exemplars = n.opportunity_number ? await loadExemplars(supabase, n.opportunity_number) : [];
    const t0 = Date.now();
    const build = await buildOpportunityFitProfileFrom({ notice: n, exemplars }, { rules, extractor: withExtractor ? counted : null, classifier: null, extractionCache, budget });
    rows.push(build.row);
    if (withExtractor) extracted += 1;
    console.log(`  ${Date.now() - t0} ms${withExtractor ? ` · extractor calls so far ${calls}` : ""}`);
    printProfile(build, withExtractor);
  }
  line("── summary ");
  const conf = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.confidence]: (acc[r.confidence] ?? 0) + 1 }), {});
  const withReq = rows.filter((r) => Object.keys(r.profile.paradigm.required).length + Object.keys(r.profile.paradigm.required_any).length > 0).length;
  const withEx = rows.filter((r) => r.sources.blend.exemplar > 0).length;
  console.log(`${rows.length} profiles built in memory (${extracted} with the real extractor); confidence ${JSON.stringify(conf)}; ${withReq} carry a paradigm requirement; ${withEx} blend exemplars (w_e > 0); model calls ${calls} (cap ${MAX_CALLS}); ${Date.now() - started} ms; database: read only, nothing written`);
}

async function fixtures(): Promise<void> {
  const { buildMeshIndex } = await import("../src/lib/fit/classify/mesh");
  const subset = (await import("../src/lib/fit/__fixtures__/mesh-descriptors-subset.json")).default as { descriptors: Parameters<typeof buildMeshIndex>[0] };
  const ctx: EvaluateContext = { mesh: buildMeshIndex(subset.descriptors), tables: DEFAULT_RULE_TABLES };
  const rules = (item: Parameters<typeof evaluateRules>[0]) => evaluateRules(item, ctx);
  console.log(`fit:opportunity-report · FIXTURES · the six prompt-spec notices through the mocked extractor · taxonomy ${TAXONOMY_VERSION} · no network, no database`);
  let ok = 0;
  for (const f of NOTICE_FIXTURES) {
    line(`── fixture ${f.n} · ${f.label} · ${f.notice.opportunity_number} `);
    const { fn } = fixtureModel(f);
    const build = await buildOpportunityFitProfileFrom({ notice: f.notice, exemplars: f.exemplars }, { rules, extractor: fn, extractModel: "mock", classifier: null });
    printProfile(build, false);
    const checks = checkNoticeFixture(build, f.expect);
    for (const l of formatNoticeChecks(checks)) console.log(`  ${l}`);
    const misses = checks.filter((c) => !c.ok).length;
    if (misses === 0) ok += 1;
    console.log(`  ${misses === 0 ? "ALL EXPECTATIONS MET" : `${misses} MISS`}`);
  }
  line("── summary ");
  console.log(`${ok}/${NOTICE_FIXTURES.length} fixtures meet every expectation`);
}

async function report(): Promise<void> {
  const supabase = db();
  console.log(`fit:opportunity-report · STORED PROFILES · ${new Date().toISOString()}`);
  const { data, error } = await supabase.from("opportunity_fit_profiles").select("opportunity_id, taxonomy_version, profile, confidence, sources, guide_html_hash, computed_at").order("computed_at", { ascending: false }).limit(500);
  if (error) {
    if (/opportunity_fit_profiles/.test(error.message) || error.code === "42P01" || error.code === "PGRST205") {
      console.log("opportunity_fit_profiles is not on the database yet (apply supabase/migrations/20260915110000_fit_opportunity_profiles.sql); nothing to report");
      return;
    }
    throw new Error(`opportunity_fit_profiles read failed: ${error.message}`);
  }
  const rows = (data ?? []) as OpportunityFitProfileRow[];
  if (!rows.length) {
    console.log("opportunity_fit_profiles is empty — the fit-profiles cron has not built any notice profile yet");
    return;
  }
  const conf = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.confidence]: (acc[r.confidence] ?? 0) + 1 }), {});
  console.log(`${rows.length} stored profiles · confidence ${JSON.stringify(conf)} · needs_review ${rows.filter((r) => r.profile.needs_review).length} · text ${JSON.stringify(rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.sources.text]: (acc[r.sources.text] ?? 0) + 1 }), {}))}`);
  for (const r of rows) {
    const p: OpportunityFitProfile = r.profile;
    console.log(`${p.number.padEnd(16)} ${r.confidence.padEnd(6)} ${p.mechanism.activity_code ?? "?"} CT ${p.mechanism.clinical_trial} · required ${weights(p.paradigm.required, 3)}${Object.keys(p.paradigm.required_any).length ? ` · any ${weights(p.paradigm.required_any, 3)}` : ""} · excluded ${weights(p.paradigm.excluded, 3)} · designs ${list(p.design.required_any)} · exemplars ${p.sources.exemplar_count}${p.needs_review ? " · NEEDS REVIEW" : ""} · ${r.computed_at.slice(0, 10)}`);
  }
}

(REPORT ? report() : FIXTURES ? fixtures() : dryRun()).catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
