/**
 * Pure parsers over one PubMed efetch `<PubmedArticle>` block (PR 0.2).
 *
 * Captures what the ingest used to discard after the author check: MeSH
 * headings, publication types, the abstract, and where the investigator sits
 * on the author list. No network, no Supabase — the ingest and the MeSH
 * backfill both call these on XML they already hold.
 */
import {
  authorEntryMatchesInvestigator,
  decodeXmlEntities,
  lastNameMatches,
  parsePubmedArticleAuthors,
  type PubmedParsedAuthor,
} from "@/lib/community/pubmed-author-match";
import { resolvePubmedInvestigatorName, type PubmedInvestigatorName } from "@/lib/community/pubmed-query";

export type PubmedMeshHeading = {
  ui: string;
  name: string;
  /** The descriptor, or any of its qualifiers, is starred as a major topic. */
  major: boolean;
  qualifiers: string[];
};

export const PUBMED_AUTHOR_POSITIONS = ["first", "last", "corresponding", "middle", "unknown"] as const;
export type PubmedAuthorPosition = (typeof PUBMED_AUTHOR_POSITIONS)[number];

/**
 * How the author entry behind `author_position` was identified — the same
 * principle as `identity_method`. `orcid`: the entry carries the investigator's
 * ORCID iD. `name`: matched by name (strict name + UCSF affiliation, else name
 * only); a common surname on a long author list can pick the wrong entry, so
 * the scorer can discount these. `absent`: nobody matched, position `unknown`.
 */
export const PUBMED_AUTHOR_POSITION_METHODS = ["orcid", "name", "absent"] as const;
export type PubmedAuthorPositionMethod = (typeof PUBMED_AUTHOR_POSITION_METHODS)[number];

/** What one efetch said about a PMID. The backfill escalates a repeated `not_returned` to terminal. */
export const PUBMED_MESH_FETCH_OUTCOMES = ["indexed", "no_mesh", "not_returned"] as const;
export type PubmedMeshFetchOutcome = (typeof PUBMED_MESH_FETCH_OUTCOMES)[number];

export type PubmedParsedRecord = {
  pmid: string | null;
  mesh: PubmedMeshHeading[];
  publicationTypes: string[];
  abstract: string | null;
};

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1]! : null;
}

/** Inline markup (<i>, <sub>, <sup>, <b>) is removed without inserting a space — "PLC<i>γ</i>2" is one token — then entities are decoded. */
function text(inner: string): string {
  return decodeXmlEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function parsePubmedPmid(xml: string): string | null {
  return xml.match(/<PMID[^>]*>(\d+)<\/PMID>/i)?.[1] ?? null;
}

/** `<MeshHeadingList>` → one entry per heading; `[]` for in-process records that carry none yet. */
export function parsePubmedMesh(xml: string): PubmedMeshHeading[] {
  const list = xml.match(/<MeshHeadingList>([\s\S]*?)<\/MeshHeadingList>/i)?.[1];
  if (!list) return [];
  const out: PubmedMeshHeading[] = [];
  const seen = new Set<string>();
  for (const m of list.matchAll(/<MeshHeading>([\s\S]*?)<\/MeshHeading>/gi)) {
    const heading = m[1] ?? "";
    const d = heading.match(/<DescriptorName\b([^>]*)>([\s\S]*?)<\/DescriptorName>/i);
    if (!d) continue;
    const ui = attr(d[1] ?? "", "UI") ?? "";
    const name = text(d[2] ?? "");
    if (!ui || !name || seen.has(ui)) continue;
    seen.add(ui);
    let major = (attr(d[1] ?? "", "MajorTopicYN") ?? "N").toUpperCase() === "Y";
    const qualifiers: string[] = [];
    for (const q of heading.matchAll(/<QualifierName\b([^>]*)>([\s\S]*?)<\/QualifierName>/gi)) {
      const qualifier = text(q[2] ?? "");
      if (!qualifier) continue;
      qualifiers.push(qualifier);
      if ((attr(q[1] ?? "", "MajorTopicYN") ?? "N").toUpperCase() === "Y") major = true;
    }
    out.push({ ui, name, major, qualifiers });
  }
  return out;
}

/** `<PublicationTypeList>` descriptor names in document order, deduplicated. */
export function parsePubmedPublicationTypes(xml: string): string[] {
  const list = xml.match(/<PublicationTypeList>([\s\S]*?)<\/PublicationTypeList>/i)?.[1];
  if (!list) return [];
  const out: string[] = [];
  for (const m of list.matchAll(/<PublicationType\b[^>]*>([\s\S]*?)<\/PublicationType>/gi)) {
    const name = text(m[1] ?? "");
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * `<Abstract>` sections as paragraphs; labeled sections become `LABEL: text`.
 * `<OtherAbstract>` (translations, plain-language summaries) and the
 * `<CopyrightInformation>` line are left out.
 */
export function parsePubmedAbstract(xml: string): string | null {
  const block = xml.match(/<Abstract(?:\s[^>]*)?>([\s\S]*?)<\/Abstract>/i)?.[1];
  if (!block) return null;
  const parts: string[] = [];
  for (const m of block.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi)) {
    const body = text(m[2] ?? "");
    if (!body) continue;
    const label = decodeXmlEntities(attr(m[1] ?? "", "Label") ?? "").trim();
    parts.push(label ? `${label}: ${body}` : body);
  }
  return parts.length ? parts.join("\n\n") : null;
}

export function parsePubmedRecord(xml: string): PubmedParsedRecord {
  return {
    pmid: parsePubmedPmid(xml),
    mesh: parsePubmedMesh(xml),
    publicationTypes: parsePubmedPublicationTypes(xml),
    abstract: parsePubmedAbstract(xml),
  };
}

// ---------------------------------------------------------------------------
// Author position
// ---------------------------------------------------------------------------

/** Who we are looking for on the author list. */
export type PubmedCaptureSubject = { name: PubmedInvestigatorName; orcid: string | null };

const ORCID_PATTERN = /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i;

/** `0000-0002-2414-9024`, with or without the https://orcid.org/ prefix; null when malformed. */
export function normalizeOrcid(value: string | null | undefined): string | null {
  const m = String(value ?? "").match(ORCID_PATTERN);
  return m ? m[0].toUpperCase() : null;
}

/** PubMed puts the corresponding author's e-mail on that author's affiliation ("Electronic address: …"). */
const CORRESPONDING_MARKER = /electronic address|[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i;

export function hasCorrespondingMarker(author: PubmedParsedAuthor): boolean {
  return author.affiliations.some((affiliation) => CORRESPONDING_MARKER.test(affiliation));
}

function firstInitial(value: string): string {
  return value.replace(/[^A-Za-z]/g, "")[0]?.toLowerCase() ?? "";
}

export type LocatedAuthor = { index: number; method: Exclude<PubmedAuthorPositionMethod, "absent"> };

/**
 * Where the investigator sits on the author list, and how we know. ORCID on
 * the entry wins outright. Otherwise the strict entry match (name + UCSF
 * affiliation, the ladder's standard) is tried, then a name-only match for
 * ORCID- and RePORTER-verified records that carry no affiliation clause.
 * Null when nobody matches or two authors are indistinguishable.
 */
export function locateInvestigatorAuthor(
  authors: PubmedParsedAuthor[],
  subject: PubmedCaptureSubject
): LocatedAuthor | null {
  const orcid = normalizeOrcid(subject.orcid);
  if (orcid) {
    const byOrcid = authors.findIndex((author) => normalizeOrcid(author.orcid) === orcid);
    if (byOrcid >= 0) return { index: byOrcid, method: "orcid" };
  }

  const resolved = resolvePubmedInvestigatorName(subject.name);
  if (!resolved.lastName) return null;

  const strict = authors.findIndex((author) => authorEntryMatchesInvestigator(author, resolved));
  if (strict >= 0) return { index: strict, method: "name" };

  const wantFirst = firstInitial(resolved.firstName);
  let candidates = authors
    .map((author, index) => ({ author, index }))
    .filter(({ author }) => lastNameMatches(author.lastName, resolved.lastName));
  if (wantFirst) {
    candidates = candidates.filter(({ author }) => {
      const got = firstInitial(author.foreName || author.initials);
      return !got || got === wantFirst;
    });
  }
  if (candidates.length === 1) return { index: candidates[0]!.index, method: "name" };

  const wantMiddle = resolved.middleInitial?.replace(/[^A-Za-z]/g, "")[0]?.toUpperCase();
  if (candidates.length > 1 && wantMiddle) {
    const narrowed = candidates.filter(
      ({ author }) => author.initials.replace(/[^A-Za-z]/g, "").toUpperCase()[1] === wantMiddle
    );
    if (narrowed.length === 1) return { index: narrowed[0]!.index, method: "name" };
  }
  return null;
}

/**
 * first / last / corresponding / middle for the author at `index`. Co-first
 * authors (EqualContrib="Y" on this entry and every entry before it) count as
 * first. A single-author paper is `first`.
 */
export function authorPositionAt(authors: PubmedParsedAuthor[], index: number): PubmedAuthorPosition {
  const author = authors[index];
  if (!author) return "unknown";
  if (index === 0) return "first";
  if (author.equalContrib && authors.slice(0, index).every((a) => a.equalContrib)) return "first";
  if (index === authors.length - 1) return "last";
  if (hasCorrespondingMarker(author)) return "corresponding";
  return "middle";
}

export type PubmedAuthorPositionResult = { position: PubmedAuthorPosition; method: PubmedAuthorPositionMethod };

export function parsePubmedAuthorPosition(xml: string, subject: PubmedCaptureSubject): PubmedAuthorPositionResult {
  const authors = parsePubmedArticleAuthors(xml);
  if (!authors.length) return { position: "unknown", method: "absent" };
  const located = locateInvestigatorAuthor(authors, subject);
  if (!located) return { position: "unknown", method: "absent" };
  return { position: authorPositionAt(authors, located.index), method: located.method };
}

// ---------------------------------------------------------------------------
// What the ingest and the backfill store
// ---------------------------------------------------------------------------

/** The PR 0.2 columns on investigator_publications, as written on upsert. */
export type PubmedCaptureFields = {
  mesh: PubmedMeshHeading[];
  publication_types: string[];
  abstract: string | null;
  author_position: PubmedAuthorPosition;
  author_position_method: PubmedAuthorPositionMethod;
  mesh_fetch_outcome: PubmedMeshFetchOutcome;
  mesh_fetched_at: string;
};

/**
 * Capture fields for one (investigator, PMID) row. `xml` null means efetch did
 * not return the record: everything stays empty, the outcome is
 * `not_returned`, and `mesh_fetched_at` is still stamped so a rerun does not
 * fetch it again. A record with no MeSH yet (in-process, `no_mesh`) keeps its
 * abstract and publication types; the backfill retries it after 30 days.
 */
export function captureFieldsFromXml(
  xml: string | null,
  subject: PubmedCaptureSubject | null,
  fetchedAt: string
): PubmedCaptureFields {
  if (!xml) {
    return {
      mesh: [],
      publication_types: [],
      abstract: null,
      author_position: "unknown",
      author_position_method: "absent",
      mesh_fetch_outcome: "not_returned",
      mesh_fetched_at: fetchedAt,
    };
  }
  const record = parsePubmedRecord(xml);
  const located: PubmedAuthorPositionResult = subject
    ? parsePubmedAuthorPosition(xml, subject)
    : { position: "unknown", method: "absent" };
  return {
    mesh: record.mesh,
    publication_types: record.publicationTypes,
    abstract: record.abstract,
    author_position: located.position,
    author_position_method: located.method,
    mesh_fetch_outcome: record.mesh.length ? "indexed" : "no_mesh",
    mesh_fetched_at: fetchedAt,
  };
}
