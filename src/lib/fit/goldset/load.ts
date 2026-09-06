/**
 * Supabase reads for the gold set (plan § PR 2.4). Read-only: the export and
 * metrics scripts and the labeling page read through these; the only
 * writers are the import script's `--write` and the page's server action,
 * which live elsewhere. `fit_labels` and `fit_results` answer
 * `available: false` while their migrations are not applied (the inspector's
 * treatment), never throw for a missing table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { splitIdentityValues, type GoldLabelRow, type LabelerIdentity } from "@/lib/fit/goldset/labels";
import type { LegacyItem } from "@/lib/fit/goldset/legacy";
import { evidenceKeys, resolveEvidenceId, type EvidenceLookup, type GrantLookupRow, type PublicationLookupRow, type TrialLookupRow } from "@/lib/fit/inspect/evidence";
import { MISSING_TABLE_RE } from "@/lib/fit/inspect/load";
import type { StoredProfileRow } from "@/lib/fit/profile/investigator";
import type { InvestigatorFitProfile, Tier } from "@/lib/fit/types";
import { parseVector } from "@/lib/fit/vectors";
import { openNoticeFilter } from "@/lib/ingestion/reporter/exemplars";

const PAGE = 1000;
const IN_CHUNK = 50;

type Builder = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function pageAll<T>(db: SupabaseClient, table: string, columns: string, build: (q: Builder) => Builder, order: (q: Builder) => Builder, page = PAGE): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await order(build(db.from(table).select(columns))).range(from, from + page - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return rows;
}

const chunks = <T,>(xs: readonly T[], n = IN_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ---------------------------------------------------------------------------
// Roster and notices
// ---------------------------------------------------------------------------

export type GoldsetRosterRow = {
  investigator_id: string;
  name: string;
  profile: InvestigatorFitProfile;
  item_count: number;
  pending_items: number;
  confidence: StoredProfileRow["confidence"] | null;
};

/** Non-archived investigators with a stored fit profile, id order. */
export async function loadGoldsetRoster(db: SupabaseClient): Promise<GoldsetRosterRow[]> {
  type Row = { investigator_id: string; profile: InvestigatorFitProfile | null; item_count: number | null; pending_items: number | null; confidence: StoredProfileRow["confidence"] | null; investigators: { full_name: string | null; archived_at: string | null } | Array<{ full_name: string | null; archived_at: string | null }> | null };
  const rows = await pageAll<Row>(db, "investigator_fit_profiles", "investigator_id, profile, item_count, pending_items, confidence, investigators!inner(full_name, archived_at)", (q) => q.is("investigators.archived_at", null), (q) => q.order("investigator_id"));
  return rows
    .filter((r) => r.profile)
    .map((r) => {
      const inv = Array.isArray(r.investigators) ? r.investigators[0] : r.investigators;
      return { investigator_id: r.investigator_id, name: inv?.full_name?.trim() || r.investigator_id, profile: r.profile!, item_count: r.item_count ?? 0, pending_items: r.pending_items ?? 0, confidence: r.confidence ?? null };
    });
}

export type NoticeExtras = { id: string; clinical_trial_designation: string | null; guide_sections: Array<{ section: string; heading: string; text: string }> | null; description: string | null };

/** Designation, Guide sections and synopsis for the excerpt, by notice id. */
export async function loadNoticeExtras(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, NoticeExtras>> {
  const out = new Map<string, NoticeExtras>();
  for (const slice of chunks(ids)) {
    const { data, error } = await db.from("funding_opportunities").select("id, clinical_trial_designation, guide_sections, description").in("id", slice);
    if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
    for (const r of (data ?? []) as NoticeExtras[]) out.set(r.id, r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vectors (stored; never embedded here) — Float64 everywhere, so the export
// and the metrics compute one and the same cosine (the service's own
// `parseVector` is a number[] of doubles; a Float32 copy would round).
// ---------------------------------------------------------------------------

const toF64 = (raw: unknown): Float64Array | null => {
  const v = parseVector(raw);
  return v ? Float64Array.from(v) : null;
};

/** `investigator_embeddings` document vectors by investigator id. */
export async function loadInvestigatorVectors(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, Float64Array>> {
  const out = new Map<string, Float64Array>();
  for (const slice of chunks(ids)) {
    const { data, error } = await db.from("investigator_embeddings").select("investigator_id, embedding").in("investigator_id", slice);
    if (error) throw new Error(`investigator_embeddings read failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{ investigator_id: string; embedding: unknown }>) {
      const v = toF64(r.embedding);
      if (v) out.set(r.investigator_id, v);
    }
  }
  return out;
}

/**
 * The investigator page's candidate set (rank-opportunities.ts →
 * `match_opportunities(…, only_open = true)`): every open notice — the same
 * `close_date / next_due / expiration_date ≥ today` filter — with an
 * `opportunity_embeddings` row, by notice id. Wider than the profiled
 * corpus: a notice needs no fit profile to be shown by the legacy engine.
 */
export async function loadLegacyCandidates(db: SupabaseClient, today: string): Promise<Map<string, Float64Array>> {
  const open = await pageAll<{ id: string }>(db, "funding_opportunities", "id", (q) => q.or(openNoticeFilter(today)), (q) => q.order("id"));
  const out = new Map<string, Float64Array>();
  for (const slice of chunks(open.map((o) => o.id))) {
    const { data, error } = await db.from("opportunity_embeddings").select("opportunity_id, embedding").in("opportunity_id", slice);
    if (error) throw new Error(`opportunity_embeddings read failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{ opportunity_id: string; embedding: unknown }>) {
      const v = toF64(r.embedding);
      if (v) out.set(r.opportunity_id, v);
    }
  }
  return out;
}

/** `evidence_embeddings` rows (kind, ref_id, vector) grouped by investigator — the legacy rule's items. All rows when `ids` is omitted (paged small, the rows are wide). */
export async function loadEvidenceVectors(db: SupabaseClient, ids?: readonly string[]): Promise<Map<string, LegacyItem[]>> {
  const out = new Map<string, LegacyItem[]>();
  type Row = { investigator_id: string; kind: string; ref_id: string; embedding: unknown };
  const add = (rows: Row[]) => {
    for (const r of rows) {
      const v = toF64(r.embedding);
      if (!v) continue;
      (out.get(r.investigator_id) ?? out.set(r.investigator_id, []).get(r.investigator_id)!).push({ kind: r.kind, ref_id: r.ref_id, vector: v });
    }
  };
  if (ids) {
    for (const slice of chunks(ids, 20)) add(await pageAll<Row>(db, "evidence_embeddings", "investigator_id, kind, ref_id, embedding", (q) => q.in("investigator_id", slice), (q) => q.order("investigator_id").order("kind").order("ref_id"), 200));
  } else {
    add(await pageAll<Row>(db, "evidence_embeddings", "investigator_id, kind, ref_id, embedding", (q) => q, (q) => q.order("investigator_id").order("kind").order("ref_id"), 200));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stored engine outputs
// ---------------------------------------------------------------------------

export type StoredFitTier = { investigator_id: string; opportunity_id: string; tier: Tier };

/** Every `fit_results` row's tier (three columns), or `available: false` before the PR 2.2 migration. */
export async function loadStoredFitTiers(db: SupabaseClient, opts: { tiers?: Tier[]; investigatorIds?: readonly string[] } = {}): Promise<{ rows: StoredFitTier[]; available: boolean }> {
  try {
    const build = (q: Builder) => {
      let b = q;
      if (opts.tiers?.length) b = b.in("tier", opts.tiers);
      return b;
    };
    const order = (q: Builder) => q.order("investigator_id").order("opportunity_id");
    if (opts.investigatorIds) {
      const rows: StoredFitTier[] = [];
      for (const slice of chunks(opts.investigatorIds)) rows.push(...(await pageAll<StoredFitTier>(db, "fit_results", "investigator_id, opportunity_id, tier", (q) => build(q).in("investigator_id", slice), order)));
      return { rows, available: true };
    }
    return { rows: await pageAll<StoredFitTier>(db, "fit_results", "investigator_id, opportunity_id, tier", build, order), available: true };
  } catch (e) {
    if (e instanceof Error && MISSING_TABLE_RE.test(e.message)) return { rows: [], available: false };
    throw e;
  }
}

export type OutreachSnapshot = { investigator_id: string; opportunity_id: string; tier: string; status: string; snapshot_at: string };

/** The legacy Outreach snapshots (`outreach_suggestions` joined to their item's notice), active or added rows. */
export async function loadOutreachSnapshots(db: SupabaseClient): Promise<OutreachSnapshot[]> {
  type Row = { investigator_id: string; tier: string; status: string; snapshot_at: string; outreach_items: { opportunity_id: string } | Array<{ opportunity_id: string }> | null };
  const rows = await pageAll<Row>(db, "outreach_suggestions", "investigator_id, tier, status, snapshot_at, outreach_items!inner(opportunity_id)", (q) => q.in("status", ["active", "added"]), (q) => q.order("snapshot_at", { ascending: false }).order("id"));
  return rows.flatMap((r) => {
    const item = Array.isArray(r.outreach_items) ? r.outreach_items[0] : r.outreach_items;
    return item?.opportunity_id ? [{ investigator_id: r.investigator_id, opportunity_id: item.opportunity_id, tier: r.tier, status: r.status, snapshot_at: r.snapshot_at }] : [];
  });
}

// ---------------------------------------------------------------------------
// Labels and labelers
// ---------------------------------------------------------------------------

export const LABEL_COLUMNS = "id, investigator_id, opportunity_id, tier, reason, axis_reason, labeler, engine_version, source, created_at";

export type GoldLabelsRead = { rows: GoldLabelRow[]; available: boolean; error: string | null };

/** `fit_labels` rows by source (gold by default), oldest first; `available: false` before the PR 1.6 migration. */
export async function loadGoldLabels(db: SupabaseClient, opts: { sources?: string[]; withTier?: boolean } = {}): Promise<GoldLabelsRead> {
  const sources = opts.sources ?? ["gold"];
  try {
    const rows = await pageAll<GoldLabelRow>(
      db,
      "fit_labels",
      LABEL_COLUMNS,
      (q) => {
        let b = q.in("source", sources);
        if (opts.withTier) b = b.not("tier", "is", null);
        return b;
      },
      (q) => q.order("created_at").order("id")
    );
    return { rows, available: true, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (MISSING_TABLE_RE.test(message)) return { rows: [], available: false, error: null };
    return { rows: [], available: true, error: message };
  }
}

/**
 * `profiles` rows for the admins plus any identity named in `values` — the
 * configured labelers, the command-line flags, the signed-in user, the
 * labelers on stored rows — each value read by shape (`splitIdentityValues`):
 * a UUID looks up `profiles.id`, anything else `profiles.email`. Passing an
 * email into the id lookup would fail on the UUID column, so the split is
 * the only way in.
 */
export async function loadLabelerIdentities(db: SupabaseClient, values: ReadonlyArray<string | null | undefined> = []): Promise<LabelerIdentity[]> {
  type Row = { id: string; email: string | null; full_name: string | null };
  const out = new Map<string, LabelerIdentity>();
  const put = (rows: Row[] | null) => {
    for (const r of rows ?? []) out.set(r.id, { id: r.id, email: r.email, name: r.full_name });
  };
  const admins = await db.from("profiles").select("id, email, full_name").eq("role", "admin");
  if (admins.error) throw new Error(`profiles read failed: ${admins.error.message}`);
  put(admins.data as Row[]);
  const split = splitIdentityValues(values);
  const ids = split.ids.filter((id) => !out.has(id));
  for (const slice of chunks(ids)) {
    const { data, error } = await db.from("profiles").select("id, email, full_name").in("id", slice);
    if (error) throw new Error(`profiles read failed: ${error.message}`);
    put(data as Row[]);
  }
  const known = new Set(Array.from(out.values()).map((i) => (i.email ?? "").toLowerCase()));
  const emails = split.emails.filter((e) => !known.has(e.toLowerCase()));
  for (const slice of chunks(emails)) {
    const { data, error } = await db.from("profiles").select("id, email, full_name").in("email", slice);
    if (error) throw new Error(`profiles read failed: ${error.message}`);
    put(data as Row[]);
  }
  return Array.from(out.values()).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Evidence titles
// ---------------------------------------------------------------------------

/** Resolves provenance ids to titles per investigator (the CSV's "top 3 titles"), one chunked read per table. */
export async function loadEvidenceTitles(db: SupabaseClient, wanted: ReadonlyArray<{ investigator_id: string; ids: readonly string[] }>): Promise<Map<string, string[]>> {
  const allIds = wanted.flatMap((w) => w.ids);
  const keys = evidenceKeys(allIds);
  const investigatorIds = Array.from(new Set(wanted.map((w) => w.investigator_id)));
  const pubs = new Map<string, PublicationLookupRow>();
  const grants = new Map<string, GrantLookupRow>();
  const trials = new Map<string, TrialLookupRow>();
  for (const invSlice of chunks(investigatorIds)) {
    for (const pmidSlice of chunks(keys.pmids, 200)) {
      if (!pmidSlice.length) break;
      const { data, error } = await db.from("investigator_publications").select("investigator_id, pmid, title, journal, publication_date").in("investigator_id", invSlice).in("pmid", pmidSlice);
      if (error) throw new Error(`investigator_publications read failed: ${error.message}`);
      for (const r of (data ?? []) as Array<PublicationLookupRow & { investigator_id: string }>) pubs.set(`${r.investigator_id}:${r.pmid}`, r);
    }
    for (const nctSlice of chunks(keys.nctIds, 200)) {
      if (!nctSlice.length) break;
      const { data, error } = await db.from("investigator_clinical_trials").select("investigator_id, nct_id, title, start_date").in("investigator_id", invSlice).in("nct_id", nctSlice);
      if (error) throw new Error(`investigator_clinical_trials read failed: ${error.message}`);
      for (const r of (data ?? []) as Array<TrialLookupRow & { investigator_id: string }>) trials.set(`${r.investigator_id}:${r.nct_id}`, r);
    }
  }
  for (const slice of chunks(keys.grantIds, 200)) {
    if (!slice.length) break;
    const { data, error } = await db.from("investigator_nih_grants").select("id, project_num, project_title, fiscal_year, activity_code").in("id", slice);
    if (error) throw new Error(`investigator_nih_grants read failed: ${error.message}`);
    for (const r of (data ?? []) as GrantLookupRow[]) grants.set(r.id, r);
  }
  const out = new Map<string, string[]>();
  for (const w of wanted) {
    const lookup: EvidenceLookup = {
      publications: new Map(keys.pmids.flatMap((p) => (pubs.has(`${w.investigator_id}:${p}`) ? [[p, pubs.get(`${w.investigator_id}:${p}`)!] as const] : []))),
      grants,
      trials: new Map(keys.nctIds.flatMap((n) => (trials.has(`${w.investigator_id}:${n}`) ? [[n, trials.get(`${w.investigator_id}:${n}`)!] as const] : []))),
    };
    out.set(
      w.investigator_id,
      w.ids.map((id) => {
        const ref = resolveEvidenceId(id, lookup);
        return ref.meta && ref.kind !== "publication" ? `${ref.title} (${ref.meta})` : ref.title;
      })
    );
  }
  return out;
}
