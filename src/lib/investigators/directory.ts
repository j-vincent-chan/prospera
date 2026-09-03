/**
 * Server-side loader for Investigators v2: every non-archived person with
 * their five source rows, evidence for the popovers, tags and community.
 * The directory is small (hundreds), so it is loaded whole and filtered in
 * memory; the page paginates 50 at a time.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import {
  countDirectory,
  emptySourceRow,
  matchesSourcesFilter,
  sourceChip,
  type DirectoryCounts,
  type GrantEvidence,
  type InvestigatorSourceRow,
  type PersonChips,
  type PublicationEvidence,
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
  publications: PublicationEvidence[];
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

function grantRole(raw: unknown, lastName: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { contact_pi_name?: string | null; principal_investigators?: Array<{ last_name?: string; is_contact_pi?: boolean }> };
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

export async function loadDirectory(db: SupabaseClient, opts: { now?: Date } = {}): Promise<{ people: DirectoryPerson[]; communities: CommunityOption[] }> {
  const now = opts.now ?? new Date();
  const [{ data: invRows, error }, { data: communityRows }, sourcesRes, grantsRes, pubsRes] = await Promise.all([
    db
      .from("investigators")
      .select(
        "id, first_name, last_name, full_name, email, home_department, division, nih_profile_id, orcid, profiles_url_name, research_community_id, raw_profile_json, created_at, pipeline_communities(id, label), investigator_profile_features(science_tags, disease_tags, method_tags)",
      )
      .is("archived_at", null)
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true }),
    db.from("pipeline_communities").select("id, slug, label").order("sort_order", { ascending: true }),
    fetchAllRows<InvestigatorSourceRow>(async (from, to) => await db.from("investigator_sources").select("*").range(from, to)),
    fetchAllRows<{ investigator_id: string; project_num: string; project_title: string | null; ic_name: string | null; fiscal_year: number | null; is_active: boolean | null; identity_status: string; raw_json: unknown }>(async (from, to) =>
      await db
        .from("investigator_nih_grants")
        .select("investigator_id, project_num, project_title, ic_name, fiscal_year, is_active, identity_status, raw_json")
        .order("fiscal_year", { ascending: false })
        .range(from, to),
    ),
    fetchAllRows<{ investigator_id: string; pmid: string; title: string | null; journal: string | null; publication_date: string | null; identity_method: string; identity_status: string }>(async (from, to) =>
      await db
        .from("investigator_publications")
        .select("investigator_id, pmid, title, journal, publication_date, identity_method, identity_status")
        .order("publication_date", { ascending: false, nullsFirst: false })
        .range(from, to),
    ),
  ]);
  if (error) throw new Error(error.message);
  const firstError = sourcesRes.error ?? grantsRes.error ?? pubsRes.error;
  if (firstError) throw new Error(firstError);
  const sourceRows = sourcesRes.data;
  const grantRows = grantsRes.data;
  const pubRows = pubsRes.data;

  const communities = (communityRows ?? []) as CommunityOption[];
  const sourcesByInv = new Map<string, Partial<Record<SourceKey, InvestigatorSourceRow>>>();
  for (const r of sourceRows) {
    const m = sourcesByInv.get(r.investigator_id) ?? {};
    m[r.source] = r;
    sourcesByInv.set(r.investigator_id, m);
  }
  const grantsByInv = new Map<string, typeof grantRows>();
  for (const g of grantRows) {
    const list = grantsByInv.get(g.investigator_id) ?? [];
    list.push(g);
    grantsByInv.set(g.investigator_id, list);
  }
  const pubsByInv = new Map<string, typeof pubRows>();
  for (const p of pubRows) {
    const list = pubsByInv.get(p.investigator_id) ?? [];
    list.push(p);
    pubsByInv.set(p.investigator_id, list);
  }

  const people: DirectoryPerson[] = [];
  for (const raw of invRows ?? []) {
    const inv = raw as unknown as {
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
    const community = Array.isArray(inv.pipeline_communities) ? inv.pipeline_communities[0] ?? null : inv.pipeline_communities;
    const feats = Array.isArray(inv.investigator_profile_features) ? inv.investigator_profile_features[0] ?? null : inv.investigator_profile_features;
    const lastName = inv.last_name?.trim() || inv.full_name.trim().split(/\s+/).slice(-1)[0] || inv.full_name;
    const firstName = inv.first_name?.trim() || inv.full_name.trim().split(/\s+/)[0] || "";

    const grants: GrantEvidence[] = (grantsByInv.get(inv.id) ?? []).map((g) => {
      const dates = grantDates(g.raw_json);
      return {
        project_num: g.project_num,
        project_title: g.project_title,
        ic_name: g.ic_name,
        fiscal_year: g.fiscal_year,
        is_active: grantIsActive({ end: dates.end, fiscal_year: g.fiscal_year, is_active: g.is_active }, now),
        ...dates,
        role: grantRole(g.raw_json, lastName),
        identity_status: g.identity_status as GrantEvidence["identity_status"],
      };
    });
    const publications: PublicationEvidence[] = (pubsByInv.get(inv.id) ?? []).map((p) => ({
      pmid: p.pmid,
      title: p.title,
      journal: p.journal,
      publication_date: p.publication_date,
      identity_method: p.identity_method as PublicationEvidence["identity_method"],
      identity_status: p.identity_status as PublicationEvidence["identity_status"],
    }));

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
