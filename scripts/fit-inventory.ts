/**
 * Fit engine · PR 0.1 data inventory. READ-ONLY.
 *
 * Reproduces the nine sections of docs/fit-engine/queries/inventory.sql through
 * PostgREST reads (supabase-js cannot run raw SQL and the repo has no exec-SQL
 * RPC), aggregates in TypeScript, and writes a Markdown report.
 *
 *   npm run fit:inventory -- --print-sql        # print inventory.sql verbatim, no DB access
 *   npm run fit:inventory                       # run reads, write docs/fit-engine/INVENTORY.md
 *   npm run fit:inventory -- --out /tmp/inv.md  # write elsewhere
 *   npm run fit:inventory -- --stdout           # print the Markdown, write nothing
 *
 * Nothing here writes to the database: only select() and count() calls are used.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SQL_PATH = path.join("docs", "fit-engine", "queries", "inventory.sql");
const DEFAULT_OUT = path.join("docs", "fit-engine", "INVENTORY.md");

const args = process.argv.slice(2);
const printSql = args.includes("--print-sql");
const toStdout = args.includes("--stdout");
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT;

// --print-sql needs no environment and must emit only the SQL (so it can be piped).
if (printSql) {
  process.stdout.write(readFileSync(SQL_PATH, "utf8"));
  process.exit(0);
}

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Db = SupabaseClient;

type QueryResult = { data: unknown; count: number | null; error: { message: string } | null };
/**
 * The slice of the PostgREST builder this script uses, typed structurally.
 * supabase-js types a dynamic column string as an error sentinel, which makes
 * the generic builder unusable for a helper that takes the columns as input.
 */
interface Query extends PromiseLike<QueryResult> {
  is(column: string, value: null): Query;
  eq(column: string, value: string): Query;
  neq(column: string, value: string): Query;
  or(filters: string): Query;
  range(from: number, to: number): Query;
}
type Filter = (q: Query) => Query;

function select(db: Db, table: string, columns: string, opts?: { count: "exact"; head: boolean }): Query {
  return (opts ? db.from(table).select(columns, opts) : db.from(table).select(columns)) as unknown as Query;
}

const PAGE = 1000;

/** Page through a select() so PostgREST's row cap does not truncate counts. */
async function fetchAll(
  db: Db,
  table: string,
  columns: string,
  filter?: Filter,
  pageSize = PAGE,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    let q = select(db, table, columns);
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function countWhere(db: Db, table: string, filter?: Filter): Promise<number> {
  let q = select(db, table, "*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

function groupCount<T>(items: T[], keyOf: (t: T) => string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = keyOf(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Postgres percentile_cont(0.5): linear interpolation between the two middle values. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return lo === hi ? s[lo] : (s[lo] + s[hi]) / 2;
}

function has(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

function str(v: unknown): string {
  return v === null || v === undefined ? "∅ (null)" : String(v);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "[]";
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Vertical key/value table for single-row summaries. */
function kv(pairs: Array<[string, unknown]>): string {
  return ["| Metric | Value |", "|---|---|", ...pairs.map(([k, v]) => `| ${k} | ${fmt(v)} |`)].join("\n");
}

function table(headers: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "_(no rows)_";
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(fmt).join(" | ")} |`),
  ].join("\n");
}

function getPath(obj: unknown, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Row)[k];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Sections (numbered as in inventory.sql)
// ---------------------------------------------------------------------------

async function run(db: Db): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  out.push(`# Fit engine · data inventory (PR 0.1)`);
  out.push("");
  out.push(
    `Generated ${new Date().toISOString()} by \`npm run fit:inventory\` from \`docs/fit-engine/queries/inventory.sql\`. ` +
      `Read-only. "Open" notices = close_date, next_due or expiration_date on/after ${today}.`,
  );
  out.push("");

  // 1. Directory and identity coverage --------------------------------------
  const investigators = await fetchAll(
    db,
    "investigators",
    "id, nih_profile_id, orcid, profiles_url_name, research_community_id",
    (q) => q.is("archived_at", null),
  );
  out.push("## 1. Directory and identity coverage");
  out.push("");
  out.push(
    kv([
      ["investigators (not archived)", investigators.length],
      ["with_nih_profile_id", investigators.filter((r) => has(r.nih_profile_id)).length],
      ["with_orcid", investigators.filter((r) => has(r.orcid)).length],
      ["with_profiles_url", investigators.filter((r) => has(r.profiles_url_name)).length],
      ["in_a_community", investigators.filter((r) => has(r.research_community_id)).length],
    ]),
  );
  out.push("");

  // 2. Evidence per investigator --------------------------------------------
  const pubs = await fetchAll(db, "investigator_publications", "investigator_id, identity_status");
  const grants = await fetchAll(
    db,
    "investigator_nih_grants",
    "investigator_id, is_active",
    (q) => q.neq("identity_status", "rejected"),
  );
  const trials = await fetchAll(db, "investigator_clinical_trials", "investigator_id");

  const perInv = new Map<string, { pv: number; pu: number; g: number; ga: number; t: number }>();
  const bucket = (id: unknown) => {
    const k = String(id);
    let b = perInv.get(k);
    if (!b) {
      b = { pv: 0, pu: 0, g: 0, ga: 0, t: 0 };
      perInv.set(k, b);
    }
    return b;
  };
  for (const p of pubs) {
    const b = bucket(p.investigator_id);
    if (p.identity_status === "verified") b.pv += 1;
    else if (p.identity_status === "unverified") b.pu += 1;
  }
  for (const g of grants) {
    const b = bucket(g.investigator_id);
    b.g += 1;
    if (g.is_active === true) b.ga += 1;
  }
  for (const t of trials) bucket(t.investigator_id).t += 1;

  const active = investigators.map((i) => perInv.get(String(i.id)) ?? { pv: 0, pu: 0, g: 0, ga: 0, t: 0 });
  out.push("## 2. Evidence per investigator (verified publications, grants, trials)");
  out.push("");
  out.push(
    kv([
      ["investigators", active.length],
      ["median_pubs_verified", median(active.map((a) => a.pv))],
      ["no_verified_pubs", active.filter((a) => a.pv === 0).length],
      ["pubs_10_plus", active.filter((a) => a.pv >= 10).length],
      ["with_any_grant", active.filter((a) => a.g > 0).length],
      ["with_active_grant", active.filter((a) => a.ga > 0).length],
      ["with_any_trial", active.filter((a) => a.t > 0).length],
      ["(rows scanned) publications / grants (not rejected) / trials", `${pubs.length} / ${grants.length} / ${trials.length}`],
    ]),
  );
  out.push("");

  // 3. Source states ---------------------------------------------------------
  const sources = await fetchAll(db, "investigator_sources", "source, state");
  const srcRows = groupCount(sources, (s) => `${s.source} ${s.state}`)
    .map(([k, n]) => [...k.split(" "), n])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  out.push("## 3. Source states (biosketch, profiles, orcid, reporter, pubmed)");
  out.push("");
  out.push(table(["source", "state", "count"], srcRows));
  out.push("");

  // 4. Notice corpus ---------------------------------------------------------
  const openFilter = `close_date.gte.${today},next_due.gte.${today},expiration_date.gte.${today}`;
  const open = await fetchAll(
    db,
    "funding_opportunities",
    "opportunity_number, agency_code, guide_fetch_status, title, reissue_of, activity_code, description",
    (q) => q.or(openFilter),
    500,
  );
  const titleHas = (needle: string) => open.filter((r) => String(r.title ?? "").toLowerCase().includes(needle)).length;
  out.push("## 4. Notice corpus: open notices, NIH share, Guide coverage, clinical-trial designation from title");
  out.push("");
  out.push(
    kv([
      ["open_notices", open.length],
      [
        "nih_like",
        open.filter(
          (r) => String(r.agency_code ?? "").startsWith("HHS-NIH") || /^(PA|PAR|RFA)-/.test(String(r.opportunity_number ?? "")),
        ).length,
      ],
      ["guide_ok", open.filter((r) => r.guide_fetch_status === "ok").length],
      ["guide_not_found", open.filter((r) => r.guide_fetch_status === "not_found").length],
      ["guide_never_fetched", open.filter((r) => r.guide_fetch_status === null || r.guide_fetch_status === undefined).length],
      ["ct_required", titleHas("clinical trial required")],
      ["ct_optional", titleHas("clinical trial optional")],
      ["ct_not_allowed", titleHas("clinical trial not allowed")],
      ["besh", titleHas("basic experimental studies with humans")],
      ["reissues", open.filter((r) => has(r.reissue_of)).length],
      ["with_activity_code", open.filter((r) => has(r.activity_code)).length],
      ["median_description_chars", median(open.map((r) => String(r.description ?? "").length))],
    ]),
  );
  out.push("");

  // 5. Activity-code mix -----------------------------------------------------
  const codes = groupCount(
    open.filter((r) => has(r.activity_code)),
    (r) => String(r.activity_code),
  ).slice(0, 30);
  out.push("## 5. Activity-code mix among open notices (top 30)");
  out.push("");
  out.push(table(["activity_code", "count"], codes));
  out.push("");

  // 6. Embedding coverage ----------------------------------------------------
  const EVIDENCE_KINDS = ["publication", "grant", "biosketch", "profile", "focus", "trial"];
  const kindCounts: Array<[string, number]> = [];
  for (const k of EVIDENCE_KINDS) {
    kindCounts.push([k, await countWhere(db, "evidence_embeddings", (q) => q.eq("kind", k))]);
  }
  out.push("## 6. Embedding coverage (what the current engine can see)");
  out.push("");
  out.push(
    kv([
      ["investigators_embedded", await countWhere(db, "investigator_embeddings")],
      ["notices_embedded", await countWhere(db, "opportunity_embeddings")],
      ["evidence_items_embedded", await countWhere(db, "evidence_embeddings")],
      ["evidence_kinds (distinct, non-empty)", kindCounts.filter(([, n]) => n > 0).length],
    ]),
  );
  out.push("");
  out.push(table(["evidence kind", "count"], kindCounts));
  out.push("");

  // 7. Feedback already collected -------------------------------------------
  const suggestions = await fetchAll(db, "outreach_suggestions", "status, dismissed_reason");
  const items = await fetchAll(db, "outreach_items", "stage");
  const recipients = await fetchAll(db, "outreach_recipients", "status", (q) => q.is("removed_at", null));
  out.push("## 7. Feedback already collected");
  out.push("");
  out.push("### 7a. outreach_suggestions · dismissed, by reason");
  out.push("");
  out.push(
    table(
      ["dismissed_reason", "count"],
      groupCount(suggestions.filter((s) => s.status === "dismissed"), (s) => str(s.dismissed_reason)),
    ),
  );
  out.push("");
  out.push("### 7b. outreach_suggestions · by status");
  out.push("");
  out.push(table(["status", "count"], groupCount(suggestions, (s) => str(s.status))));
  out.push("");
  out.push("### 7c. outreach_items · by stage");
  out.push("");
  out.push(table(["stage", "count"], groupCount(items, (i) => str(i.stage))));
  out.push("");
  out.push("### 7d. outreach_recipients (not removed) · by status");
  out.push("");
  out.push(table(["status", "count"], groupCount(recipients, (r) => str(r.status))));
  out.push("");

  // 8. Raw-row field checks --------------------------------------------------
  const { data: rawGrants, error: rgErr } = await db
    .from("investigator_nih_grants")
    .select("project_num, raw_json")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (rgErr) throw new Error(`investigator_nih_grants raw: ${rgErr.message}`);
  const { data: rawTrials, error: rtErr } = await db
    .from("investigator_clinical_trials")
    .select("nct_id, raw_json")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (rtErr) throw new Error(`investigator_clinical_trials raw: ${rtErr.message}`);

  out.push("## 8. Raw-row field checks (the Phase 0 backfills depend on these)");
  out.push("");
  out.push("### 8a. RePORTER · 5 most recently updated grants");
  out.push("");
  out.push(
    table(
      ["project_num", "has_abstract", "has_phr", "has_rcdc", "has_study_section", "has_pis", "has_terms"],
      ((rawGrants ?? []) as Row[]).map((r) => {
        const j = (r.raw_json ?? {}) as Row;
        return [
          r.project_num,
          "abstract_text" in j,
          "phr_text" in j,
          "spending_categories_desc" in j,
          "full_study_section" in j,
          "principal_investigators" in j,
          "terms" in j,
        ];
      }),
    ),
  );
  out.push("");
  out.push("### 8b. ClinicalTrials.gov · 5 most recently updated trials");
  out.push("");
  out.push(
    table(
      ["nct_id", "study_type", "phases", "primary_purpose", "observational_model", "enrollment", "officials"],
      ((rawTrials ?? []) as Row[]).map((r) => {
        const j = r.raw_json;
        const officials = getPath(j, ["protocolSection", "contactsLocationsModule", "overallOfficials"]);
        return [
          r.nct_id,
          getPath(j, ["protocolSection", "designModule", "studyType"]) ?? null,
          getPath(j, ["protocolSection", "designModule", "phases"]) ?? null,
          getPath(j, ["protocolSection", "designModule", "designInfo", "primaryPurpose"]) ?? null,
          getPath(j, ["protocolSection", "designModule", "designInfo", "observationalModel"]) ?? null,
          getPath(j, ["protocolSection", "designModule", "enrollmentInfo", "count"]) ?? null,
          Array.isArray(officials) ? officials.length : 0,
        ];
      }),
    ),
  );
  out.push("");

  // 9. Communities and teams -------------------------------------------------
  const communities = await fetchAll(db, "pipeline_communities", "id, label, monitored, active");
  const members = groupCount(
    investigators.filter((i) => has(i.research_community_id)),
    (i) => String(i.research_community_id),
  );
  const memberCount = new Map(members);
  const communityRows = communities
    .map((c) => [c.label, c.monitored, c.active, memberCount.get(String(c.id)) ?? 0])
    .sort((a, b) => Number(b[3]) - Number(a[3]));
  const teams = await fetchAll(db, "teams", "id, name");
  out.push("## 9. Communities and teams (pilot selection; feature flag lives on teams)");
  out.push("");
  out.push(table(["label", "monitored", "active", "members"], communityRows));
  out.push("");
  out.push(table(["team id", "name"], teams.map((t) => [t.id, t.name])));
  out.push("");

  return out.join("\n");
}

run(supabase)
  .then((md) => {
    if (toStdout) {
      process.stdout.write(md + "\n");
    } else {
      writeFileSync(outPath, md + "\n");
      console.log(md);
      console.log(`\nWrote ${outPath}`);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
