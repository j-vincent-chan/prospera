/**
 * PubMed ingestion via NCBI E-utilities (esearch + esummary).
 * Default query: last + first (+ middle initial) as [Author] AND UCSF [Affiliation] variants.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { investigatorListedWithUcsfAffiliation } from "@/lib/community/pubmed-author-match";
import {
  buildStrictPubmedTerm,
  pubmedNameResolutionError,
  resolvePubmedInvestigatorName,
  type PubmedInvestigatorName,
} from "@/lib/community/pubmed-query";
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

async function fetchEutils(url: string, opts?: { maxAttempts?: number }): Promise<Response> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 6);
  let lastRes: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await eutilsRateLimiter.schedule(() => fetch(url, { cache: "no-store" }));
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

const UCSF_AFFILIATION_SUFFIX =
  '("University of California San Francisco"[Affiliation] OR "University of California, San Francisco"[Affiliation] OR UCSF[Affiliation])';

function buildPubmedTerm(args: {
  firstName: string;
  lastName: string;
  middleInitial: string | null;
  fullName: string;
  pubmedQueryOverride: string | null;
}): string {
  if (args.pubmedQueryOverride?.trim()) {
    const override = args.pubmedQueryOverride.trim();
    if (/^https?:\/\//i.test(override) || /pubmed\.ncbi\.nlm\.nih\.gov/i.test(override)) {
      throw new Error(
        "pubmed_query_override must be PubMed search syntax (e.g. Anderson MS[Author]), not a PubMed URL."
      );
    }
    if (/\[affiliation\]/i.test(override)) return override;
    return `(${override}) AND ${UCSF_AFFILIATION_SUFFIX}`;
  }
  return buildStrictPubmedTerm({
    firstName: args.firstName,
    lastName: args.lastName,
    middleInitial: args.middleInitial,
    fullName: args.fullName,
  });
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
};

const EFETCH_BATCH = 80;

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

async function fetchPubmedRecordsXml(pmids: string[]): Promise<Map<string, string>> {
  const byPmid = new Map<string, string>();

  for (let i = 0; i < pmids.length; i += EFETCH_BATCH) {
    const batch = pmids.slice(i, i + EFETCH_BATCH);
    const efetchUrl = new URL(`${EUTILS}/efetch.fcgi`);
    efetchUrl.search = eutilsParams().toString();
    efetchUrl.searchParams.set("db", "pubmed");
    efetchUrl.searchParams.set("id", batch.join(","));
    efetchUrl.searchParams.set("retmode", "xml");

    const res = await fetchEutils(efetchUrl.toString());
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

/**
 * Fetch PubMed IDs for an investigator (paginated) and upsert into investigator_publications.
 */
export async function refreshInvestigatorPubMed(
  supabase: SupabaseClient,
  investigatorId: string,
  opts: { max?: number } = {}
): Promise<PubmedIngestResult> {
  const max = resolvePubmedMaxResults(opts.max);

  const { data: inv, error: invErr } = await supabase
    .from("investigators")
    .select("id, first_name, last_name, middle_initial, full_name, pubmed_query_override")
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

  const term = buildPubmedTerm({
    firstName: resolvedName.firstName,
    lastName: resolvedName.lastName,
    middleInitial: resolvedName.middleInitial,
    fullName: inv.full_name ?? "",
    pubmedQueryOverride: inv.pubmed_query_override ?? null,
  });
  if (!term) {
    throw new Error(
      "No PubMed query — set first/last name (and middle initial if applicable) or pubmed_query_override on the investigator."
    );
  }

  const idlist = await fetchPubmedIdList(term, max);
  if (!idlist.length) {
    return { inserted: 0, term, pmids: [], warning: "No PubMed IDs returned for this query." };
  }

  const investigatorName = resolvedName;

  const recordXmlByPmid = await fetchPubmedRecordsXml(idlist);
  const validatedPmids = idlist.filter((pmid) => {
    const articleXml = recordXmlByPmid.get(pmid);
    if (!articleXml) return false;
    return investigatorListedWithUcsfAffiliation(articleXml, investigatorName);
  });
  const rejectedPmids = idlist.length - validatedPmids.length;
  const validatedSet = new Set(validatedPmids);

  if (!validatedPmids.length) {
    await removeStalePubmedCacheRows(supabase, investigatorId, validatedSet);
    return {
      inserted: 0,
      term,
      pmids: [],
      rejectedPmids,
      warning:
        rejectedPmids > 0
          ? "PubMed hits did not match this investigator with a UCSF affiliation on the same author entry."
          : "No PubMed IDs returned for this query.",
    };
  }

  const result = (await fetchPubmedSummaries(validatedPmids)) ?? {};

  let inserted = 0;
  for (const pmid of validatedPmids) {
    const rec = result[pmid];
    if (!rec) continue;
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
        match_confidence: "high",
        provenance_note: `strict esearch + per-author UCSF affiliation check: ${term}`,
      },
      { onConflict: "investigator_id,pmid" }
    );
    if (!error) inserted += 1;
  }

  await removeStalePubmedCacheRows(supabase, investigatorId, validatedSet);

  if (resolvedName.middleInitial && !inv.middle_initial) {
    await supabase
      .from("investigators")
      .update({ middle_initial: resolvedName.middleInitial })
      .eq("id", investigatorId);
  }

  return { inserted, term, pmids: validatedPmids, rejectedPmids };
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
  const { data: existing, error: listErr } = await supabase
    .from("investigator_publications")
    .select("pmid")
    .eq("investigator_id", investigatorId)
    .eq("source", "pubmed_eutils");

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
  validatedPmids: Set<string>
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
    .filter((pmid) => pmid && !validatedPmids.has(pmid));

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
