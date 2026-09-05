/**
 * PubMed ingestion via NCBI E-utilities (esearch + efetch + esummary).
 *
 * Identity ladder (PR 0.1b, DECISIONS D11):
 *   Name rungs, tried in order until one yields ≥ 1 verified item:
 *   a. pubmed_query_override                → source identity_method 'manual'
 *   b. strict full name + UCSF affiliation  → 'affiliation'
 *   c. initials variant + UCSF affiliation  → 'initials'
 *   Additive sources, always run, unioned with the name rung's result:
 *   d. ORCID `[auid]` search                → rows 'orcid'         (verified, no affiliation clause)
 *   e. RePORTER publication linkage         → rows 'reporter_link' (verified, last name must be on the record)
 * Name-rung hits that pass the per-author UCSF check are verified 'affiliation'
 * rows; the rest stay as unverified 'name_only' evidence unless d or e verify them.
 * Per row, when several sources agree: orcid > affiliation > reporter_link.
 *
 * PR 0.2: the efetch XML is kept and parsed (pubmed-record.ts) so each row also
 * stores MeSH headings, publication types, the abstract, the investigator's
 * author position and mesh_fetched_at.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  investigatorLastNameListed,
  investigatorListedWithUcsfAffiliation,
} from "@/lib/community/pubmed-author-match";
import {
  buildInitialsPubmedTerm,
  buildOrcidPubmedTerm,
  buildStrictPubmedTerm,
  pubmedNameResolutionError,
  resolvePubmedInvestigatorName,
  withUcsfAffiliation,
  type PubmedInvestigatorName,
} from "@/lib/community/pubmed-query";
import { captureFieldsFromXml } from "@/lib/community/pubmed-record";
import type { IdentityMethod } from "@/lib/investigators/sources";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const PUBMED_PAGE_SIZE = 200;
const ESUMMARY_BATCH = 200;
/** ~3 req/s without API key; ~10 req/s with NCBI_API_KEY. */
const EUTILS_MIN_INTERVAL_MS = Number(
  process.env.NCBI_EUTILS_INTERVAL_MS ??
    (process.env.NCBI_API_KEY?.trim() ? 110 : 350)
);

const eutilsRateLimiter = new AsyncRateLimiter(EUTILS_MIN_INTERVAL_MS);

function eutilsParams(): URLSearchParams {
  const p = new URLSearchParams();
  p.set("tool", "prospera_funding_app");
  const email = process.env.NCBI_CONTACT_EMAIL?.trim();
  if (email) p.set("email", email);
  const apiKey = process.env.NCBI_API_KEY?.trim();
  if (apiKey) p.set("api_key", apiKey);
  return p;
}

function isRetryableEutilsStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function readEutilsError(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return res.statusText || `HTTP ${res.status}`;
    if (text.startsWith("{")) {
      const json = JSON.parse(text) as {
        esearchresult?: { ERROR?: string };
        error?: string;
        message?: string;
      };
      return (
        json.esearchresult?.ERROR ?? json.error ?? json.message ?? text.slice(0, 300)
      );
    }
    return text.slice(0, 300);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

async function fetchEutils(url: string, opts?: { maxAttempts?: number; init?: RequestInit }): Promise<Response> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 6);
  let lastRes: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await eutilsRateLimiter.schedule(() => fetch(url, { cache: "no-store", ...opts?.init }));
    lastRes = res;
    if (!isRetryableEutilsStatus(res.status)) return res;
    if (attempt >= maxAttempts) return res;
    const backoffMs = Math.min(60_000, 2000 * 2 ** (attempt - 1));
    await sleep(backoffMs);
  }
  return lastRes ?? new Response(null, { status: 503 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throwIfEutilsFailed(res: Response, step: string): Promise<void> {
  if (res.ok) return;
  const detail = await readEutilsError(res);
  throw new Error(`PubMed ${step} failed (${res.status}): ${detail}`);
}

/**
 * PubMed pulls are intentionally uncapped per investigator.
 * `optsMax` is ignored and retained only for backward compatibility.
 */
export function resolvePubmedMaxResults(optsMax?: number): number | null {
  void optsMax;
  return null;
}

/** Rung a: a person-supplied esearch term. Affiliation is added unless the override carries its own. */
export function buildOverridePubmedTerm(override: string): string {
  const term = override.trim();
  if (/^https?:\/\//i.test(term) || /pubmed\.ncbi\.nlm\.nih\.gov/i.test(term)) {
    throw new Error(
      "pubmed_query_override must be PubMed search syntax (e.g. Anderson MS[Author]), not a PubMed URL."
    );
  }
  if (/\[affiliation\]/i.test(term)) return term;
  return withUcsfAffiliation(term);
}

type EsearchResult = {
  esearchresult?: {
    idlist?: string[];
    count?: string;
  };
};

type EsummaryResult = {
  result?: Record<
    string,
    {
      title?: string;
      fulljournalname?: string;
      pubdate?: string;
      sortpubdate?: string;
    }
  >;
};

export type PubmedIngestResult = {
  inserted: number;
  term: string;
  pmids: string[];
  rejectedPmids?: number;
  warning?: string;
  /** Name rung that matched, else the first additive source that contributed; null when nothing did. */
  rung: PubmedLadderRung | null;
  /** Every rung that contributed a verified row, in ladder order. */
  contributing: PubmedLadderRung[];
  /** What to record on the investigator_sources row. */
  identityMethod: IdentityMethod | null;
  attempts: PubmedLadderAttempt[];
};

/** Ladder default; the MeSH backfill runs at EFETCH_MAX_BATCH. */
const EFETCH_BATCH = 80;
/** NCBI asks for POST above ~200 ids per efetch call; we POST always and cap here. */
export const EFETCH_MAX_BATCH = 200;

/** How many name-only (unverified) hits to keep per person, most recent first. */
export const NAME_ONLY_KEEP = 25;

type PreservedIdentity = { identity_method: string; identity_status: string };

/**
 * Cached rows whose identity must survive a refresh: reviewed by a person
 * (confirmed or rejected), or verified through ORCID / UCSF Profiles.
 */
async function fetchPreservedIdentity(
  supabase: SupabaseClient,
  investigatorId: string
): Promise<Map<string, PreservedIdentity>> {
  const { data } = await supabase
    .from("investigator_publications")
    .select("pmid, identity_method, identity_status, reviewed_at")
    .eq("investigator_id", investigatorId);
  const out = new Map<string, PreservedIdentity>();
  for (const r of data ?? []) {
    const method = String(r.identity_method ?? "");
    const reviewed = r.reviewed_at != null;
    if (reviewed || method === "orcid" || method === "profiles" || method === "manual" || method === "reporter_link") {
      out.set(String(r.pmid), { identity_method: method, identity_status: String(r.identity_status ?? "verified") });
    }
  }
  return out;
}

async function fetchPubmedIdList(term: string, maxResults?: number | null): Promise<string[]> {
  const ids: string[] = [];
  let retstart = 0;

  while (true) {
    const remaining = maxResults == null ? PUBMED_PAGE_SIZE : Math.max(0, maxResults - retstart);
    if (remaining <= 0) break;
    const retmax = Math.min(PUBMED_PAGE_SIZE, remaining);
    const esearchUrl = new URL(`${EUTILS}/esearch.fcgi`);
    esearchUrl.search = eutilsParams().toString();
    esearchUrl.searchParams.set("db", "pubmed");
    esearchUrl.searchParams.set("term", term);
    esearchUrl.searchParams.set("retmax", String(retmax));
    esearchUrl.searchParams.set("retstart", String(retstart));
    esearchUrl.searchParams.set("retmode", "json");
    esearchUrl.searchParams.set("sort", "pub+date");

    const esRes = await fetchEutils(esearchUrl.toString());
    await throwIfEutilsFailed(esRes, "esearch");
    const esJson = (await esRes.json()) as EsearchResult;
    const esearchError = esJson.esearchresult && "ERROR" in esJson.esearchresult
      ? String((esJson.esearchresult as { ERROR?: string }).ERROR ?? "")
      : "";
    if (esearchError) {
      throw new Error(`PubMed esearch rejected the query: ${esearchError}`);
    }
    const page = esJson.esearchresult?.idlist ?? [];
    if (!page.length) break;
    ids.push(...page);
    if (page.length < retmax) break;
    retstart += page.length;
  }

  return Array.from(new Set(ids));
}

/**
 * efetch XML per PMID, POSTed in batches. PMIDs PubMed does not return (deleted,
 * or a Bookshelf `PubmedBookArticle`) are simply absent from the map.
 */
export async function fetchPubmedRecordsXml(
  pmids: string[],
  opts: { batchSize?: number } = {}
): Promise<Map<string, string>> {
  const batchSize = Math.min(EFETCH_MAX_BATCH, Math.max(1, opts.batchSize ?? EFETCH_BATCH));
  const byPmid = new Map<string, string>();
  const unique = Array.from(new Set(pmids.map((p) => p.trim()).filter((p) => /^\d+$/.test(p))));

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const body = eutilsParams();
    body.set("db", "pubmed");
    body.set("id", batch.join(","));
    body.set("retmode", "xml");

    const res = await fetchEutils(`${EUTILS}/efetch.fcgi`, {
      init: { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() },
    });
    await throwIfEutilsFailed(res, "efetch");
    const xml = await res.text();
    const articles = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/gi) ?? [];
    for (const article of articles) {
      const pmid = article.match(/<PMID[^>]*>(\d+)<\/PMID>/i)?.[1];
      if (pmid) byPmid.set(pmid, article);
    }
  }

  return byPmid;
}

async function fetchPubmedSummaries(pmids: string[]): Promise<EsummaryResult["result"]> {
  const merged: NonNullable<EsummaryResult["result"]> = {};

  for (let i = 0; i < pmids.length; i += ESUMMARY_BATCH) {
    const batch = pmids.slice(i, i + ESUMMARY_BATCH);
    const esummaryUrl = new URL(`${EUTILS}/esummary.fcgi`);
    esummaryUrl.search = eutilsParams().toString();
    esummaryUrl.searchParams.set("db", "pubmed");
    esummaryUrl.searchParams.set("id", batch.join(","));
    esummaryUrl.searchParams.set("retmode", "json");

    const sumRes = await fetchEutils(esummaryUrl.toString());
    await throwIfEutilsFailed(sumRes, "esummary");
    const sumJson = (await sumRes.json()) as EsummaryResult;
    Object.assign(merged, sumJson.result ?? {});
  }

  return merged;
}

// ---------------------------------------------------------------------------
// RePORTER publication linkage (rung e)
// ---------------------------------------------------------------------------

const REPORTER_PUBLICATIONS_SEARCH = "https://api.reporter.nih.gov/v2/publications/search";
const REPORTER_PUBLICATIONS_PAGE = 500;
const reporterPublicationsLimiter = new AsyncRateLimiter(Number(process.env.REPORTER_MIN_INTERVAL_MS ?? 250));

/**
 * `1R01AI052116-01A1` → `R01AI052116`. Activity codes are letter + two digits
 * (R01, K99) or two letters + one digit (UG3, DP1). Null when not an NIH number.
 */
export function coreProjectNum(projectNum: string | null | undefined): string | null {
  const m = String(projectNum ?? "")
    .trim()
    .replace(/^\d/, "")
    .match(/^((?:[A-Z]\d{2}|[A-Z]{2}\d)[A-Z]{2}\d{6})/i);
  return m ? m[1]!.toUpperCase() : null;
}

/** PMIDs RePORTER links to any of the given core project numbers (paged, deduplicated). */
export async function fetchReporterLinkedPmids(coreProjectNums: string[]): Promise<string[]> {
  const nums = Array.from(new Set(coreProjectNums.map((n) => n.trim().toUpperCase()).filter(Boolean)));
  if (!nums.length) return [];
  const out = new Set<string>();
  for (let offset = 0; ; offset += REPORTER_PUBLICATIONS_PAGE) {
    const res = await reporterPublicationsLimiter.schedule(() =>
      fetch(REPORTER_PUBLICATIONS_SEARCH, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ criteria: { core_project_nums: nums }, offset, limit: REPORTER_PUBLICATIONS_PAGE }),
        cache: "no-store",
      })
    );
    if (!res.ok) {
      throw new Error(`RePORTER publications search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { results?: Array<{ pmid?: number | string }>; meta?: { total?: number } };
    const rows = json.results ?? [];
    for (const r of rows) {
      const pmid = String(r.pmid ?? "").trim();
      if (/^\d+$/.test(pmid)) out.add(pmid);
    }
    const total = json.meta?.total ?? 0;
    if (!rows.length || offset + rows.length >= total || offset + REPORTER_PUBLICATIONS_PAGE >= 10_000) break;
  }
  return Array.from(out);
}

async function loadCoreProjectNums(supabase: SupabaseClient, investigatorId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("investigator_nih_grants")
    .select("project_num")
    .eq("investigator_id", investigatorId)
    .neq("identity_status", "rejected");
  if (error) throw new Error(`Could not list NIH grants: ${error.message}`);
  return Array.from(
    new Set((data ?? []).map((r) => coreProjectNum(String(r.project_num ?? ""))).filter((n): n is string => !!n))
  );
}

// ---------------------------------------------------------------------------
// Identity ladder
// ---------------------------------------------------------------------------

export type PubmedLadderRung = "override" | "strict" | "initials" | "orcid" | "reporter_link";

export type PubmedLadderAttempt = { rung: PubmedLadderRung; term: string; hits: number; verified: number };

export type PubmedLadderInput = {
  name: PubmedInvestigatorName;
  pubmedQueryOverride: string | null;
  orcid: string | null;
  /** Core project numbers of the investigator's non-rejected NIH grants. */
  coreProjectNums: string[];
};

/** Network functions the ladder needs; tests substitute mocks. */
export type PubmedLadderDeps = {
  esearch: (term: string) => Promise<string[]>;
  efetchXml: (pmids: string[]) => Promise<Map<string, string>>;
  reporterLinkedPmids: (coreProjectNums: string[]) => Promise<string[]>;
};

export type PubmedVerifiedMethod = "affiliation" | "orcid" | "reporter_link";

export type PubmedLadderOutcome = {
  /** Name rung that matched (a–c); else the first additive source that contributed; else null. */
  rung: PubmedLadderRung | null;
  /** Every rung that contributed at least one verified PMID, in ladder order. */
  contributing: PubmedLadderRung[];
  /** Value for investigator_sources.identity_method. */
  identityMethod: IdentityMethod | null;
  /** Term of the matched name rung, or of the last name rung tried. */
  term: string;
  /** Verified PMIDs in insertion order (name rung, then ORCID, then RePORTER). */
  verifiedPmids: string[];
  /** identity_method per verified PMID (orcid > affiliation > reporter_link when several apply). */
  methodByPmid: Map<string, PubmedVerifiedMethod>;
  /** Search term or linkage label behind each method, for provenance notes. */
  termByMethod: Partial<Record<PubmedVerifiedMethod, string>>;
  /** Name-rung hits that no source verified (kept as unverified evidence). */
  nameOnlyPmids: string[];
  rejected: number;
  attempts: PubmedLadderAttempt[];
  /** Every record efetch returned while walking the ladder, keyed by PMID (PR 0.2 reuses it for capture). */
  xmlByPmid: Map<string, string>;
};

const RUNG_SOURCE_METHOD: Record<PubmedLadderRung, IdentityMethod> = {
  override: "manual",
  strict: "affiliation",
  initials: "initials",
  orcid: "orcid",
  reporter_link: "reporter_link",
};

export const liveLadderDeps: PubmedLadderDeps = {
  esearch: (term) => fetchPubmedIdList(term, null),
  efetchXml: fetchPubmedRecordsXml,
  reporterLinkedPmids: fetchReporterLinkedPmids,
};

/**
 * Name rungs a–c stop at the first one with ≥ 1 verified item; d and e always
 * run and add to the result (D11). Pure apart from `deps`, so each rung is
 * unit-testable with mocked esearch responses.
 */
export async function runPubmedIdentityLadder(
  input: PubmedLadderInput,
  deps: PubmedLadderDeps = liveLadderDeps
): Promise<PubmedLadderOutcome> {
  const attempts: PubmedLadderAttempt[] = [];
  const nameOnly: string[] = [];
  const seenNameOnly = new Set<string>();
  const methodByPmid = new Map<string, PubmedVerifiedMethod>();
  const termByMethod: Partial<Record<PubmedVerifiedMethod, string>> = {};
  const contributing: PubmedLadderRung[] = [];
  const xmlCache = new Map<string, string>();
  let rejected = 0;
  let term = "";
  let nameRung: PubmedLadderRung | null = null;

  // a–c: first name rung with a verified item wins.
  const nameRungs: Array<{ rung: PubmedLadderRung; term: string }> = [];
  if (input.pubmedQueryOverride?.trim()) {
    nameRungs.push({ rung: "override", term: buildOverridePubmedTerm(input.pubmedQueryOverride) });
  }
  const strict = buildStrictPubmedTerm(input.name);
  if (strict) nameRungs.push({ rung: "strict", term: strict });
  const initials = buildInitialsPubmedTerm(input.name);
  if (initials && initials !== strict) nameRungs.push({ rung: "initials", term: initials });

  for (const { rung, term: t } of nameRungs) {
    term = t;
    const ids = await deps.esearch(t);
    if (!ids.length) {
      attempts.push({ rung, term: t, hits: 0, verified: 0 });
      continue;
    }
    const xmlByPmid = await deps.efetchXml(ids);
    for (const [pmid, xml] of xmlByPmid) xmlCache.set(pmid, xml);
    const verified = ids.filter((pmid) => {
      const xml = xmlByPmid.get(pmid);
      return !!xml && investigatorListedWithUcsfAffiliation(xml, input.name);
    });
    const verifiedSet = new Set(verified);
    for (const pmid of ids) {
      if (!verifiedSet.has(pmid) && !seenNameOnly.has(pmid)) {
        seenNameOnly.add(pmid);
        nameOnly.push(pmid);
      }
    }
    attempts.push({ rung, term: t, hits: ids.length, verified: verified.length });
    rejected += ids.length - verified.length;
    if (verified.length) {
      nameRung = rung;
      contributing.push(rung);
      termByMethod.affiliation = t;
      for (const pmid of verified) methodByPmid.set(pmid, "affiliation");
      break;
    }
  }

  // d: ORCID author id — additive; the identifier is the evidence, no affiliation clause.
  const orcidTerm = buildOrcidPubmedTerm(input.orcid);
  if (orcidTerm) {
    const ids = await deps.esearch(orcidTerm);
    attempts.push({ rung: "orcid", term: orcidTerm, hits: ids.length, verified: ids.length });
    if (ids.length) {
      contributing.push("orcid");
      termByMethod.orcid = orcidTerm;
      for (const pmid of ids) methodByPmid.set(pmid, "orcid");
    }
  }

  // e: RePORTER publication linkage — additive; the last name must be on the author list.
  const nums = Array.from(new Set(input.coreProjectNums.filter(Boolean)));
  if (nums.length) {
    const label = `RePORTER publications linked to ${nums.join(", ")}`;
    const linked = await deps.reporterLinkedPmids(nums);
    let passing: string[] = [];
    if (linked.length) {
      const unknown = linked.filter((pmid) => !methodByPmid.has(pmid));
      const xmlByPmid = unknown.length ? await deps.efetchXml(unknown) : new Map<string, string>();
      for (const [pmid, xml] of xmlByPmid) xmlCache.set(pmid, xml);
      passing = linked.filter((pmid) => {
        if (methodByPmid.has(pmid)) return true;
        const xml = xmlByPmid.get(pmid);
        return !!xml && investigatorLastNameListed(xml, input.name);
      });
    }
    attempts.push({ rung: "reporter_link", term: label, hits: linked.length, verified: passing.length });
    rejected += linked.length - passing.length;
    const added = passing.filter((pmid) => !methodByPmid.has(pmid));
    if (added.length) {
      contributing.push("reporter_link");
      termByMethod.reporter_link = label;
      for (const pmid of added) methodByPmid.set(pmid, "reporter_link");
    }
  }

  const rung = nameRung ?? contributing[0] ?? null;
  if (!term) term = orcidTerm || (nums.length ? attempts[attempts.length - 1]?.term ?? "" : "");

  return {
    rung,
    contributing,
    identityMethod: rung ? RUNG_SOURCE_METHOD[rung] : null,
    term,
    verifiedPmids: Array.from(methodByPmid.keys()),
    methodByPmid,
    termByMethod,
    nameOnlyPmids: nameOnly.filter((pmid) => !methodByPmid.has(pmid)).slice(0, NAME_ONLY_KEEP),
    rejected,
    attempts,
    xmlByPmid: xmlCache,
  };
}

function provenanceFor(method: PubmedVerifiedMethod, nameRung: PubmedLadderRung | null, term: string): string {
  switch (method) {
    case "orcid":
      return `ORCID author-id search: ${term}`;
    case "reporter_link":
      return `${term}; investigator last name on the author list`;
    case "affiliation": {
      const how =
        nameRung === "override" ? "pubmed_query_override" : nameRung === "initials" ? "initials" : "strict";
      return `${how} esearch + per-author UCSF affiliation check: ${term}`;
    }
  }
}

/**
 * Walk the identity ladder for an investigator and upsert into investigator_publications.
 */
export async function refreshInvestigatorPubMed(
  supabase: SupabaseClient,
  investigatorId: string,
  opts: { max?: number } = {}
): Promise<PubmedIngestResult> {
  void resolvePubmedMaxResults(opts.max);

  const { data: inv, error: invErr } = await supabase
    .from("investigators")
    .select("id, first_name, last_name, middle_initial, full_name, pubmed_query_override, orcid, nih_profile_id")
    .eq("id", investigatorId)
    .maybeSingle();

  if (invErr || !inv) {
    throw new Error(invErr?.message ?? "Investigator not found");
  }

  const investigatorInput = {
    firstName: String(inv.first_name ?? "").trim(),
    lastName: String(inv.last_name ?? "").trim(),
    middleInitial: inv.middle_initial ? String(inv.middle_initial).trim() : null,
    fullName: inv.full_name ?? "",
  };
  const resolutionError = pubmedNameResolutionError(investigatorInput);
  if (resolutionError) {
    throw new Error(resolutionError);
  }

  const resolvedName = resolvePubmedInvestigatorName(investigatorInput);

  await pruneInvalidInvestigatorPubmedCache(supabase, investigatorId, investigatorInput);

  const coreProjectNums = inv.nih_profile_id ? await loadCoreProjectNums(supabase, investigatorId) : [];
  const outcome = await runPubmedIdentityLadder({
    name: investigatorInput,
    pubmedQueryOverride: inv.pubmed_query_override ?? null,
    orcid: inv.orcid ?? null,
    coreProjectNums,
  });
  if (!outcome.attempts.length) {
    throw new Error(
      "No PubMed query — set first/last name (and middle initial if applicable) or pubmed_query_override on the investigator."
    );
  }

  const { term, verifiedPmids, nameOnlyPmids, methodByPmid, termByMethod } = outcome;
  const verifiedSet = new Set(verifiedPmids);
  const nameRung = outcome.rung && outcome.rung !== "orcid" && outcome.rung !== "reporter_link" ? outcome.rung : null;

  // Rows a person reviewed, or that ORCID / UCSF Profiles / RePORTER verified, keep their identity.
  const preserved = await fetchPreservedIdentity(supabase, investigatorId);
  const keep = new Set<string>([...verifiedPmids, ...nameOnlyPmids, ...preserved.keys()]);

  const base = {
    term,
    rung: outcome.rung,
    contributing: outcome.contributing,
    identityMethod: outcome.identityMethod,
    attempts: outcome.attempts,
    rejectedPmids: outcome.rejected,
  };

  if (!verifiedPmids.length && !nameOnlyPmids.length) {
    await removeStalePubmedCacheRows(supabase, investigatorId, keep);
    return {
      ...base,
      inserted: 0,
      pmids: [],
      warning:
        outcome.rejected > 0
          ? "PubMed hits did not match this investigator with a UCSF affiliation on the same author entry."
          : "No PubMed IDs returned for any ladder rung.",
    };
  }

  const allPmids = [...verifiedPmids, ...nameOnlyPmids];
  const result = (await fetchPubmedSummaries(allPmids)) ?? {};

  // PR 0.2: MeSH, publication types, abstract and author position come from the
  // efetch XML. The ladder already fetched the name-rung and RePORTER records;
  // ORCID hits were only esearched, so fetch whatever is still missing.
  const xmlByPmid = new Map(outcome.xmlByPmid);
  const missingXml = allPmids.filter((pmid) => !xmlByPmid.has(pmid));
  if (missingXml.length) {
    for (const [pmid, xml] of await fetchPubmedRecordsXml(missingXml)) xmlByPmid.set(pmid, xml);
  }
  const fetchedAt = new Date().toISOString();
  const captureSubject = { name: investigatorInput, orcid: inv.orcid ?? null };

  let inserted = 0;
  for (const pmid of allPmids) {
    const rec = result[pmid];
    if (!rec) continue;
    const kept = preserved.get(pmid);
    if (kept?.identity_status === "rejected") continue;
    const verified = verifiedSet.has(pmid);
    const method = methodByPmid.get(pmid) ?? "affiliation";
    const identity = kept
      ? { identity_method: kept.identity_method, identity_status: kept.identity_status }
      : verified
        ? { identity_method: method, identity_status: "verified" }
        : { identity_method: "name_only", identity_status: "unverified" };
    const title = (rec.title ?? "").replace(/\s+/g, " ").trim() || "(untitled)";
    const journal = rec.fulljournalname ?? null;
    const pubdateRaw = rec.sortpubdate ?? rec.pubdate ?? null;
    let publication_date: string | null = null;
    if (pubdateRaw) {
      const s = String(pubdateRaw).trim();
      const slash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
      if (slash) {
        publication_date = `${slash[1]}-${slash[2]}-${slash[3]}`;
      } else {
        const y = s.slice(0, 4);
        const m = s.slice(4, 6);
        const d = s.slice(6, 8);
        if (/^\d{4}$/.test(y)) {
          publication_date = m && d ? `${y}-${m}-${d}` : `${y}-01-01`;
        }
      }
    }

    const { error } = await supabase.from("investigator_publications").upsert(
      {
        investigator_id: investigatorId,
        pmid,
        title,
        journal,
        publication_date,
        source: "pubmed_eutils",
        raw_json: rec as unknown as Record<string, unknown>,
        match_confidence: verified || identity.identity_status === "verified" ? "high" : "medium",
        provenance_note: verified
          ? provenanceFor(method, nameRung, termByMethod[method] ?? term)
          : `name-only esearch hit, no UCSF affiliation on the author entry: ${term}`,
        ...identity,
        ...captureFieldsFromXml(xmlByPmid.get(pmid) ?? null, captureSubject, fetchedAt),
      },
      { onConflict: "investigator_id,pmid" }
    );
    if (!error && verified) inserted += 1;
  }

  await removeStalePubmedCacheRows(supabase, investigatorId, keep);

  if (resolvedName.middleInitial && !inv.middle_initial) {
    await supabase
      .from("investigators")
      .update({ middle_initial: resolvedName.middleInitial })
      .eq("id", investigatorId);
  }

  return { ...base, inserted, pmids: verifiedPmids };
}

/**
 * efetch + per-author UCSF/middle-initial check for cached PMIDs (self-heal stale rows).
 */
export async function filterPubmedPmidsForInvestigator(
  pmids: string[],
  investigator: PubmedInvestigatorName
): Promise<{ validated: string[]; rejected: string[] }> {
  const unique = Array.from(new Set(pmids.map((pmid) => pmid.trim()).filter(Boolean)));
  if (unique.length === 0) return { validated: [], rejected: [] };

  const recordXmlByPmid = await fetchPubmedRecordsXml(unique);
  const validated: string[] = [];
  const rejected: string[] = [];

  for (const pmid of unique) {
    const articleXml = recordXmlByPmid.get(pmid);
    if (articleXml && investigatorListedWithUcsfAffiliation(articleXml, investigator)) {
      validated.push(pmid);
    } else {
      rejected.push(pmid);
    }
  }

  return { validated, rejected };
}

/**
 * Remove PMIDs that failed the per-author UCSF affiliation re-check.
 *
 * Only unreviewed 'affiliation' rows are eligible: rows a person reviewed, or
 * that ORCID, UCSF Profiles, RePORTER linkage or a manual query verified, were
 * never justified by affiliation and must survive an affiliation re-check
 * (D11). Name-only rows stay as unverified evidence for a strategist. Before
 * PR 0.1b the community-signals sync used this to delete every non-affiliation
 * row on each run.
 */
export async function deleteInvestigatorPubmedPmids(
  supabase: SupabaseClient,
  investigatorId: string,
  pmids: string[]
): Promise<void> {
  if (pmids.length === 0) return;

  const chunkSize = 100;
  for (let i = 0; i < pmids.length; i += chunkSize) {
    const chunk = pmids.slice(i, i + chunkSize);
    const { error: delErr } = await supabase
      .from("investigator_publications")
      .delete()
      .eq("investigator_id", investigatorId)
      .eq("source", "pubmed_eutils")
      .eq("identity_method", "affiliation")
      .is("reviewed_at", null)
      .in("pmid", chunk);
    if (delErr) {
      throw new Error(`Could not remove invalid PubMed rows: ${delErr.message}`);
    }
  }
}

export async function pruneInvalidInvestigatorPubmedCache(
  supabase: SupabaseClient,
  investigatorId: string,
  investigator: PubmedInvestigatorName
): Promise<number> {
  // Only affiliation-verified, unreviewed rows are re-checked. Name-only rows
  // are already unverified, and reviewed / ORCID / Profiles rows are kept.
  const { data: existing, error: listErr } = await supabase
    .from("investigator_publications")
    .select("pmid")
    .eq("investigator_id", investigatorId)
    .eq("source", "pubmed_eutils")
    .eq("identity_method", "affiliation")
    .is("reviewed_at", null);

  if (listErr) {
    throw new Error(`Could not list cached PubMed rows: ${listErr.message}`);
  }

  const pmids = (existing ?? [])
    .map((row) => String(row.pmid ?? "").trim())
    .filter(Boolean);
  if (pmids.length === 0) return 0;

  const { rejected } = await filterPubmedPmidsForInvestigator(pmids, investigator);
  if (rejected.length === 0) return 0;

  await deleteInvestigatorPubmedPmids(supabase, investigatorId, rejected);
  return rejected.length;
}

async function removeStalePubmedCacheRows(
  supabase: SupabaseClient,
  investigatorId: string,
  keepPmids: Set<string>
) {
  const { data: existing, error: listErr } = await supabase
    .from("investigator_publications")
    .select("pmid")
    .eq("investigator_id", investigatorId)
    .eq("source", "pubmed_eutils");

  if (listErr) {
    throw new Error(`Could not list cached PubMed rows: ${listErr.message}`);
  }

  const stalePmids = (existing ?? [])
    .map((row) => String(row.pmid ?? "").trim())
    .filter((pmid) => pmid && !keepPmids.has(pmid));

  if (stalePmids.length === 0) return;

  const chunkSize = 100;
  for (let i = 0; i < stalePmids.length; i += chunkSize) {
    const chunk = stalePmids.slice(i, i + chunkSize);
    const { error: delErr } = await supabase
      .from("investigator_publications")
      .delete()
      .eq("investigator_id", investigatorId)
      .eq("source", "pubmed_eutils")
      .in("pmid", chunk);
    if (delErr) {
      throw new Error(`Could not remove stale PubMed rows: ${delErr.message}`);
    }
  }
}
