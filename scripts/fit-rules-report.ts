/**
 * Fit engine · PR 1.2 · what the rule classifier does over the roster's
 * evidence. Read-only: pages every verified publication, grant and trial row
 * for the non-archived roster (plus the directory / self-declared item and the
 * biosketch and Profiles source rows per investigator), normalizes each,
 * evaluates signal-mapping.json, and prints per-rule fire counts, per-axis
 * coverage by item kind, the categories the rules reach most, the refine keys
 * that applied, and the study-section / division keys the tables do not know.
 * Nothing is written.
 *
 *   npm run fit:rules-report                          # the whole roster
 *   npm run fit:rules-report -- --investigator <uuid> # one person
 *   npm run fit:rules-report -- --limit 200           # at most N rows per evidence table (a quick look)
 *   npm run fit:rules-report -- --json                # the summary as JSON on stdout instead of markdown
 *
 * A row that fails to normalize — a MeSH UI the descriptor table does not
 * carry, a bad table entry — is listed at the end and the script exits 2: a
 * stale descriptor table must be loud, but one bad row must not hide the
 * report for the other fifteen thousand.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadMeshIndex } from "../src/lib/fit/classify/mesh-db";
import {
  normalizeBiosketch,
  normalizeDirectory,
  normalizeGrant,
  normalizeProfiles,
  normalizePublication,
  normalizeSelfDeclared,
  normalizeTrial,
  type BiosketchSourceRow,
  type GrantRow,
  type InvestigatorRow,
  type NormalizedItem,
  type NormalizedItemKind,
  type ProfilesSourceRow,
  type PublicationRow,
  type TrialRow,
} from "../src/lib/fit/classify/normalize";
import { DEFAULT_RULE_TABLES, evaluateRules, type EvaluateContext } from "../src/lib/fit/classify/rules";
import { formatRulesReport, summarizeRuleRuns, type RuleRun, type RuleRunFailure } from "../src/lib/fit/classify/rules-report";
import { splitDirectorySignals } from "../src/lib/fit/profile/investigator";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const INVESTIGATOR = opt("--investigator") ?? null;
const LIMIT = opt("--limit") ? Number(opt("--limit")) : null;
const JSON_OUT = flag("--json");
const PAGE = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

/** Page a table read-only; `build` adds the filters. Stops early at --limit. */
async function pageAll<T>(table: string, columns: string, order: string[], build?: (q: Query) => Query): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q: Query = supabase.from(table).select(columns);
    if (build) q = build(q);
    for (const col of order) q = q.order(col);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (LIMIT != null && rows.length >= LIMIT) return rows.slice(0, LIMIT);
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

type RosterRow = InvestigatorRow & { archived_at?: string | null };

async function main(): Promise<void> {
  const mesh = await loadMeshIndex(supabase);
  console.error(`mesh_descriptors: ${mesh.byUi.size} rows`);
  const ctx: EvaluateContext = { mesh, tables: DEFAULT_RULE_TABLES };

  const roster = await pageAll<RosterRow>(
    "investigators",
    "id, full_name, home_department, division, rank, title_series, degrees, self_declared_axes, aspirations, do_not_suggest, raw_profile_json",
    ["id"],
    (q) => {
      q = q.is("archived_at", null);
      if (INVESTIGATOR) q = q.eq("id", INVESTIGATOR);
      return q;
    }
  );
  const rosterIds = new Set(roster.map((r) => r.id));
  const byId = new Map(roster.map((r) => [r.id, r]));
  console.error(`roster: ${roster.length} investigators${INVESTIGATOR ? ` (--investigator ${INVESTIGATOR})` : ""}`);

  const onRoster = (q: Query): Query => {
    q = q.eq("identity_status", "verified");
    if (INVESTIGATOR) q = q.eq("investigator_id", INVESTIGATOR);
    return q;
  };

  const publications = (
    await pageAll<PublicationRow>(
      "investigator_publications",
      "investigator_id, pmid, title, publication_date, mesh, publication_types, abstract, author_position, author_position_method, identity_method, identity_status, mesh_fetch_outcome",
      ["investigator_id", "pmid"],
      onRoster
    )
  ).filter((r) => rosterIds.has(r.investigator_id));
  const grants = (
    await pageAll<GrantRow & { investigator_id: string }>(
      "investigator_nih_grants",
      "id, investigator_id, project_num, project_title, fiscal_year, activity_code, rcdc_categories, study_section, study_section_code, is_contact_pi, abstract, phr_text, identity_status, raw_json",
      ["investigator_id", "id"],
      onRoster
    )
  ).filter((r) => rosterIds.has(r.investigator_id));
  const trials = (
    await pageAll<TrialRow>(
      "investigator_clinical_trials",
      "investigator_id, nct_id, title, start_date, brief_summary, study_type, phases, primary_purpose, allocation, intervention_model, observational_model, time_perspective, enrollment, intervention_types, investigator_role, identity_status",
      ["investigator_id", "nct_id"],
      onRoster
    )
  ).filter((r) => rosterIds.has(r.investigator_id));
  const sources = (
    await pageAll<{ investigator_id: string; source: string; last_refreshed_at: string | null; document_date?: string | null; personal_statement?: string | null; contributions?: unknown; meta?: unknown }>(
      "investigator_sources",
      "investigator_id, source, last_refreshed_at, document_date, personal_statement, contributions, meta",
      ["investigator_id", "source"],
      (q) => {
        q = q.in("source", ["biosketch", "profiles"]);
        if (INVESTIGATOR) q = q.eq("investigator_id", INVESTIGATOR);
        return q;
      }
    )
  ).filter((r) => rosterIds.has(r.investigator_id));
  console.error(`verified rows: ${publications.length} publications, ${grants.length} grants, ${trials.length} trials; ${sources.length} biosketch / profiles source rows${LIMIT != null ? ` (--limit ${LIMIT} per table)` : ""}`);

  const runs: RuleRun[] = [];
  const failures: RuleRunFailure[] = [];
  const attempt = (id: string, kind: NormalizedItemKind, build: () => NormalizedItem | NormalizedItem[]) => {
    try {
      const items = build();
      for (const item of Array.isArray(items) ? items : [items]) runs.push({ item, result: evaluateRules(item, ctx) });
    } catch (e) {
      failures.push({ id, kind, error: e instanceof Error ? e.message : String(e) });
    }
  };

  for (const row of publications) attempt(`publication:${row.investigator_id}:${row.pmid}`, "publication", () => normalizePublication(row, { id: row.investigator_id }, { mesh }));
  for (const row of grants) attempt(`grant:${row.id}`, "grant", () => normalizeGrant(row));
  for (const row of trials) attempt(`trial:${row.investigator_id}:${row.nct_id}`, "trial", () => normalizeTrial(row));
  const profilesByInv = new Map<string, ProfilesSourceRow>();
  for (const row of sources) {
    if (row.source === "biosketch") attempt(`biosketch:${row.investigator_id}`, "biosketch_statement", () => normalizeBiosketch(row as BiosketchSourceRow));
    else profilesByInv.set(row.investigator_id, row as ProfilesSourceRow);
  }
  // The same items the profile build makes (PR 1.4 collectEvidence): the
  // department / division signals sit on the directory item alone, so
  // `directory_epi_dept` counts once, under `directory`.
  for (const inv of roster) {
    attempt(`profiles:${inv.id}`, "profiles_narrative", () => splitDirectorySignals(normalizeProfiles(profilesByInv.get(inv.id) ?? null, inv)));
    attempt(`self_declared:${inv.id}`, "self_declared", () => normalizeSelfDeclared(byId.get(inv.id)!));
    attempt(`directory:${inv.id}`, "directory", () => normalizeDirectory(inv));
  }

  const summary = summarizeRuleRuns(runs, failures);
  if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
  else console.log(`# fit:rules-report — ${new Date().toISOString()}\n\n${formatRulesReport(summary)}`);
  if (failures.length) {
    console.error(`${failures.length} rows failed to normalize or evaluate (listed above)`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
