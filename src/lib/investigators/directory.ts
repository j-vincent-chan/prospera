/**
 * Server-side loader for Investigators v2: every non-archived person with
 * their five source rows, evidence for the popovers, tags and community.
 * The directory is small (hundreds), so it is loaded whole and filtered in
 * memory; the page paginates 50 at a time.
 *
 * The evidence behind the chips comes from one database function,
 * `investigator_directory_evidence()` (migration 20260925100000): every grant
 * slimmed to what the popover needs, the publication counts by identity
 * method, and the three most recent publications per person. Before that
 * function existed the page read the whole RePORTER cache with its raw_json
 * (~8 MB), every source row with its meta blob and all 15k publication rows,
 * page by page — 8–11 s in production and enough to stall the shared-CPU
 * database for everyone. The old reads survive only as the fallback the loader
 * takes when the function is not installed yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import {
  countDirectory,
  emptySourceRow,
  matchesSourcesFilter,
  publicationStatsFromRows,
  sourceChip,
  type DirectoryCounts,
  type GrantEvidence,
  type IdentityMethod,
  type InvestigatorSourceRow,
  type PersonChips,
  type PublicationEvidence,
  type PublicationStats,
  type SourceChipModel,
  type SourceContext,
  type SourceKey,
  type SourcesFilter,
} from "@/lib/investigators/sources";

export type CommunityOption = { id: string; slug: string; label: string };

export type DirectoryPerson = {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  department: string | null;
  division: string | null;
  /** "Medicine · Rheumatology" */
  departmentLine: string | null;
  communityId: string | null;
  communityLabel: string | null;
  tags: string[];
  nihProfileId: string | null;
  orcid: string | null;
  profilesUrlName: string | null;
  createdAt: string;
  addedVia: string | null;
  sources: Record<SourceKey, InvestigatorSourceRow>;
  chips: PersonChips;
  /** ORCID / Profiles chips for the detail page's Data sources panel. */
  connectorChips: { orcid: SourceChipModel; profiles: SourceChipModel };
  grants: GrantEvidence[];
  /**
   * Only the publications the popover shows (two verified, one name-only);
   * the counts live in `publicationStats`. The profile page loads its own
   * full list.
   */
  publications: PublicationEvidence[];
  publicationStats: PublicationStats;
};

export type DirectoryFilters = {
  q: string;
  community: string; // "" | "none" | community id
  sources: SourcesFilter;
};

export function addedViaLabel(raw: unknown): string | null {
  const source = typeof raw === "object" && raw ? (raw as { source?: string }).source : null;
  switch (source) {
    case "signal":
      return "Signal sync";
    case "manual_entry":
      return "manual entry";
    case "csv":
    case "csv_import":
      return "CSV import";
    default:
      return null;
  }
}

/** The RePORTER fields the role and dates are read from — the full record or the slim copy the database function returns. */
type GrantRoleFields = {
  contact_pi_name?: string | null;
  principal_investigators?: Array<{ last_name?: string | null; is_contact_pi?: boolean | null }> | null;
};

function grantRole(raw: unknown, lastName: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as GrantRoleFields;
  const pis = r.principal_investigators ?? [];
  const me = pis.find((p) => (p.last_name ?? "").toLowerCase() === lastName.toLowerCase());
  if (me) return me.is_contact_pi || pis.length === 1 ? (pis.length > 1 ? "Contact PI" : "PI") : "PI";
  if (r.contact_pi_name && r.contact_pi_name.toUpperCase().includes(lastName.toUpperCase())) return "Contact PI";
  return null;
}

function grantDates(raw: unknown): { start: string | null; end: string | null } {
  if (!raw || typeof raw !== "object") return { start: null, end: null };
  const r = raw as { project_start_date?: string | null; project_end_date?: string | null };
  return { start: r.project_start_date?.slice(0, 10) ?? null, end: r.project_end_date?.slice(0, 10) ?? null };
}

/**
 * RePORTER caches every project as active; the project end date (or, failing
 * that, the fiscal year) says whether it has actually ended.
 */
export function grantIsActive(input: { end: string | null; fiscal_year: number | null; is_active: boolean | null }, now = new Date()): boolean {
  if (input.end) return input.end >= now.toISOString().slice(0, 10);
  if (input.fiscal_year != null) return input.fiscal_year >= now.getUTCFullYear() - 1;
  return input.is_active !== false;
}

/** Every column of `investigator_sources` except `meta` — the ORCID/Profiles blobs the chips never read (up to 27 KB a row). */
const SOURCE_COLUMNS =
  "investigator_id, source, state, item_count, unverified_count, identity_method, external_id, external_url, last_refreshed_at, last_attempted_at, last_error, document_date, written_for, authorized_at, authorized_by, revoked_at, requested_at, requested_by, reminder_sent_at, declined_at, request_token, storage_path, personal_statement, contributions, created_at, updated_at";

/** One row of `investigator_directory_evidence()`. */
type EvidenceRow = {
  investigator_id: string;
  grants: Array<{
    project_num: string;
    project_title: string | null;
    ic_name: string | null;
    fiscal_year: number | null;
    is_active: boolean | null;
    identity_status: string;
    project_start_date: string | null;
    project_end_date: string | null;
    contact_pi_name: string | null;
    principal_investigators: Array<{ last_name: string | null; is_contact_pi: boolean | null }>;
  }>;
  verified_by_method: Record<string, number>;
  unverified_count: number;
  recent_verified: PublicationEvidence[];
  recent_unverified: PublicationEvidence[];
};

/** What the per-person evidence looks like once it has been read, whichever way. */
type Evidence = { grants: GrantEvidence[]; publicationStats: PublicationStats };

function grantEvidence(g: { project_num: string; project_title: string | null; ic_name: string | null; fiscal_year: number | null; is_active: boolean | null; identity_status: string }, raw: unknown, lastName: string, now: Date): GrantEvidence {
  const dates = grantDates(raw);
  return {
    project_num: g.project_num,
    project_title: g.project_title,
    ic_name: g.ic_name,
    fiscal_year: g.fiscal_year,
    is_active: grantIsActive({ end: dates.end, fiscal_year: g.fiscal_year, is_active: g.is_active }, now),
    ...dates,
    role: grantRole(raw, lastName),
    identity_status: g.identity_status as GrantEvidence["identity_status"],
  };
}

/** PostgREST's "function not found" — the migration has not been applied to this database. */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST202" || /could not find the function/i.test(error?.message ?? "");
}

/**
 * The evidence for everyone, from `investigator_directory_evidence()`. Returns
 * null when the function is not installed, so the caller can take the old
 * reads instead; any other error is thrown.
 */
async function loadEvidenceFromFunction(db: SupabaseClient, lastNameOf: (id: string) => string, now: Date): Promise<Map<string, Evidence> | null> {
  const { data, error } = await db.rpc("investigator_directory_evidence");
  if (error) {
    if (isMissingFunction(error)) return null;
    throw new Error(error.message);
  }
  const out = new Map<string, Evidence>();
  for (const row of (data ?? []) as EvidenceRow[]) {
    const lastName = lastNameOf(row.investigator_id);
    const grants = (Array.isArray(row.grants) ? row.grants : []).map((g) => grantEvidence(g, g, lastName, now));
    const verifiedByMethod: Partial<Record<IdentityMethod, number>> = {};
    for (const [method, n] of Object.entries(row.verified_by_method ?? {})) verifiedByMethod[method as IdentityMethod] = n;
    out.set(row.investigator_id, {
      grants,
      publicationStats: {
        verifiedByMethod,
        unverifiedCount: row.unverified_count ?? 0,
        recentVerified: Array.isArray(row.recent_verified) ? row.recent_verified : [],
        recentUnverified: Array.isArray(row.recent_unverified) ? row.recent_unverified : [],
      },
    });
  }
  return out;
}

/** The pre-function reads: every grant with its raw_json and every publication row, paged. Slow; kept only until the migration is applied everywhere. */
async function loadEvidenceFromRows(db: SupabaseClient, lastNameOf: (id: string) => string, now: Date): Promise<Map<string, Evidence>> {
  const [grantsRes, pubsRes] = await Promise.all([
    fetchAllRows<{ investigator_id: string; project_num: string; project_title: string | null; ic_name: string | null; fiscal_year: number | null; is_active: boolean | null; identity_status: string; raw_json: unknown }>(async (from, to) =>
      await db
        .from("investigator_nih_grants")
        .select("investigator_id, project_num, project_title, ic_name, fiscal_year, is_active, identity_status, raw_json")
        .order("fiscal_year", { ascending: false })
        .range(from, to),
    ),
    fetchAllRows<PublicationEvidence & { investigator_id: string }>(async (from, to) =>
      await db
        .from("investigator_publications")
        .select("investigator_id, pmid, title, journal, publication_date, identity_method, identity_status")
        .order("publication_date", { ascending: false, nullsFirst: false })
        .range(from, to),
    ),
  ]);
  const firstError = grantsRes.error ?? pubsRes.error;
  if (firstError) throw new Error(firstError);

  const grantsByInv = new Map<string, GrantEvidence[]>();
  for (const g of grantsRes.data) {
    const list = grantsByInv.get(g.investigator_id) ?? [];
    list.push(grantEvidence(g, g.raw_json, lastNameOf(g.investigator_id), now));
    grantsByInv.set(g.investigator_id, list);
  }
  const pubsByInv = new Map<string, PublicationEvidence[]>();
  for (const p of pubsRes.data) {
    const list = pubsByInv.get(p.investigator_id) ?? [];
    list.push({ pmid: p.pmid, title: p.title, journal: p.journal, publication_date: p.publication_date, identity_method: p.identity_method, identity_status: p.identity_status });
    pubsByInv.set(p.investigator_id, list);
  }
  const out = new Map<string, Evidence>();
  for (const id of new Set([...grantsByInv.keys(), ...pubsByInv.keys()])) {
    out.set(id, { grants: grantsByInv.get(id) ?? [], publicationStats: publicationStatsFromRows(pubsByInv.get(id) ?? []) });
  }
  return out;
}

const NO_EVIDENCE: Evidence = { grants: [], publicationStats: { verifiedByMethod: {}, unverifiedCount: 0, recentVerified: [], recentUnverified: [] } };

export async function loadDirectory(db: SupabaseClient, opts: { now?: Date } = {}): Promise<{ people: DirectoryPerson[]; communities: CommunityOption[] }> {
  const now = opts.now ?? new Date();
  const [{ data: invRows, error }, { data: communityRows }, sourcesRes] = await Promise.all([
    db
      .from("investigators")
      .select(
        "id, first_name, last_name, full_name, email, home_department, division, nih_profile_id, orcid, profiles_url_name, research_community_id, raw_profile_json, created_at, pipeline_communities!investigators_research_community_id_fkey(id, label), investigator_profile_features(science_tags, disease_tags, method_tags)",
      )
      .is("archived_at", null)
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true }),
    db.from("pipeline_communities").select("id, slug, label").order("sort_order", { ascending: true }),
    fetchAllRows<Omit<InvestigatorSourceRow, "meta">>(async (from, to) => await db.from("investigator_sources").select(SOURCE_COLUMNS).range(from, to)),
  ]);
  if (error) throw new Error(error.message);
  if (sourcesRes.error) throw new Error(sourcesRes.error);

  type InvRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string;
    email: string | null;
    home_department: string | null;
    division: string | null;
    nih_profile_id: string | null;
    orcid: string | null;
    profiles_url_name: string | null;
    research_community_id: string | null;
    raw_profile_json: unknown;
    created_at: string;
    pipeline_communities: { id: string; label: string } | { id: string; label: string }[] | null;
    investigator_profile_features: { science_tags?: string[]; disease_tags?: string[]; method_tags?: string[] } | { science_tags?: string[]; disease_tags?: string[]; method_tags?: string[] }[] | null;
  };
  const invs = (invRows ?? []) as unknown as InvRow[];
  const lastNameFor = (inv: InvRow) => inv.last_name?.trim() || inv.full_name.trim().split(/\s+/).slice(-1)[0] || inv.full_name;
  const lastNames = new Map(invs.map((inv) => [inv.id, lastNameFor(inv)]));
  const lastNameOf = (id: string) => lastNames.get(id) ?? "";

  // The grant and publication evidence: one function call, or the old reads while the function is missing.
  const evidence = (await loadEvidenceFromFunction(db, lastNameOf, now)) ?? (await loadEvidenceFromRows(db, lastNameOf, now));

  const communities = (communityRows ?? []) as CommunityOption[];
  const sourcesByInv = new Map<string, Partial<Record<SourceKey, InvestigatorSourceRow>>>();
  for (const r of sourcesRes.data) {
    const m = sourcesByInv.get(r.investigator_id) ?? {};
    m[r.source] = { ...r, meta: null };
    sourcesByInv.set(r.investigator_id, m);
  }

  const people: DirectoryPerson[] = [];
  for (const inv of invs) {
    const community = Array.isArray(inv.pipeline_communities) ? inv.pipeline_communities[0] ?? null : inv.pipeline_communities;
    const feats = Array.isArray(inv.investigator_profile_features) ? inv.investigator_profile_features[0] ?? null : inv.investigator_profile_features;
    const lastName = lastNameOf(inv.id);
    const firstName = inv.first_name?.trim() || inv.full_name.trim().split(/\s+/)[0] || "";
    const { grants, publicationStats } = evidence.get(inv.id) ?? NO_EVIDENCE;
    const publications = [...publicationStats.recentVerified, ...publicationStats.recentUnverified];

    const partial = sourcesByInv.get(inv.id) ?? {};
    const sources = {
      reporter: partial.reporter ?? emptySourceRow(inv.id, "reporter"),
      pubmed: partial.pubmed ?? emptySourceRow(inv.id, "pubmed"),
      biosketch: partial.biosketch ?? emptySourceRow(inv.id, "biosketch"),
      orcid: partial.orcid ?? emptySourceRow(inv.id, "orcid"),
      profiles: partial.profiles ?? emptySourceRow(inv.id, "profiles"),
    };
    const ctx: SourceContext = {
      now,
      fullName: inv.full_name,
      lastName,
      email: inv.email?.trim() || null,
      nihProfileId: inv.nih_profile_id?.trim() || null,
      orcid: inv.orcid?.trim() || null,
      addedVia: addedViaLabel(inv.raw_profile_json),
      addedAt: inv.created_at,
      grants,
      publications,
      publicationStats,
      repliedInterestedAt: null,
    };
    const tags = Array.from(new Set([...(feats?.science_tags ?? []), ...(feats?.disease_tags ?? []), ...(feats?.method_tags ?? [])])).map((t) => t.replaceAll("_", " "));

    people.push({
      id: inv.id,
      fullName: inv.full_name,
      firstName,
      lastName,
      email: ctx.email,
      department: inv.home_department?.trim() || null,
      division: inv.division?.trim() || null,
      departmentLine: [inv.home_department?.trim(), inv.division?.trim()].filter(Boolean).join(" · ") || null,
      communityId: community?.id ?? inv.research_community_id,
      communityLabel: community?.label ?? null,
      tags,
      nihProfileId: ctx.nihProfileId,
      orcid: ctx.orcid,
      profilesUrlName: inv.profiles_url_name?.trim() || null,
      createdAt: inv.created_at,
      addedVia: ctx.addedVia,
      sources,
      chips: {
        reporter: sourceChip(sources.reporter, ctx),
        pubmed: sourceChip(sources.pubmed, ctx),
        biosketch: sourceChip(sources.biosketch, ctx),
      },
      connectorChips: { orcid: sourceChip(sources.orcid, ctx), profiles: sourceChip(sources.profiles, ctx) },
      grants,
      publications,
      publicationStats,
    });
  }

  return { people, communities };
}

export function filterDirectory(people: DirectoryPerson[], f: DirectoryFilters): DirectoryPerson[] {
  const q = f.q.trim().toLowerCase();
  return people.filter((p) => {
    if (f.community === "none" && p.communityId) return false;
    if (f.community && f.community !== "none" && p.communityId !== f.community) return false;
    if (!matchesSourcesFilter(f.sources, p.chips)) return false;
    if (!q) return true;
    const hay = [p.fullName, p.email, p.department, p.division, ...p.tags].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function directoryCounts(people: DirectoryPerson[]): DirectoryCounts {
  return countDirectory(people);
}
