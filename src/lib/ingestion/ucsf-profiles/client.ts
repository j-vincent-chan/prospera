/**
 * UCSF Profiles connector (profiles.ucsf.edu).
 *
 * The public JSON API only looks people up by an identifier
 * (`ProfilesURLName`, `EPPN`, `EmployeeID`, `FNO`, `Person`, `URL`); there is
 * no name search. Profiles URL names are `first.last` for nearly everyone, so
 * we guess that from the directory name and let a strategist correct it on the
 * profile page. A match is accepted only when the returned surname agrees.
 */

import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

export const PROFILES_API = "https://api.profiles.ucsf.edu/json/v2/";
const SOURCE_TAG = process.env.UCSF_PROFILES_SOURCE_TAG?.trim() || "prospera";

// Be a polite client: one request every 600ms across the process.
const limiter = new AsyncRateLimiter(600);

export type ProfilesPublication = {
  pmid: string | null;
  title: string | null;
  journal: string | null;
  date: string | null;
  year: number | null;
  claimed: boolean;
};

export type ProfilesFunding = {
  sponsor_award_id: string | null;
  sponsor: string | null;
  title: string | null;
  role: string | null;
  start: string | null;
  end: string | null;
};

export type UcsfProfile = {
  urlName: string;
  url: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  department: string | null;
  school: string | null;
  title: string | null;
  titles: string[];
  orcid: string | null;
  keywords: string[];
  freetextKeywords: string[];
  narrative: string | null;
  photoUrl: string | null;
  publicationCount: number;
  publications: ProfilesPublication[];
  funding: ProfilesFunding[];
};

export class ProfilesNotFoundError extends Error {
  constructor(public readonly urlName: string) {
    super(`No UCSF Profiles page for ${urlName}`);
  }
}

/** "Mei-Ling Chen" → "mei-ling.chen"; strips accents and anything Profiles doesn't use. */
export function guessProfilesUrlName(firstName: string, lastName: string): string | null {
  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "")
      .trim();
  const f = clean(firstName.split(/\s+/)[0] ?? "");
  const l = clean(lastName.replace(/\s+/g, ""));
  if (!f || !l) return null;
  return `${f}.${l}`;
}

/** Accept a pasted profile URL, a bare URL name, or "First Last". */
export function normalizeProfilesUrlName(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const m = t.match(/profiles\.ucsf\.edu\/([a-z0-9.-]+)/i);
  if (m) return m[1]!.toLowerCase();
  if (/^[a-z0-9.-]+$/i.test(t)) return t.toLowerCase();
  const parts = t.split(/\s+/);
  if (parts.length >= 2) return guessProfilesUrlName(parts[0]!, parts[parts.length - 1]!);
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter((s): s is string => Boolean(s)) : [];
}

export function parseProfilesRecord(raw: Record<string, unknown>, urlName: string): UcsfProfile {
  const pubs = Array.isArray(raw.Publications) ? (raw.Publications as Array<Record<string, unknown>>) : [];
  const funding = Array.isArray(raw.ResearchActivitiesAndFunding)
    ? (raw.ResearchActivitiesAndFunding as Array<Record<string, unknown>>)
    : [];
  const url = str(raw.ProfilesURL) ?? `https://profiles.ucsf.edu/${urlName}`;
  const urlFromRecord = url.match(/profiles\.ucsf\.edu\/([a-z0-9.-]+)/i)?.[1]?.toLowerCase() ?? urlName;
  return {
    urlName: urlFromRecord,
    url,
    name: str(raw.Name) ?? "",
    firstName: str(raw.FirstName),
    lastName: str(raw.LastName),
    email: str(raw.Email)?.toLowerCase() ?? null,
    department: str(raw.Department),
    school: str(raw.School),
    title: str(raw.Title),
    titles: strList(raw.Titles),
    orcid: str(raw.ORCID),
    keywords: strList(raw.Keywords),
    freetextKeywords: strList(raw.FreetextKeywords),
    narrative: str(raw.Narrative),
    photoUrl: str(raw.PhotoURL),
    publicationCount: typeof raw.PublicationCount === "number" ? raw.PublicationCount : pubs.length,
    publications: pubs.map((p) => {
      const sources = Array.isArray(p.PublicationSource) ? (p.PublicationSource as Array<Record<string, unknown>>) : [];
      const pubmed = sources.find((s) => str(s.PMID)) ?? sources.find((s) => /pubmed/i.test(String(s.PublicationSourceName ?? "")));
      const pmid = str(pubmed?.PMID) ?? str(pubmed?.PublicationSourceURL)?.match(/pubmed\/(\d+)/)?.[1] ?? null;
      const year = typeof p.Year === "number" ? p.Year : Number.parseInt(String(p.Year ?? ""), 10) || null;
      return {
        pmid,
        title: str(p.Title),
        journal: str(p.PublicationMedlineTA) ?? str(p.Publication),
        date: str(p.Date),
        year,
        claimed: p.Claimed === true,
      };
    }),
    funding: funding.map((f) => ({
      sponsor_award_id: str(f.SponsorAwardID),
      sponsor: str(f.Sponsor),
      title: str(f.Title),
      role: str(f.Role),
      start: str(f.StartDate),
      end: str(f.EndDate),
    })),
  };
}

/** Fetch one profile by URL name. Throws ProfilesNotFoundError when Profiles has no such page. */
export async function fetchUcsfProfile(urlName: string, opts: { publications?: boolean } = {}): Promise<UcsfProfile> {
  const url = new URL(PROFILES_API);
  url.searchParams.set("source", SOURCE_TAG);
  url.searchParams.set("ProfilesURLName", urlName);
  if (opts.publications !== false) url.searchParams.set("publications", "full");

  const res = await limiter.schedule(() =>
    fetch(url.toString(), { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000) }),
  );
  if (res.status === 404) throw new ProfilesNotFoundError(urlName);
  if (!res.ok) throw new Error(`UCSF Profiles API ${res.status}`);
  const json = (await res.json()) as { Profiles?: Array<Record<string, unknown>>; error?: string };
  if (json.error) {
    if (/could not look up|not found|no profile/i.test(json.error)) throw new ProfilesNotFoundError(urlName);
    throw new Error(`UCSF Profiles API: ${json.error}`);
  }
  const record = json.Profiles?.[0];
  if (!record) throw new ProfilesNotFoundError(urlName);
  return parseProfilesRecord(record, urlName);
}

/** Surname agreement guards a guessed URL name from landing on a namesake. */
export function profileMatchesPerson(profile: UcsfProfile, lastName: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const want = norm(lastName);
  if (!want) return false;
  const got = norm(profile.lastName ?? profile.name.split(",")[0]?.split(/\s+/).pop() ?? "");
  return got === want || got.endsWith(want) || want.endsWith(got);
}
