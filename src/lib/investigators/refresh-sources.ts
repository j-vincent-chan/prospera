/**
 * Refresh orchestration for the investigator sources model.
 *
 * Each connector writes one `investigator_sources` row (state, count,
 * freshness, identity method, error) and the evidence caches. UCSF Profiles
 * and ORCID run first because they can supply the ORCID iD, the email and
 * PMIDs that turn name-only PubMed hits into verified ones.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshInvestigatorClinicalTrials } from "@/lib/community/clinicaltrials-ingest";
import { refreshInvestigatorPubMed } from "@/lib/community/pubmed-ingest";
import { refreshInvestigatorReporter } from "@/lib/community/reporter-ingest";
import { fetchOrcidEmployments, fetchOrcidWorks, normalizeOrcid, pickConfidentOrcid, searchOrcidByName, UCSF_ORG_RE, type OrcidWork } from "@/lib/ingestion/orcid/client";
import { fetchUcsfProfile, guessProfilesUrlName, profileMatchesPerson, ProfilesNotFoundError, type ProfilesPublication } from "@/lib/ingestion/ucsf-profiles/client";
import type { IdentityMethod, SourceKey, SourceState } from "@/lib/investigators/sources";

export type RefreshableSource = "profiles" | "orcid" | "reporter" | "pubmed" | "trials";

export const ALL_REFRESHABLE: RefreshableSource[] = ["profiles", "orcid", "reporter", "pubmed", "trials"];

export type SourceRefreshOutcome = {
  source: RefreshableSource;
  ok: boolean;
  /** Human sentence for a toast or log line. */
  message: string;
  /** Set when nothing was fetched for a benign reason (no id on file, no match). */
  skipped?: boolean;
};

type SourcePatch = {
  state?: SourceState;
  item_count?: number;
  unverified_count?: number;
  identity_method?: IdentityMethod | null;
  external_id?: string | null;
  external_url?: string | null;
  last_refreshed_at?: string | null;
  last_attempted_at?: string | null;
  last_error?: string | null;
  meta?: Record<string, unknown>;
};

export async function touchSource(db: SupabaseClient, investigatorId: string, source: SourceKey, patch: SourcePatch): Promise<void> {
  const { error } = await db
    .from("investigator_sources")
    .upsert({ investigator_id: investigatorId, source, ...patch, updated_at: new Date().toISOString() }, { onConflict: "investigator_id,source" });
  if (error) throw new Error(`investigator_sources ${source}: ${error.message}`);
}

const nowIso = () => new Date().toISOString();
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type InvestigatorRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  home_department: string | null;
  nih_profile_id: string | null;
  orcid: string | null;
  profiles_url_name: string | null;
};

async function loadInvestigator(db: SupabaseClient, id: string): Promise<InvestigatorRow> {
  const { data, error } = await db
    .from("investigators")
    .select("id, first_name, last_name, full_name, email, home_department, nih_profile_id, orcid, profiles_url_name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Investigator not found");
  return data as InvestigatorRow;
}

// ---------------------------------------------------------------------------
// UCSF Profiles
// ---------------------------------------------------------------------------

export async function refreshProfilesSource(db: SupabaseClient, investigatorId: string): Promise<SourceRefreshOutcome> {
  const inv = await loadInvestigator(db, investigatorId);
  const explicit = inv.profiles_url_name?.trim() || null;
  const urlName = explicit ?? guessProfilesUrlName(inv.first_name ?? inv.full_name.split(" ")[0] ?? "", inv.last_name ?? inv.full_name.split(" ").slice(-1)[0] ?? "");
  const attempted = nowIso();
  if (!urlName) {
    await touchSource(db, investigatorId, "profiles", { state: "unavailable", last_attempted_at: attempted, last_error: "Name too short to guess a Profiles URL" });
    return { source: "profiles", ok: true, skipped: true, message: "UCSF Profiles: no URL name to look up." };
  }

  try {
    const profile = await fetchUcsfProfile(urlName);
    if (!profileMatchesPerson(profile, inv.last_name ?? inv.full_name.split(" ").slice(-1)[0] ?? "")) {
      await touchSource(db, investigatorId, "profiles", {
        state: "unavailable",
        last_attempted_at: attempted,
        last_error: `profiles.ucsf.edu/${urlName} belongs to ${profile.name || "someone else"}`,
        meta: { tried: urlName },
      });
      return { source: "profiles", ok: true, skipped: true, message: `UCSF Profiles: ${urlName} is a different person.` };
    }

    const pmids = profile.publications.map((p) => p.pmid).filter((p): p is string => Boolean(p));
    await touchSource(db, investigatorId, "profiles", {
      state: "available",
      item_count: profile.publicationCount,
      identity_method: explicit ? "manual" : "affiliation",
      external_id: profile.urlName,
      external_url: profile.url,
      last_refreshed_at: attempted,
      last_attempted_at: attempted,
      last_error: null,
      meta: {
        name: profile.name,
        department: profile.department,
        school: profile.school,
        title: profile.title,
        titles: profile.titles,
        keywords: profile.keywords,
        freetext_keywords: profile.freetextKeywords,
        orcid: profile.orcid,
        photo_url: profile.photoUrl,
        narrative: profile.narrative?.slice(0, 1200) ?? null,
        pmids,
        funding: profile.funding.slice(0, 40),
      },
    });

    // Fill directory gaps from the institutional record; never overwrite.
    const patch: Record<string, unknown> = {};
    if (!explicit) patch.profiles_url_name = profile.urlName;
    const orcid = normalizeOrcid(profile.orcid);
    if (!inv.orcid && orcid) patch.orcid = orcid;
    if (!inv.email && profile.email && /@ucsf\.edu$/i.test(profile.email)) patch.email = profile.email;
    if (!inv.home_department && profile.department) patch.home_department = profile.department;
    if (Object.keys(patch).length) await db.from("investigators").update(patch).eq("id", investigatorId);

    await applyProfilesPublications(db, investigatorId, profile.publications, profile.url);
    return { source: "profiles", ok: true, message: `UCSF Profiles: matched ${profile.urlName} (${profile.publicationCount} publications listed).` };
  } catch (e) {
    if (e instanceof ProfilesNotFoundError) {
      await touchSource(db, investigatorId, "profiles", {
        state: "unavailable",
        last_attempted_at: attempted,
        last_error: explicit ? `No Profiles page at profiles.ucsf.edu/${urlName}` : null,
        meta: { tried: urlName },
      });
      return { source: "profiles", ok: true, skipped: true, message: `UCSF Profiles: no page for ${urlName}.` };
    }
    await touchSource(db, investigatorId, "profiles", { state: "error", last_attempted_at: attempted, last_error: errMsg(e) });
    return { source: "profiles", ok: false, message: `UCSF Profiles: ${errMsg(e)}` };
  }
}

/** PMIDs listed on the person's Profiles page verify name-only PubMed rows and add missing ones. */
async function applyProfilesPublications(db: SupabaseClient, investigatorId: string, pubs: ProfilesPublication[], profileUrl: string): Promise<void> {
  const withPmid = pubs.filter((p) => p.pmid);
  if (!withPmid.length) return;
  const { data: existing } = await db
    .from("investigator_publications")
    .select("pmid, identity_method, identity_status, reviewed_at")
    .eq("investigator_id", investigatorId);
  const byPmid = new Map((existing ?? []).map((r) => [String(r.pmid), r]));

  const toVerify: string[] = [];
  const toInsert: Array<Record<string, unknown>> = [];
  for (const p of withPmid) {
    const row = byPmid.get(p.pmid!);
    if (row) {
      if (row.identity_status === "unverified" && row.reviewed_at == null) toVerify.push(p.pmid!);
      continue;
    }
    toInsert.push({
      investigator_id: investigatorId,
      pmid: p.pmid,
      title: p.title ?? `PMID ${p.pmid}`,
      journal: p.journal,
      publication_date: p.date ?? (p.year ? `${p.year}-01-01` : null),
      source: "ucsf_profiles",
      raw_json: { profiles_url: profileUrl, claimed: p.claimed },
      match_confidence: "high",
      provenance_note: `Listed on ${profileUrl}`,
      identity_method: "profiles",
      identity_status: "verified",
    });
  }
  for (let i = 0; i < toVerify.length; i += 100) {
    await db
      .from("investigator_publications")
      .update({ identity_method: "profiles", identity_status: "verified", match_confidence: "high" })
      .eq("investigator_id", investigatorId)
      .in("pmid", toVerify.slice(i, i + 100));
  }
  for (let i = 0; i < toInsert.length; i += 100) {
    await db.from("investigator_publications").upsert(toInsert.slice(i, i + 100), { onConflict: "investigator_id,pmid", ignoreDuplicates: true });
  }
}

// ---------------------------------------------------------------------------
// ORCID
// ---------------------------------------------------------------------------

export async function refreshOrcidSource(db: SupabaseClient, investigatorId: string): Promise<SourceRefreshOutcome> {
  const inv = await loadInvestigator(db, investigatorId);
  const attempted = nowIso();
  let orcid = normalizeOrcid(inv.orcid);
  let method: IdentityMethod = "self";

  if (!orcid) {
    // Profiles may have supplied it during this run.
    const { data: prof } = await db.from("investigator_sources").select("meta").eq("investigator_id", investigatorId).eq("source", "profiles").maybeSingle();
    const fromProfiles = normalizeOrcid((prof?.meta as { orcid?: string } | null)?.orcid ?? null);
    if (fromProfiles) {
      orcid = fromProfiles;
      method = "profiles";
    }
  }

  if (!orcid) {
    try {
      const first = inv.first_name?.trim() || inv.full_name.split(" ")[0] || "";
      const last = inv.last_name?.trim() || inv.full_name.split(" ").slice(-1)[0] || "";
      const hit = first && last ? pickConfidentOrcid(await searchOrcidByName(first, last)) : null;
      if (hit) {
        orcid = hit.orcid;
        method = "affiliation";
      }
    } catch (e) {
      await touchSource(db, investigatorId, "orcid", { state: "error", last_attempted_at: attempted, last_error: errMsg(e) });
      return { source: "orcid", ok: false, message: `ORCID: ${errMsg(e)}` };
    }
  }

  if (!orcid) {
    await touchSource(db, investigatorId, "orcid", { state: "unavailable", last_attempted_at: attempted, last_error: null });
    return { source: "orcid", ok: true, skipped: true, message: "ORCID: no iD on file and no confident match by name." };
  }

  try {
    const [works, employments] = await Promise.all([fetchOrcidWorks(orcid), fetchOrcidEmployments(orcid)]);
    const ucsf = employments.some((e) => e.organization && UCSF_ORG_RE.test(e.organization));
    if (!inv.orcid) await db.from("investigators").update({ orcid }).eq("id", investigatorId);
    await touchSource(db, investigatorId, "orcid", {
      state: "available",
      item_count: works.length,
      identity_method: inv.orcid ? "self" : method,
      external_id: orcid,
      external_url: `https://orcid.org/${orcid}`,
      last_refreshed_at: attempted,
      last_attempted_at: attempted,
      last_error: null,
      meta: {
        pmids: works.map((w) => w.pmid).filter(Boolean),
        dois: works.map((w) => w.doi).filter(Boolean),
        ucsf_employment: ucsf,
        employments: employments.slice(0, 6),
        works: works.slice(0, 60).map((w) => ({ title: w.title, year: w.year, journal: w.journal, pmid: w.pmid, type: w.type })),
      },
    });
    await applyOrcidWorks(db, investigatorId, works);
    return { source: "orcid", ok: true, message: `ORCID: ${orcid} · ${works.length} works.` };
  } catch (e) {
    await touchSource(db, investigatorId, "orcid", { state: "error", external_id: orcid, last_attempted_at: attempted, last_error: errMsg(e) });
    return { source: "orcid", ok: false, message: `ORCID: ${errMsg(e)}` };
  }
}

/** PMIDs on the ORCID record verify name-only PubMed rows. */
async function applyOrcidWorks(db: SupabaseClient, investigatorId: string, works: OrcidWork[]): Promise<void> {
  const pmids = works.map((w) => w.pmid).filter((p): p is string => Boolean(p));
  if (!pmids.length) return;
  for (let i = 0; i < pmids.length; i += 100) {
    await db
      .from("investigator_publications")
      .update({ identity_method: "orcid", identity_status: "verified", match_confidence: "high" })
      .eq("investigator_id", investigatorId)
      .eq("identity_status", "unverified")
      .is("reviewed_at", null)
      .in("pmid", pmids.slice(i, i + 100));
  }
}

// ---------------------------------------------------------------------------
// RePORTER / PubMed / ClinicalTrials wrappers
// ---------------------------------------------------------------------------

export async function refreshReporterSource(db: SupabaseClient, investigatorId: string): Promise<SourceRefreshOutcome> {
  const attempted = nowIso();
  try {
    const r = await refreshInvestigatorReporter(db, investigatorId);
    if (r.skipped === "missing_nih_profile_id") {
      await touchSource(db, investigatorId, "reporter", { state: "unavailable", item_count: 0, identity_method: null, external_id: null, last_attempted_at: attempted, last_error: null });
      return { source: "reporter", ok: true, skipped: true, message: "RePORTER: no profile ID on file." };
    }
    const inv = await loadInvestigator(db, investigatorId);
    await touchSource(db, investigatorId, "reporter", {
      state: "available",
      item_count: r.inserted,
      identity_method: "profile_id",
      external_id: inv.nih_profile_id?.replace(/\D/g, "") ?? null,
      external_url: inv.nih_profile_id ? `https://reporter.nih.gov/search/results?pi_profile_ids=${inv.nih_profile_id.replace(/\D/g, "")}` : null,
      last_refreshed_at: attempted,
      last_attempted_at: attempted,
      last_error: null,
    });
    return { source: "reporter", ok: true, message: `RePORTER: ${r.inserted} project${r.inserted === 1 ? "" : "s"}.${r.warning ? ` ${r.warning}` : ""}` };
  } catch (e) {
    await touchSource(db, investigatorId, "reporter", { state: "error", last_attempted_at: attempted, last_error: errMsg(e) });
    return { source: "reporter", ok: false, message: `RePORTER: ${errMsg(e)}` };
  }
}

export async function refreshPubmedSource(db: SupabaseClient, investigatorId: string): Promise<SourceRefreshOutcome> {
  const attempted = nowIso();
  try {
    const r = await refreshInvestigatorPubMed(db, investigatorId);
    await touchSource(db, investigatorId, "pubmed", {
      state: "available",
      identity_method: r.inserted > 0 ? "affiliation" : null,
      last_refreshed_at: attempted,
      last_attempted_at: attempted,
      last_error: null,
      meta: { term: r.term, rejected: r.rejectedPmids ?? 0 },
    });
    await syncSourceCountsFromCaches(db, investigatorId);
    return { source: "pubmed", ok: true, message: `PubMed: ${r.inserted} affiliation-matched publication${r.inserted === 1 ? "" : "s"}.${r.warning ? ` ${r.warning}` : ""}` };
  } catch (e) {
    await touchSource(db, investigatorId, "pubmed", { state: "error", last_attempted_at: attempted, last_error: errMsg(e) });
    return { source: "pubmed", ok: false, message: `PubMed: ${errMsg(e)}` };
  }
}

export async function refreshTrialsSource(db: SupabaseClient, investigatorId: string): Promise<SourceRefreshOutcome> {
  try {
    const r = await refreshInvestigatorClinicalTrials(db, investigatorId);
    const n = (r as { inserted?: number }).inserted ?? 0;
    return { source: "trials", ok: true, message: `ClinicalTrials.gov: ${n} stud${n === 1 ? "y" : "ies"}.` };
  } catch (e) {
    return { source: "trials", ok: false, message: `ClinicalTrials.gov: ${errMsg(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Counts derived from the caches (after any refresh or review)
// ---------------------------------------------------------------------------

export async function syncSourceCountsFromCaches(db: SupabaseClient, investigatorId: string): Promise<void> {
  const [{ data: pubs }, { data: grants }] = await Promise.all([
    db.from("investigator_publications").select("identity_method, identity_status").eq("investigator_id", investigatorId),
    db.from("investigator_nih_grants").select("identity_status").eq("investigator_id", investigatorId),
  ]);
  const verified = (pubs ?? []).filter((p) => p.identity_status === "verified");
  const unverified = (pubs ?? []).filter((p) => p.identity_status === "unverified").length;
  const methods = new Set(verified.map((p) => String(p.identity_method)));
  const dominant: IdentityMethod | null = methods.has("affiliation") ? "affiliation" : methods.has("orcid") ? "orcid" : methods.has("profiles") ? "profiles" : methods.has("manual") ? "manual" : null;
  await db
    .from("investigator_sources")
    .update({ item_count: verified.length, unverified_count: unverified, identity_method: dominant, updated_at: nowIso() })
    .eq("investigator_id", investigatorId)
    .eq("source", "pubmed");
  await db
    .from("investigator_sources")
    .update({ item_count: (grants ?? []).filter((g) => g.identity_status !== "rejected").length, updated_at: nowIso() })
    .eq("investigator_id", investigatorId)
    .eq("source", "reporter");
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Refresh the requested sources for one person. Profiles and ORCID run first
 * (sequentially, they inform each other), then RePORTER, PubMed and trials in
 * parallel. Never throws: each outcome carries its own ok flag.
 */
export async function refreshInvestigatorSources(
  db: SupabaseClient,
  investigatorId: string,
  sources: RefreshableSource[] | "all" = "all",
): Promise<SourceRefreshOutcome[]> {
  const wanted = new Set(sources === "all" ? ALL_REFRESHABLE : sources);
  const outcomes: SourceRefreshOutcome[] = [];

  if (wanted.has("profiles")) outcomes.push(await refreshProfilesSource(db, investigatorId));
  if (wanted.has("orcid")) outcomes.push(await refreshOrcidSource(db, investigatorId));

  const parallel: Array<Promise<SourceRefreshOutcome>> = [];
  if (wanted.has("reporter")) parallel.push(refreshReporterSource(db, investigatorId));
  if (wanted.has("pubmed")) parallel.push(refreshPubmedSource(db, investigatorId));
  if (wanted.has("trials")) parallel.push(refreshTrialsSource(db, investigatorId));
  for (const settled of await Promise.allSettled(parallel)) {
    outcomes.push(settled.status === "fulfilled" ? settled.value : { source: "pubmed", ok: false, message: errMsg(settled.reason) });
  }

  // PubMed ran after the connectors, so re-apply their PMIDs to any new name-only rows.
  if (wanted.has("pubmed")) {
    const { data: rows } = await db.from("investigator_sources").select("source, meta").eq("investigator_id", investigatorId).in("source", ["orcid", "profiles"]);
    for (const r of rows ?? []) {
      const pmids = ((r.meta as { pmids?: string[] } | null)?.pmids ?? []).filter(Boolean);
      if (!pmids.length) continue;
      const method = r.source === "orcid" ? "orcid" : "profiles";
      for (let i = 0; i < pmids.length; i += 100) {
        await db
          .from("investigator_publications")
          .update({ identity_method: method, identity_status: "verified", match_confidence: "high" })
          .eq("investigator_id", investigatorId)
          .eq("identity_status", "unverified")
          .is("reviewed_at", null)
          .in("pmid", pmids.slice(i, i + 100));
      }
    }
    await syncSourceCountsFromCaches(db, investigatorId);
  }

  // Keep the suggestion engine's vectors in step with the evidence (no-op without an API key).
  if (process.env.OPENAI_API_KEY && (wanted.has("pubmed") || wanted.has("reporter") || wanted.has("profiles"))) {
    try {
      const { syncInvestigatorEmbeddings } = await import("@/lib/outreach/embeddings");
      await syncInvestigatorEmbeddings(db, investigatorId);
    } catch (e) {
      outcomes.push({ source: "pubmed", ok: false, message: `Embeddings: ${errMsg(e)}` });
    }
  }

  return outcomes;
}

export function summarizeOutcomes(outcomes: SourceRefreshOutcome[]): string {
  return outcomes.map((o) => o.message).join(" ");
}
