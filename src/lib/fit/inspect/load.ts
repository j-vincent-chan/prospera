/**
 * Supabase reads behind the inspector pages (plan § PR 1.6). Server-side
 * only; the view models in this directory are pure and get these results.
 * Nothing here calls a model, and nothing writes — the flag action is the
 * one writer (src/app/actions/fit-inspector-actions.ts).
 *
 * `fit_labels` may not be on the database yet (the migration is written, not
 * applied): every read of it answers `available: false` instead of throwing,
 * so the pages render without the flag list until it lands.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evidenceKeys, type EvidenceLookup, type GrantLookupRow, type PublicationLookupRow, type TrialLookupRow } from "@/lib/fit/inspect/evidence";
import { FLAG_SOURCE, flagView, sortFlags, type FitLabelRow, type FlagView } from "@/lib/fit/inspect/flags";
import { flagCounts, investigatorIndexRows, opportunityIndexRows, type InvestigatorIndexInput, type InvestigatorIndexRow, type OpportunityIndexInput, type OpportunityIndexRow, type OpportunityNoticeInfo } from "@/lib/fit/inspect/index-view";
import { investigatorProfileView, type InvestigatorProfileView } from "@/lib/fit/inspect/investigator-view";
import { opportunityProfileView, type OpportunityProfileView } from "@/lib/fit/inspect/opportunity-view";
import type { StoredProfileRow } from "@/lib/fit/profile/investigator";
import type { OpportunityFitProfileRow } from "@/lib/fit/profile/opportunity";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

/** PostgREST's message for a table the schema cache does not know (the migration not applied yet) — the 1.4 regex, kept here so the pages and the action do not pull the builder module in. */
export const MISSING_TABLE_RE = /could not find the table|relation .* does not exist|schema cache/i;

export const FIT_LABELS_MIGRATION = "supabase/migrations/20260916100000_fit_labels.sql";

/** The index pages through PostgREST's 1,000-row cap (`fetchAllRows`) up to this many rows per table; past it the page says so. */
export const INDEX_MAX_ROWS = 20_000;

export type InspectorFlags = {
  /** False when `fit_labels` is not on the database yet. */
  available: boolean;
  rows: FlagView[];
  error: string | null;
};

const FLAG_COLUMNS = "id, investigator_id, opportunity_id, tier, reason, axis_reason, labeler, engine_version, source, created_at";

async function labelerNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  if (!ids.length) return names;
  const { data } = await db.from("profiles").select("id, full_name, email").in("id", ids);
  for (const r of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) names.set(r.id, r.full_name?.trim() || r.email || null);
  return names;
}

/** The profile flags on one subject, newest first, with the labeler's name. */
export async function loadFlags(db: SupabaseClient, subject: { investigatorId?: string; opportunityId?: string }): Promise<InspectorFlags> {
  let q = db.from("fit_labels").select(FLAG_COLUMNS).eq("source", FLAG_SOURCE).order("created_at", { ascending: false }).limit(200);
  if (subject.investigatorId) q = q.eq("investigator_id", subject.investigatorId);
  else if (subject.opportunityId) q = q.eq("opportunity_id", subject.opportunityId);
  else return { available: true, rows: [], error: null };
  const { data, error } = await q;
  if (error) {
    if (MISSING_TABLE_RE.test(error.message)) return { available: false, rows: [], error: null };
    return { available: true, rows: [], error: error.message };
  }
  const rows = sortFlags((data ?? []) as FitLabelRow[]);
  const names = await labelerNames(db, Array.from(new Set(rows.map((r) => r.labeler).filter((x): x is string => Boolean(x)))));
  return { available: true, rows: rows.map((r) => flagView(r, r.labeler ? names.get(r.labeler) : null)), error: null };
}

async function loadEvidenceLookup(db: SupabaseClient, investigatorId: string, ids: Iterable<string>): Promise<EvidenceLookup> {
  const keys = evidenceKeys(ids);
  const [pubs, grants, trials] = await Promise.all([
    keys.pmids.length ? db.from("investigator_publications").select("pmid, title, journal, publication_date").eq("investigator_id", investigatorId).in("pmid", keys.pmids) : Promise.resolve({ data: [] as PublicationLookupRow[] }),
    keys.grantIds.length ? db.from("investigator_nih_grants").select("id, project_num, project_title, fiscal_year, activity_code").in("id", keys.grantIds) : Promise.resolve({ data: [] as GrantLookupRow[] }),
    keys.nctIds.length ? db.from("investigator_clinical_trials").select("nct_id, title, start_date").eq("investigator_id", investigatorId).in("nct_id", keys.nctIds) : Promise.resolve({ data: [] as TrialLookupRow[] }),
  ]);
  return {
    publications: new Map(((pubs.data ?? []) as PublicationLookupRow[]).map((r) => [r.pmid, r])),
    grants: new Map(((grants.data ?? []) as GrantLookupRow[]).map((r) => [r.id, r])),
    trials: new Map(((trials.data ?? []) as TrialLookupRow[]).map((r) => [r.nct_id, r])),
  };
}

export type InvestigatorInspection = {
  investigator: { id: string; full_name: string } | null;
  /** Null when no profile row exists (or the profiles table is not on the database). */
  view: InvestigatorProfileView | null;
  profileTableMissing: boolean;
  flags: InspectorFlags;
};

/** The investigator, its stored profile resolved for the page, and its flags. */
export async function loadInvestigatorInspection(db: SupabaseClient, id: string): Promise<InvestigatorInspection> {
  const [inv, prof, flags] = await Promise.all([
    db.from("investigators").select("id, full_name").eq("id", id).is("archived_at", null).maybeSingle(),
    db.from("investigator_fit_profiles").select("investigator_id, taxonomy_version, profile, confidence, item_count, pending_items, computed_at").eq("investigator_id", id).maybeSingle(),
    loadFlags(db, { investigatorId: id }),
  ]);
  const investigator = (inv.data as { id: string; full_name: string } | null) ?? null;
  const profileTableMissing = Boolean(prof.error && MISSING_TABLE_RE.test(prof.error.message));
  const row = (prof.data as StoredProfileRow | null) ?? null;
  if (!row) return { investigator, view: null, profileTableMissing, flags };
  const ids = new Set<string>();
  for (const p of row.profile?.provenance ?? []) for (const item of p.top_items ?? []) ids.add(item);
  const lookup = await loadEvidenceLookup(db, id, ids);
  return { investigator, view: investigatorProfileView(row, lookup), profileTableMissing, flags };
}

export type OpportunityInspection = {
  notice: { id: string; opportunity_number: string | null; title: string; clinical_trial_designation: string | null } | null;
  view: OpportunityProfileView | null;
  profileTableMissing: boolean;
  flags: InspectorFlags;
};

/** The notice, its stored profile resolved for the page, and its flags. */
export async function loadOpportunityInspection(db: SupabaseClient, id: string): Promise<OpportunityInspection> {
  const [opp, prof, flags] = await Promise.all([
    db.from("funding_opportunities").select("id, opportunity_number, title, clinical_trial_designation").eq("id", id).maybeSingle(),
    db.from("opportunity_fit_profiles").select("opportunity_id, taxonomy_version, profile, confidence, sources, guide_html_hash, computed_at").eq("opportunity_id", id).maybeSingle(),
    loadFlags(db, { opportunityId: id }),
  ]);
  const notice = (opp.data as OpportunityInspection["notice"]) ?? null;
  const profileTableMissing = Boolean(prof.error && MISSING_TABLE_RE.test(prof.error.message));
  const row = (prof.data as OpportunityFitProfileRow | null) ?? null;
  return { notice, view: row ? opportunityProfileView(row) : null, profileTableMissing, flags };
}

export type InspectorIndex = {
  investigators: InvestigatorIndexRow[];
  opportunities: OpportunityIndexRow[];
  /** `fit_labels` on the database. */
  flagsAvailable: boolean;
  /** Profile tables the database does not have yet (before their migrations). */
  tablesMissing: string[];
  errors: string[];
};

type FlagCountRow = { investigator_id: string | null; opportunity_id: string | null };

/** Everything the spot-check index shows: slim JSON-path selects paged past PostgREST's 1,000-row cap, names and titles, flag counts. */
export async function loadInspectorIndex(db: SupabaseClient): Promise<InspectorIndex> {
  const page = async <T,>(from: number, to: number, run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await run();
    return { data: (data ?? null) as T[] | null, error };
  };
  const [inv, opp, labels] = await Promise.all([
    fetchAllRows<InvestigatorIndexInput>(
      (from, to) => page(from, to, () => db.from("investigator_fit_profiles").select("investigator_id, confidence, item_count, pending_items, computed_at, taxonomy_version, paradigm:profile->paradigm").order("investigator_id").range(from, to)),
      { maxRows: INDEX_MAX_ROWS },
    ),
    fetchAllRows<OpportunityIndexInput>(
      (from, to) =>
        page(from, to, () =>
          db
            .from("opportunity_fit_profiles")
            .select("opportunity_id, confidence, computed_at, taxonomy_version, number:profile->>number, paradigm:profile->paradigm, needs_review:profile->needs_review, complete:sources->complete, text:sources->>text")
            .order("opportunity_id")
            .range(from, to),
        ),
      { maxRows: INDEX_MAX_ROWS },
    ),
    fetchAllRows<FlagCountRow>((from, to) => page(from, to, () => db.from("fit_labels").select("investigator_id, opportunity_id").eq("source", FLAG_SOURCE).order("id").range(from, to)), { maxRows: INDEX_MAX_ROWS }),
  ]);
  const tablesMissing: string[] = [];
  const errors: string[] = [];
  const missing = (error: string | null, table: string): boolean => {
    if (!error) return false;
    if (MISSING_TABLE_RE.test(error)) tablesMissing.push(table);
    else errors.push(`${table}: ${error}`);
    return true;
  };
  const truncated = (hit: boolean, table: string) => {
    if (hit) errors.push(`${table}: more than ${new Intl.NumberFormat("en-US").format(INDEX_MAX_ROWS)} rows; the index shows the first ${new Intl.NumberFormat("en-US").format(INDEX_MAX_ROWS)} by id`);
  };
  const invRows = missing(inv.error, "investigator_fit_profiles") ? [] : inv.data;
  const oppRows = missing(opp.error, "opportunity_fit_profiles") ? [] : opp.data;
  const flagsAvailable = !missing(labels.error, "fit_labels");
  truncated(inv.truncated, "investigator_fit_profiles");
  truncated(opp.truncated, "opportunity_fit_profiles");
  truncated(labels.truncated, "fit_labels");
  const counts = flagCounts(flagsAvailable ? labels.data : []);

  const [names, notices] = await Promise.all([
    (async () => {
      const map = new Map<string, string | null>();
      const ids = invRows.map((r) => r.investigator_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("investigators").select("id, full_name").in("id", ids.slice(i, i + 200));
        for (const r of (data ?? []) as Array<{ id: string; full_name: string | null }>) map.set(r.id, r.full_name);
      }
      return map;
    })(),
    (async () => {
      const map = new Map<string, OpportunityNoticeInfo>();
      const ids = oppRows.map((r) => r.opportunity_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("funding_opportunities").select("id, opportunity_number, title, clinical_trial_designation").in("id", ids.slice(i, i + 200));
        for (const r of (data ?? []) as Array<{ id: string; opportunity_number: string | null; title: string | null; clinical_trial_designation: string | null }>) map.set(r.id, { opportunity_number: r.opportunity_number, title: r.title, clinical_trial_designation: r.clinical_trial_designation });
      }
      return map;
    })(),
  ]);
  const seen = new Set<string>();
  for (const t of tablesMissing) seen.add(t);
  return {
    investigators: investigatorIndexRows(invRows, names, counts.investigators),
    opportunities: opportunityIndexRows(oppRows, notices, counts.opportunities),
    flagsAvailable,
    tablesMissing: Array.from(seen),
    errors,
  };
}
