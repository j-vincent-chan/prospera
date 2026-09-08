/**
 * The NSF solicitation adapter (PR 5.4).
 *
 * 91 open NSF notices. NSF attaches nothing to Grants.gov — D69 counts them
 * (as "NSF's 90", before a duplicate row appeared) among the ~180 rows that
 * structurally have no announcement on that route — so this adapter is the only
 * way to NSF programme text there is.
 *
 * ## The route, and why it is not the one the plan first described
 *
 * `NON_NIH_PLAN.md` originally said to derive a PDF URL from
 * `opportunity_number` and to ignore `additional_info_url` because it "resolves
 * to the wrong document". `NON_NIH_INVENTORY.md` § 4 reverses that, and the
 * measurement is unambiguous:
 *
 *   - **The stored `additional_info_url` works.** 91/91 open NSF rows carry one,
 *     it is always a `pub_summ.jsp?ods_key=…` URL on an `*.nsf.gov` host, and
 *     following its redirects lands on
 *     `www.nsf.gov/funding/opportunities/{slug}/nsf{YY}-{NNN}/solicitation`.
 *     Re-measured in this PR: 90/90 distinct URLs returned HTTP 200, and every
 *     one of the 74 solicitation pages carries all six roles.
 *   - **The derived PDF does not.** § 4b probed
 *     `nsf-gov-resources.nsf.gov/solicitations/pubs/{YYYY}/nsf{YY}{NNN}/…pdf`
 *     for the same rows: 34/75 HTTP 200, 41 404s, *every* 2025–26 publication
 *     among the misses. It is kept below as a last-resort second target and
 *     nothing more.
 *
 * The original "wrong document" finding came from an `ods_key` that was
 * **constructed** from the opportunity number. This adapter never constructs
 * one: `storedNsfUrl` reads the URL off the row or returns null, and a row with
 * no stored URL is reported as unresolvable rather than guessed at. The `PD-`
 * numbers in § 4c are the evidence for that rule — their stored URLs use two
 * *different* shapes (`pub_summ.jsp?ods_key=<NNNNNN>` with no `nsf` prefix, and
 * the older `pgm_summ.jsp?pims_id=<N>`), so any construction rule would be
 * wrong for a sixth of the corpus.
 *
 * Because route 1 is HTML, **NSF needs no PDF extraction and is outside D66's
 * scope**. `pdfToLines` is still reachable from the fallback target, since a
 * fallback that could not read the file it fetches would be pointless.
 *
 * ## `PD-` rows are not failures
 *
 * 16 of the 91 are NSF **program descriptions** — a standing statement of what
 * a division funds, with no deadline, no review process and no solicitation
 * behind it. Their URLs land on a program page with no `I.–IX.` skeleton:
 * measured here on all 16, **zero** roman-numeral headings on any of them. So
 * they short-circuit to `not_applicable` (D69: "no acceptable candidate exists
 * on any route") with **no request at all** — there is nothing to fetch that
 * would help, and spending 16 requests to re-derive a known-empty answer every
 * run is the retry loop D69 exists to prevent. They fall through to the
 * synopsis at profile time, and the dry run counts them on their own line.
 *
 * ## Never a partial write
 *
 * Same rule as PR 5.3, for the same reason (D69): the `Acquisition` union has
 * no `sections` on its failure variants, and a document that sections but
 * yields no `objectives` block is **refused**, never stored. Storing it would
 * set `sources.text` to full text — so the profile would be scored as though
 * the announcement had been read — while `groupSections` produced an empty
 * group 1.
 */
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import {
  announcementTextHash,
  firstUsableTarget,
  funderFamilyOf,
  type Acquisition,
  type AnnouncementAdapter,
  type AnnouncementTarget,
  type FunderRow,
} from "@/lib/ingestion/announcement/registry";
import {
  NSF_HEADING_TABLES,
  hasObjectives,
  isTableOfContentsLine,
  sectionWithBestTable,
  type SectionedDocument,
} from "@/lib/ingestion/announcement/sectioner";
import { htmlToLines, isPdfBytes, pdfToLines, type TextLine } from "@/lib/ingestion/announcement/text";
import type { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

export const NSF_SOLICITATION_ADAPTER_ID = "nsf_solicitation";

/**
 * The size cap. NSF's solicitation pages measured 68–192 KB of HTML (median
 * 123 KB, § 4a); the fallback PDFs measured a median of 0.9 MB and the largest
 * seen is 3.4 MB. **8 MB** is therefore far above anything real and low enough
 * that a mis-typed target cannot pull an archive into a 300 s function.
 */
export const MAX_NSF_BYTES = 8 * 1024 * 1024;

const USER_AGENT = "Prospera/1.0 (UCSF research-development tool; contact research.dev@ucsf.edu)";
const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Row shape and dependencies
// ---------------------------------------------------------------------------

/** The columns the adapter reads. */
export type NsfRow = FunderRow & {
  id: string;
  opportunity_number: string | null;
  forecasted?: boolean | null;
  guide_url?: string | null;
  raw_payload_json: Record<string, unknown> | null;
};

/**
 * One fetched document. Unlike the Grants.gov adapter's `FetchedDocument` this
 * keeps `finalUrl` and the decoded `text`, both of which NSF needs: the final
 * URL is where the program-page slug comes from (it is a path segment of the
 * redirect target), and the raw HTML is where the program element codes live —
 * they are in an `href`, which `htmlToLines` correctly discards.
 */
export type NsfDocument =
  | { status: "ok"; url: string; finalUrl: string; bytes: Uint8Array; contentType: string | null }
  | { status: "not_found"; url: string }
  | { status: "error"; url: string; error: string };

export type NsfDeps = {
  /** One limiter per host, from the driver. Every request goes through it (≥ 700 ms). */
  limiterFor(host: string): AsyncRateLimiter;
  /** Injected in tests; defaults to a real GET with the size cap applied. */
  fetchDocument?: (url: string, maxBytes: number) => Promise<NsfDocument>;
  maxBytes?: number;
  /**
   * Follow the solicitation's program page for the award-search element codes
   * (default true). One extra GET on the same host, and only when the
   * solicitation itself printed no codes — which, measured, is 72 of 74 rows.
   */
  programPage?: boolean;
  /** `--force`: ignored here (there is no stored per-document hash to skip on); kept for driver symmetry. */
  force?: boolean;
};

// ---------------------------------------------------------------------------
// Reading the row
// ---------------------------------------------------------------------------

/**
 * What kind of NSF publication the number names.
 *
 * `NN-NNN` is a program solicitation and has a document behind it. `PD-YY-EEEE`
 * is a program description and does not (§ 4c). Anything else is `unknown` and
 * is *tried* rather than refused — it is a shape we have not seen, not a shape
 * we know to be empty.
 */
export type NsfNumberKind = "solicitation" | "program_description" | "unknown";

export function nsfNumberKind(number: string | null | undefined): NsfNumberKind {
  const n = (number ?? "").trim();
  if (/^\d{2}-\d{3}$/.test(n)) return "solicitation";
  if (/^PD-\d{2}-[0-9A-Z]{4}$/i.test(n)) return "program_description";
  return "unknown";
}

/**
 * `http(s)://…nsf.gov` — the only thing this adapter will fetch.
 *
 * Applied in **three** places, because there are three ways a URL enters the
 * adapter and only one of them is the stored value:
 *
 *  1. `storedNsfUrl`, on the value read off the row;
 *  2. the **final** URL of every document read, because `redirect: "follow"`
 *     means the bytes that get sectioned and stored need not come from the host
 *     that was asked. An off-host redirect would put a third party's text in
 *     `guide_sections`, and `sources.text` would then say the announcement had
 *     been read — the same hazard D69's "refused rather than stored" rule
 *     exists to prevent, arriving by a different door;
 *  3. `programPageUrlFor`, which is *derived from* that final URL, so without
 *     the check one off-host redirect also buys the redirect target a second
 *     GET at an origin of its choosing.
 *
 * The scheme test is not decoration: `new URL("file://nsf.gov/etc/passwd")`
 * has hostname `nsf.gov`, so a host test alone admits it.
 */
export function isNsfUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return host === "nsf.gov" || host.endsWith(".nsf.gov");
}

/**
 * The row's own `additional_info_url`, when it is on an `*.nsf.gov` host.
 *
 * Read, never built. The URLs are stored as `http://` and NSF redirects them to
 * `https://`; `redirect: "follow"` handles that, and the host test is applied
 * to the stored value so a rewritten `additional_info_url` pointing somewhere
 * else can never be fetched as if it were NSF's. Where the redirects *land* is
 * checked separately, in `acquireNsfSolicitation` — see `isNsfUrl`.
 */
export function storedNsfUrl(row: Pick<NsfRow, "raw_payload_json">): string | null {
  const summary = (row.raw_payload_json as { summary?: unknown } | null)?.summary;
  if (!summary || typeof summary !== "object") return null;
  const v = (summary as { additional_info_url?: unknown }).additional_info_url;
  if (typeof v !== "string" || !v.trim()) return null;
  const url = v.trim();
  return isNsfUrl(url) ? url : null;
}

/**
 * The derived PDF, **fallback only** (§ 4b: 34/75 200s, and none of them a
 * 2025–26 publication).
 *
 * This is not the construction the adapter refuses to do. `storedNsfUrl` is
 * about an `ods_key`, an opaque publication key that cannot be inferred from
 * anything on the row; this URL is built from the row's own
 * `opportunity_number` and the path shape § 4b probed, and a 404 — which is how
 * it fails half the time — is unambiguous. It is second in the target list, so
 * it is only ever reached when the stored URL produced no `objectives`.
 */
export function derivedNsfPdfUrl(number: string | null | undefined): string | null {
  const m = /^(\d{2})-(\d{3})$/.exec((number ?? "").trim());
  if (!m) return null;
  const yy = m[1]!;
  const nnn = m[2]!;
  const year = Number(yy) >= 90 ? `19${yy}` : `20${yy}`;
  return `https://nsf-gov-resources.nsf.gov/solicitations/pubs/${year}/nsf${yy}${nnn}/nsf${yy}${nnn}.pdf`;
}

/**
 * The program page a solicitation belongs to, derived from the **final** URL
 * after redirects — `/funding/opportunities/{slug}/…/nsf{YY}-{NNN}/solicitation`
 * has the slug as its third path segment.
 *
 * Taken from the URL rather than by scraping the page's own "View the program
 * page" link, because that link is missing from 4 of the 74 pages (they carry
 * an extra numeric segment in the path instead) while the path segment is
 * present on all 74.
 */
export function programPageUrlFor(finalUrl: string): string | null {
  // The input is the URL the redirects landed on, not one this module chose, so
  // it is checked before anything is built from it (`isNsfUrl`).
  if (!isNsfUrl(finalUrl)) return null;
  let u: URL;
  try {
    u = new URL(finalUrl);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  // ["funding", "opportunities", slug, …] — and at least one segment after the
  // slug, or this *is* the program page and there is nothing to follow.
  if (parts.length < 4 || parts[0] !== "funding" || parts[1] !== "opportunities") return null;
  return `${u.origin}/funding/opportunities/${parts[2]}`;
}

// ---------------------------------------------------------------------------
// Reissue lineage and programme codes
// ---------------------------------------------------------------------------

/**
 * A publication number wherever it is written: `NSF 20-595`, `PD 98-1391`, or
 * bare `20-595`. Both prefixes matter — a solicitation frequently replaces a
 * set of **program descriptions** rather than another solicitation (`26-518`
 * replaces fourteen `PD 23-…` numbers), and those are exactly the rows § 4c
 * takes out of this adapter's hit-rate, so their lineage is the only thing that
 * connects them to a document at all.
 */
const PUBLICATION_NUMBER = /\b(NSF|PD)\s*-?\s*(\d{2}-[0-9A-Z]{3,4})\b|\b(\d{2}-\d{3})\b/gi;
/**
 * `Replaces: NSF 20-595` — the modern page's inline field. **The colon is
 * required**: without it `Replaces the previous edition of the guide, effective
 * 24-529 days after publication` reads as the field and yields a lineage that
 * does not exist.
 */
const REPLACES_INLINE = /^replaces(?:\s+documents?\(?s?\)?)?\s*:\s*(.*)$/i;
/** `REPLACES DOCUMENT(S)` alone on a line — the PDF's block form, numbers below. */
const REPLACES_BLOCK = /^replaces\s+documents?\(?s?\)?\s*:?\s*$/i;
/** A continuation line for the PDF form: nothing but publication numbers. */
const ONLY_NUMBERS = /^(?:(?:and|,|;|\s)*(?:NSF|PD)?\s*-?\s*\d{2}-[0-9A-Z]{3,4})+\s*$/i;

/**
 * The publication(s) this one replaces — PR 5.7's reissue lineage, the NSF
 * analogue of the NIH Guide's reissue chain.
 *
 * Two forms, both handled: the redesigned page prints `Replaces: NSF 20-595` on
 * one line (64 of the 74 open solicitations carry it; the other 10 are first
 * issues), and the PDF prints `REPLACES DOCUMENT(S):` with the numbers on the
 * following line. The label line is capped at 200 characters so a sentence
 * beginning "Replaces" cannot be read as the field.
 */
export function extractReplacedDocuments(lines: readonly TextLine[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.length > 200) continue;
    const block = REPLACES_BLOCK.test(line);
    const inline = block ? null : REPLACES_INLINE.exec(line);
    if (!block && !inline) continue;
    const tail = (inline?.[1] ?? "").trim();
    out.push(...publicationNumbers(tail));
    // The PDF form puts the numbers on the next line(s); only a line that is
    // *nothing but* publication numbers is accepted, so the paragraph after a
    // bare "REPLACES DOCUMENT(S):" cannot be swallowed.
    if (!tail) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j += 1) {
        const next = (lines[j] ?? "").trim();
        if (!ONLY_NUMBERS.test(next)) break;
        out.push(...publicationNumbers(next));
      }
    }
  }
  return [...new Set(out)];
}

function publicationNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PUBLICATION_NUMBER)) {
    const prefix = (m[1] ?? "").toUpperCase();
    const number = (m[2] ?? m[3] ?? "").toUpperCase();
    if (!number) continue;
    // Normalised to the form `opportunity_number` uses, so PR 5.7 can join on
    // it without a second vocabulary: `24-589` for a solicitation, `PD-98-1391`
    // for a program description. `NSF` is a publisher, not part of the number.
    out.push(prefix === "PD" ? `PD-${number}` : number);
  }
  return out;
}

/**
 * NSF program element and reference codes — what PR 5.7 joins award records on
 * (`api.nsf.gov/services/v1/awards.json`, `ProgEleCode` / `ProgRefCode`).
 *
 * **The plan's premise, that these are "printed in the body", is false for
 * NSF's redesigned site.** Measured over all 74 open solicitation pages: one
 * prints `Program Element Code(s):`, two print an `Element code NNNNNN` in
 * prose, and none prints a reference-code block. The old `pub_summ.jsp` HTML
 * and the solicitation PDFs carried them; `www.nsf.gov/funding/opportunities/…`
 * does not.
 *
 * Where they *are* published is the program page's "Awards made through this
 * program" link — `…/awardsearch/search-results?ProgEleCode=199700%2C260Y00&…`
 * — which is why `acquireNsfSolicitation` follows the program page when the
 * document itself yielded nothing. Both routes go through this one function, so
 * the PDF fallback's printed block is read the same way.
 *
 * Codes are kept **verbatim**. NSF writes the same element in a four-character
 * form (`7727`) and a six-character padded form (`772700`), and both appear in
 * live award-search links (`ProgEleCode=079Y%2C080Y%2C7727` on `24-506`,
 * `ProgEleCode=069Y00` on `23-619`). Normalising here would be guessing which
 * form the awards API wants; `nsfElementCodeStem` is offered for PR 5.7 to
 * decide with.
 */
export type NsfCodes = { elements: string[]; references: string[] };

/** Four or six characters, digit-led, letters allowed inside (`079Y`, `069Y00`, `772300`). */
const CODE = String.raw`\d[0-9A-Z]{3}(?:[0-9A-Z]{2})?`;
const CODE_TOKEN = new RegExp(`^${CODE}$`, "i");
/** One code, or a comma / "and" separated run of them — and nothing after it. */
const CODE_RUN = String.raw`(${CODE}(?:\s*(?:,|;|and)\s*${CODE})*)`;

const ELE_HREF = /ProgEleCode=([0-9A-Za-z%,]+)/gi;
const REF_HREF = /ProgRefCode=([0-9A-Za-z%,]+)/gi;
/**
 * `Program Element Code(s): 7222, 8091` — the classic printed block — and NSF's
 * looser prose forms, `Chemical Catalysis (CAT), Element code 688400.` and
 * `…the program element code of 7412 in the awards search function`. All three
 * are the same shape: the words `Element Code`, an optional connector, then a
 * run of codes.
 *
 * The capture stops at the first token that is not code-shaped, which is what
 * keeps a year or a dollar figure later in the sentence out of the result — an
 * earlier `(.+)$` capture read the rest of the line and would have.
 */
const ELE_LABEL = new RegExp(String.raw`\bElement\s+Code(?:\(s\)|s)?\s*(?:of|is|are|:|=)?\s*${CODE_RUN}`, "gi");
const REF_LABEL = new RegExp(String.raw`\bReference\s+Code(?:\(s\)|s)?\s*(?:of|is|are|:|=)?\s*${CODE_RUN}`, "gi");

export function extractNsfCodes(input: { html?: string | null; lines?: readonly TextLine[] }): NsfCodes {
  const elements: string[] = [];
  const references: string[] = [];
  const html = input.html ?? "";

  for (const m of html.matchAll(ELE_HREF)) elements.push(...codeTokens(m[1]!));
  for (const m of html.matchAll(REF_HREF)) references.push(...codeTokens(m[1]!));

  for (const line of input.lines ?? []) {
    for (const m of line.matchAll(ELE_LABEL)) elements.push(...codeTokens(m[1]!));
    for (const m of line.matchAll(REF_LABEL)) references.push(...codeTokens(m[1]!));
  }

  return { elements: [...new Set(elements)].sort(), references: [...new Set(references)].sort() };
}

function codeTokens(raw: string): string[] {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A stray `%` in the value: fall through and split what we have.
  }
  return decoded
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/[.)\]]+$/, ""))
    .filter((s) => CODE_TOKEN.test(s));
}

/**
 * The four-character stem of an element code (`772300` → `7723`), for a caller
 * that needs the two forms to compare. Not applied to what this adapter
 * reports — see `extractNsfCodes`.
 */
export function nsfElementCodeStem(code: string): string {
  return /^\d[0-9A-Z]{3}00$/i.test(code) ? code.slice(0, 4) : code;
}

/**
 * A `PD-YY-EEEE` number *is* the program element code, padded to six characters
 * — `PD-18-1263` is element `126300`, `PD-18-7970` is `797000`. Verified
 * against the award-search links on the program pages themselves: 13 of the 16
 * open `PD-` rows carry one and all 13 agree exactly. The other three
 * (`PD-24-110Z`, `PD-25-275Y`, `PD-26-366Y`) publish no award-search link, so
 * the derivation is reported for them without a check.
 *
 * This is the one place the adapter derives anything from an opportunity
 * number, and it is a *format*, not a lookup: the digits are already the code.
 */
export function programElementFromPdNumber(number: string | null | undefined): string[] {
  const m = /^PD-\d{2}-([0-9A-Z]{4})$/i.exec((number ?? "").trim());
  return m ? [`${m[1]!.toUpperCase()}00`] : [];
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A plain GET with the size cap enforced on `content-length` and again on the body. */
export async function fetchNsfDocument(url: string, maxBytes: number): Promise<NsfDocument> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 410) return { status: "not_found", url };
    if (!res.ok) return { status: "error", url, error: `HTTP ${res.status}` };
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { status: "error", url, error: `content-length ${declared} over the ${maxBytes}-byte cap` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { status: "error", url, error: `body ${buf.byteLength} over the ${maxBytes}-byte cap` };
    return { status: "ok", url, finalUrl: res.url || url, bytes: buf, contentType: res.headers.get("content-type") };
  } catch (e) {
    return { status: "error", url, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i;

/**
 * Bytes → lines, plus the HTML when it *is* HTML. PDF is decided by the `%PDF-`
 * signature and never by the declared type, exactly as PR 5.3 does — NSF serves
 * the fallback as `application/pdf`, but a redirect to an error page would not.
 */
export async function nsfDocumentToLines(doc: Extract<NsfDocument, { status: "ok" }>): Promise<{ lines: TextLine[]; html: string | null }> {
  if (isPdfBytes(doc.bytes)) return { lines: await pdfToLines(doc.bytes), html: null };
  const type = (doc.contentType ?? "").trim();
  if (HTML_TYPE.test(type) || !type) {
    const html = new TextDecoder("utf-8", { fatal: false }).decode(doc.bytes);
    return { lines: htmlToLines(html), html };
  }
  throw new Error(`unreadable content-type ${type}`);
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** What the dry run prints beyond the shared `Acquisition` fields. */
export type NsfExtra = {
  kind: NsfNumberKind;
  /** The URL the row stores, or null — the one thing that decides whether a row is resolvable at all. */
  storedUrl: string | null;
  /** Where the redirects landed; `/solicitation` for a real solicitation page. */
  finalUrl: string | null;
  targets: number;
  route: "stored_url" | "derived_pdf" | null;
  table: string | null;
  roles: string[];
  /** The longest `objectives` block, for the dry run's eyes-on preview. */
  objectives: string | null;
  objectiveSections: number;
  thin: boolean;
  /** `REPLACES DOCUMENT(S)` / `Replaces:` — PR 5.7's reissue lineage. */
  replaces: string[];
  programElementCodes: string[];
  programReferenceCodes: string[];
  /** Which route the codes came from, so the report can separate them honestly. */
  codeSource: "document" | "number" | "program_page" | null;
  programPageUrl: string | null;
};

function emptyExtra(kind: NsfNumberKind, storedUrl: string | null, over: Partial<NsfExtra> = {}): NsfExtra {
  return {
    kind,
    storedUrl,
    finalUrl: null,
    targets: 0,
    route: null,
    table: null,
    roles: [],
    objectives: null,
    objectiveSections: 0,
    thin: true,
    replaces: [],
    programElementCodes: [],
    programReferenceCodes: [],
    codeSource: null,
    programPageUrl: null,
    ...over,
  };
}

export function appliesToNsfSolicitation(row: NsfRow): boolean {
  if (funderFamilyOf(row) !== "nsf") return false;
  // Forecasts have no published solicitation yet, so there is nothing to read.
  return row.forecasted !== true;
}

export async function acquireNsfSolicitation(row: NsfRow, deps: NsfDeps): Promise<Acquisition> {
  const maxBytes = deps.maxBytes ?? MAX_NSF_BYTES;
  const read = deps.fetchDocument ?? fetchNsfDocument;
  const kind = nsfNumberKind(row.opportunity_number);
  const storedUrl = storedNsfUrl(row);

  // `PD-` rows: a program description, not a solicitation. No request.
  if (kind === "program_description") {
    const elements = programElementFromPdNumber(row.opportunity_number);
    return {
      status: "not_applicable",
      url: storedUrl,
      source: null,
      error: "NSF program description, not a solicitation: the page carries no I.–IX. skeleton and no solicitation exists (NON_NIH_INVENTORY § 4c). Falls through to the synopsis.",
      pageFetches: 0,
      simplerCalls: 0,
      extra: emptyExtra(kind, storedUrl, {
        programElementCodes: elements,
        codeSource: elements.length ? "number" : null,
      }) satisfies NsfExtra,
    };
  }

  const targets: AnnouncementTarget[] = [];
  if (storedUrl) targets.push({ url: storedUrl, source: "nsf_solicitation", note: "stored additional_info_url" });
  const pdf = derivedNsfPdfUrl(row.opportunity_number);
  if (pdf) targets.push({ url: pdf, source: "nsf_solicitation", note: "derived nsf-gov-resources PDF (fallback)" });

  if (targets.length === 0) {
    // No stored URL and no derivable fallback. Reported, never guessed at: an
    // `ods_key` is opaque and constructing one is what produced the original
    // wrong-document finding.
    return {
      status: "not_applicable",
      url: null,
      source: null,
      error: "no stored *.nsf.gov additional_info_url and no derivable publication number; an ods_key is never constructed",
      pageFetches: 0,
      simplerCalls: 0,
      extra: emptyExtra(kind, storedUrl) satisfies NsfExtra,
    };
  }

  let pageFetches = 0;
  let error: string | null = null;
  let every404 = true;
  let readSomething = false;
  // One object rather than three `let`s: these are written inside the
  // `firstUsableTarget` callback, and TypeScript keeps a `let`'s
  // initializer-narrowing across a closure assignment while it resets a
  // property's at every call boundary. The object is the honest shape anyway —
  // it is what the winning document left behind.
  const readState: { finalUrl: string | null; html: string | null; lines: readonly TextLine[] } = { finalUrl: null, html: null, lines: [] };

  const hit = await firstUsableTarget<SectionedDocument>(
    targets,
    async (target) => {
      pageFetches += 1;
      const doc = await deps.limiterFor(hostOf(target.url)).schedule(() => read(target.url, maxBytes));
      if (doc.status !== "ok") {
        if (doc.status === "error") {
          every404 = false;
          error = doc.error;
        } else {
          error = `HTTP 404 ${target.url}`;
        }
        return null;
      }
      // Where the redirects landed, not where we asked. An off-host landing is
      // refused before the bytes are read: this document would otherwise be
      // sectioned and stored as the notice's announcement text.
      if (!isNsfUrl(doc.finalUrl)) {
        every404 = false;
        error = `redirected off nsf.gov to ${doc.finalUrl}`;
        return null;
      }
      readSomething = true;
      try {
        const { lines, html } = await nsfDocumentToLines(doc);
        readState.finalUrl = doc.finalUrl;
        readState.html = html;
        readState.lines = lines;
        // `ignoreHeading` matters only on the PDF fallback, whose contents page
        // carries leader dots and page numbers; on the HTML page it never fires.
        // `dedupe: "longest"` is what discards the short `nsf.summary` that the
        // Table of Contents re-opens.
        return sectionWithBestTable(lines, NSF_HEADING_TABLES, {
          ignoreHeading: isTableOfContentsLine,
          dedupe: "longest",
        });
      } catch (e) {
        every404 = false;
        error = e instanceof Error ? e.message : String(e);
        return null;
      }
    },
    (sectioned) => hasObjectives(sectioned.sections),
  );

  const routeOf = (url: string): "stored_url" | "derived_pdf" => (url === storedUrl ? "stored_url" : "derived_pdf");

  // D69, the more serious half: `firstUsableTarget` falls back to the first
  // *readable* document, and a document with no `objectives` block is refused
  // rather than stored. See the module comment.
  if (!hit || !hasObjectives(hit.doc.sections)) {
    return {
      status: !hit && every404 && !readSomething ? "not_found" : "error",
      url: hit?.target.url ?? targets[0]!.url,
      source: null,
      error: error ?? (hit ? "no II. Program Description block in the document" : "no section could be recovered from any target"),
      pageFetches,
      simplerCalls: 0,
      extra: emptyExtra(kind, storedUrl, {
        finalUrl: readState.finalUrl,
        targets: targets.length,
        route: hit ? routeOf(hit.target.url) : null,
        replaces: extractReplacedDocuments(readState.lines),
      }) satisfies NsfExtra,
    };
  }

  const sections: NoticeSection[] = hit.doc.sections;
  const objectiveSections = sections.filter((s) => (s.roles ?? []).includes("objectives"));
  const objectives = objectiveSections.reduce<string | null>((best, s) => (best == null || s.text.length > best.length ? s.text : best), null);

  // Codes from the document itself first; the program page only when it printed
  // none, which — measured — is 72 of 74 rows.
  let codes = extractNsfCodes({ html: readState.html, lines: readState.lines });
  let codeSource: NsfExtra["codeSource"] = codes.elements.length || codes.references.length ? "document" : null;
  const programPageUrl = readState.finalUrl ? programPageUrlFor(readState.finalUrl) : null;
  if (!codeSource && programPageUrl && deps.programPage !== false) {
    pageFetches += 1;
    const page = await deps.limiterFor(hostOf(programPageUrl)).schedule(() => read(programPageUrl, maxBytes));
    if (page.status === "ok" && isNsfUrl(page.finalUrl)) {
      try {
        const { lines, html } = await nsfDocumentToLines(page);
        const found = extractNsfCodes({ html, lines });
        if (found.elements.length || found.references.length) {
          codes = found;
          codeSource = "program_page";
        }
      } catch {
        // The program page is a bonus, never a reason to fail the notice.
      }
    }
  }

  return {
    status: "ok",
    url: readState.finalUrl ?? hit.target.url,
    source: hit.target.source,
    sections,
    textHash: announcementTextHash(sections),
    pageFetches,
    simplerCalls: 0,
    extra: {
      kind,
      storedUrl,
      finalUrl: readState.finalUrl,
      targets: targets.length,
      route: routeOf(hit.target.url),
      table: hit.doc.table,
      roles: hit.doc.roles,
      objectives,
      objectiveSections: objectiveSections.length,
      thin: objectives == null,
      replaces: extractReplacedDocuments(readState.lines),
      programElementCodes: codes.elements,
      programReferenceCodes: codes.references,
      codeSource,
      programPageUrl,
    } satisfies NsfExtra,
  };
}

export const nsfSolicitationAdapter: AnnouncementAdapter<NsfRow, NsfDeps> = {
  id: NSF_SOLICITATION_ADAPTER_ID,
  family: "nsf",
  applies: appliesToNsfSolicitation,
  acquire: acquireNsfSolicitation,
};
