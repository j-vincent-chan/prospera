/**
 * The CDMRP / DHA Program Announcement adapter (PR 5.5).
 *
 * 81 open DOD-AMRAA notices. PR 5.3 already reaches most of them through the
 * Simpler mirror (`…_GG*.pdf` attached to the Grants.gov record, 74 of the 79
 * modern rows carry one). This adapter puts the **direct** route first:
 *
 *   https://cdmrp.health.mil/funding/pa/{FON}_GG.pdf
 *
 * — derivable from the opportunity number alone, so it does not depend on the
 * mirror staying published, on a Simpler API key, or on Grants.gov's attachment
 * folder metadata. `NON_NIH_INVENTORY.md` § 5c measured it at 68/79 (86.1 %),
 * all `application/pdf`, median 745 KB. The mirror stays as the fallback, so a
 * notice is only lost when *both* routes fail.
 *
 * ## The FON decomposition is the point of this PR
 *
 * A CDMRP funding opportunity number is `{office}{FY}{program}{mechanism}` —
 * `HT9425` `26` `PRMRP` `CTA`. The mechanism suffix is the CDMRP analogue of an
 * NIH activity code (`CTA` Clinical Trial Award, `IIRA` Investigator-Initiated
 * Research Award, `IDA` Idea Development Award, `CDA` Career Development
 * Award, …) and PR 5.8 attaches scoring priors to it, so cutting it correctly
 * matters more than the text does.
 *
 * **A suffix regex cannot cut it.** `NON_NIH_INVENTORY.md` § 5a tried and left
 * 26 of 81 unmatched while mis-cutting others, because CDMRP program
 * abbreviations vary from three to seven characters and several mechanisms
 * start with the letter a program ends with:
 *
 *   - `ALSRPPCTA` is `ALSRP` + `PCTA` (Pilot Clinical Trial Award), but
 *     `OCRPCTA` is `OCRP` + `CTA` — a `PCTA` suffix rule binds the program's
 *     trailing `P` into the mechanism on the second and is right on the first.
 *   - `AZRPTRCA` is `AZRP` + `TRCA` (Transforming Care Award), not `AZRPTR` +
 *     `CA`.
 *   - `MRPFPARM` is `MRP` + `FPARM` (Focused Program Award – Rare Melanomas),
 *     not `MRPFP` + `ARM`.
 *
 * So the **program** set is seeded from CDMRP's own published program list and
 * the mechanism is whatever remains after the longest matching program prefix.
 * See `CDMRP_PROGRAMS` for the provenance of that list.
 *
 * ## What this adapter does not do
 *
 * No exemplar path. CDMRP has no working funded-award abstract source today —
 * their award search page is a stub and the DTIC replacement is offline — so
 * these notice profiles are text-only, and PR 5.7 must not be pointed here.
 *
 * No `singleSection` fallback, following PR 5.3 and D69: a PA that reads but
 * does not section, or sections without a `Program Description` block, is
 * refused rather than stored. Storing it would set `sources.text` to full text
 * — so the profile scores as though the announcement had been read — while
 * `groupSections` produced empty groups.
 */
import {
  MAX_ATTACHMENT_BYTES,
  acquireGrantsGovAttachment,
  documentToLines,
  fetchDocumentWithCap,
  type FetchedDocument,
  type GrantsGovDeps,
  type GrantsGovExtra,
  type GrantsGovRow,
} from "@/lib/ingestion/announcement/adapters/grants-gov-attachment";
import {
  announcementTextHash,
  funderFamilyOf,
  type Acquisition,
  type AnnouncementAdapter,
} from "@/lib/ingestion/announcement/registry";
import {
  CDMRP_PA_HEADINGS,
  FEDERAL_NOFO_HEADINGS,
  SIMPLIFIED_NOFO_HEADINGS,
  hasObjectives,
  isTableOfContentsLine,
  sectionWithBestTable,
  type SectionedDocument,
} from "@/lib/ingestion/announcement/sectioner";
import type { TextLine } from "@/lib/ingestion/announcement/text";
import type { HeadingPattern } from "@/lib/ingestion/announcement/sectioner";

export const CDMRP_PA_ADAPTER_ID = "cdmrp_pa";

/** The one host this adapter talks to. A `.mil` host: one GET per notice, never a fan-out. */
export const CDMRP_HOST = "cdmrp.health.mil";

/**
 * The floor this adapter asks the driver to space `cdmrp.health.mil` requests
 * by. The framework's per-host minimum is 700 ms; CDMRP gets 1 000 ms because
 * it is a Defense Health Agency host serving 745 KB PDFs, we have no published
 * rate policy from them, and the whole corpus is 81 rows — the extra 300 ms
 * costs 24 seconds over a full pass and buys a wide margin.
 */
export const CDMRP_MIN_INTERVAL_MS = 1_000;

/** `https://cdmrp.health.mil/funding/pa/{FON}_GG.pdf` — the derivable primary route. */
export function cdmrpProgramAnnouncementUrl(fon: string): string {
  return `https://${CDMRP_HOST}/funding/pa/${encodeURIComponent(fon)}_GG.pdf`;
}

// ---------------------------------------------------------------------------
// 1 · The seeded program list
// ---------------------------------------------------------------------------

/**
 * CDMRP's research programs, as CDMRP publishes them.
 *
 * **Provenance.** Read from `https://cdmrp.health.mil/` and
 * `https://cdmrp.health.mil/funding/prgdefault` on 2026-09-07, from two places
 * on those pages that agree with each other:
 *
 *   1. the program index links, `/{slug}/default`, which give 41 abbreviations;
 *   2. the "…Research Program (ABBR)" parentheticals printed in the FY26
 *      funding-opportunity list.
 *
 * The two lists differ in exactly one place, and it is the one that matters:
 * the Orthopaedic Research Program's page is still at the legacy `/prorp/`
 * slug — it was the *Peer Reviewed* Orthopaedic Research Program — while the
 * funding page and the FY26 FONs both call it **ORP** (`HT942526ORPARA`,
 * "DoW Orthopaedic, Applied Research Award"). Seeding from the slugs alone
 * would have left both Orthopaedic rows unmatched, which is precisely the
 * failure mode § 5a warns about. Both spellings are kept: `ORP` for the FONs,
 * `PRORP` for anything older.
 *
 * Every entry is `[abbreviation, program name]`. The list is deliberately wider
 * than the 21 programs that appear in the 81 open rows — a program with no open
 * notice this month has one next month, and an abbreviation costs nothing.
 * Matching is longest-prefix, so declaration order does not matter.
 */
export const CDMRP_PROGRAMS: ReadonlyArray<readonly [string, string]> = [
  ["ALSRP", "Amyotrophic Lateral Sclerosis Research Program"],
  ["ARP", "Autism Research Program"],
  ["ASUDRP", "Alcohol and Substance Use Disorders Research Program"],
  ["ATRP", "Arthritis Research Program"],
  ["AZRP", "Alzheimer's Research Program"],
  ["BCRP", "Breast Cancer Research Program"],
  ["BMFRP", "Bone Marrow Failure Research Program"],
  ["CPMRP", "Chronic Pain Management Research Program"],
  ["CRRP", "Combat Readiness – Medical Research Program"],
  ["DMDRP", "Duchenne Muscular Dystrophy Research Program"],
  ["DMRDP", "Defense Medical Research and Development Program"],
  ["ERP", "Epilepsy Research Program"],
  ["GBMRP", "Glioblastoma Research Program"],
  ["GWIRP", "Gulf War Illness Research Program"],
  ["HRRP", "Hearing Restoration Research Program"],
  ["JWMRP", "Joint Warfighter Medical Research Program"],
  ["KCRP", "Kidney Cancer Research Program"],
  ["LCRP", "Lung Cancer Research Program"],
  ["LRP", "Lupus Research Program"],
  ["MBRP", "Military Burn Research Program"],
  ["MRP", "Melanoma Research Program"],
  ["MSRP", "Multiple Sclerosis Research Program"],
  ["NETP", "Neurotoxin Exposure Treatment Parkinson's Research Program"],
  ["NFRP", "Neurofibromatosis Research Program"],
  ["OCRP", "Ovarian Cancer Research Program"],
  ["OPORP", "Orthotics and Prosthetics Outcomes Research Program"],
  ["ORP", "Orthopaedic Research Program"],
  ["PCARP", "Pancreatic Cancer Research Program"],
  ["PCRP", "Prostate Cancer Research Program"],
  ["PRCRP", "Peer Reviewed Cancer Research Program"],
  ["PRMRP", "Peer Reviewed Medical Research Program"],
  ["PRORP", "Peer Reviewed Orthopaedic Research Program"],
  ["PRP", "Parkinson's Research Program"],
  ["RCRP", "Rare Cancers Research Program"],
  ["RTRP", "Reconstructive Transplant Research Program"],
  ["SCIRP", "Spinal Cord Injury Research Program"],
  ["SRP", "Scleroderma Research Program"],
  ["TBDRP", "Tick-Borne Disease Research Program"],
  ["TBIPHRP", "Traumatic Brain Injury and Psychological Health Research Program"],
  ["TERP", "Toxic Exposures Research Program"],
  ["TSCRP", "Tuberous Sclerosis Complex Research Program"],
  ["VRP", "Vision Research Program"],
];

/** Longest first: `PCARP` must be tested before `PCRP` would ever be, and `PRMRP` before `PRP`. */
const PROGRAMS_BY_LENGTH: ReadonlyArray<readonly [string, string]> = [...CDMRP_PROGRAMS].sort(
  (a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]),
);

export const CDMRP_PROGRAM_NAMES: Readonly<Record<string, string>> = Object.fromEntries(CDMRP_PROGRAMS);

// ---------------------------------------------------------------------------
// 2 · Decomposing a funding opportunity number
// ---------------------------------------------------------------------------

/**
 * What shape of announcement the number names.
 *
 * `program_announcement` is the FY23+ `HT9425YY<PROGRAM><MECHANISM>` form — the
 * 78 of 81 open rows this PR is about. `broad_agency_announcement` is the
 * standing DHA BAA (`HT942523SBAA1`), which has no program and no mechanism and
 * publishes no `_GG.pdf`. `other` is everything the program list cannot cut:
 * today the two pre-FY23 numbers, `HT9425-23-S-SOC1` and `W81XWH-22-DHAPP`.
 */
export type CdmrpFonKind = "program_announcement" | "broad_agency_announcement" | "other";

export type CdmrpFon = {
  /** The opportunity number, uppercased and trimmed; otherwise verbatim. */
  fon: string;
  /** Contracting office: `HT9425` (DHA, FY23+) or the pre-2023 `W81XWH` (USAMRAA). */
  office: string | null;
  /** The two digits as printed (`26`) and the year they mean (2026). */
  fy: string | null;
  fiscalYear: number | null;
  /** Everything after the office and fiscal year — § 5b's "FON tail". */
  tail: string;
  /** The program abbreviation, from `CDMRP_PROGRAMS`. */
  program: string | null;
  programName: string | null;
  /** Whatever follows the program — the CDMRP analogue of an NIH activity code. */
  mechanism: string | null;
  /** `BTA` from `BTA122`: the letters PR 5.8 attaches priors to. */
  mechanismBase: string | null;
  /** `122` from `BTA122`: the award level or edition, when the FON carries one. */
  mechanismVariant: string | null;
  kind: CdmrpFonKind;
};

/** `HT9425` + two-digit FY + an alphanumeric tail — every FY23+ CDMRP number. */
const MODERN_FON = /^(HT\d{4})(\d{2})([A-Z][A-Z0-9]*)$/;
/** The pre-FY23 dashed PIID form, `W81XWH-22-DHAPP` and `HT9425-23-S-SOC1`. */
const LEGACY_FON = /^([A-Z0-9]{5,8})-(\d{2})-(.+)$/;
/** A mechanism, split into the letters PR 5.8 keys on and the level digits some carry. */
const MECHANISM = /^([A-Z]+)(\d*)$/;
/** The standing Broad Agency Announcement, which is not a program announcement at all. */
const BAA_TAIL = /BAA\d*$/;

/**
 * Cut a CDMRP funding opportunity number into its parts.
 *
 * Never throws and never guesses: a tail with no known program prefix comes
 * back with `program: null` and the whole tail preserved, so the caller can
 * report it rather than store a mechanism that was invented by a regex.
 */
export function decomposeCdmrpFon(opportunityNumber: string | null | undefined): CdmrpFon {
  const fon = (opportunityNumber ?? "").trim().toUpperCase();

  const modern = MODERN_FON.exec(fon);
  const legacy = modern ? null : LEGACY_FON.exec(fon);
  const office = modern?.[1] ?? legacy?.[1] ?? null;
  const fy = modern?.[2] ?? legacy?.[2] ?? null;
  const tail = modern?.[3] ?? legacy?.[3] ?? fon;

  const program = matchProgram(tail);
  const rest = program ? tail.slice(program.length) : "";
  const mechanism = rest.length > 0 ? rest : null;
  const parts = mechanism ? MECHANISM.exec(mechanism) : null;

  return {
    fon,
    office,
    fy,
    // CDMRP numbers start at FY00; a two-digit year is unambiguous for the next
    // seventy years, which is longer than this codebase's problem.
    fiscalYear: fy ? 2000 + Number(fy) : null,
    tail,
    program,
    programName: program ? (CDMRP_PROGRAM_NAMES[program] ?? null) : null,
    mechanism,
    mechanismBase: parts?.[1] ?? null,
    mechanismVariant: parts?.[2] ? parts[2] : null,
    kind: program && mechanism ? "program_announcement" : BAA_TAIL.test(tail) ? "broad_agency_announcement" : "other",
  };
}

/** The longest published program abbreviation the tail starts with, or null. */
export function matchProgram(tail: string): string | null {
  for (const [abbr] of PROGRAMS_BY_LENGTH) {
    if (tail.startsWith(abbr)) return abbr;
  }
  return null;
}

/** True when the number is the FY23+ shape whose `_GG.pdf` this adapter can derive. */
export function hasDerivableProgramAnnouncement(fon: CdmrpFon): boolean {
  return fon.kind === "program_announcement";
}

// ---------------------------------------------------------------------------
// 3 · The Program Announcement's cover page
// ---------------------------------------------------------------------------

/**
 * The three facts a CDMRP PA prints on its cover page, above the deadlines:
 *
 *     Program Announcement for the Defense Health Agency
 *     Spinal Cord Injury Research Program
 *     Translational Research Award
 *     Funding Opportunity Number: HT942526SCIRPTRA
 *
 * `awardName` is the funder's own name for the mechanism the FON's suffix
 * encodes — `TRA` → "Translational Research Award" — which is what makes the
 * suffix table PR 5.8 consumes readable rather than a list of trigrams.
 *
 * `fon` is also a correctness guard. The URL is *derived*, so if
 * `…/HT942526VRPTRA_GG.pdf` ever served a different program's announcement we
 * would store the wrong text against the wrong notice and never notice. The
 * adapter compares this against the number it asked for.
 */
export type CdmrpCoverPage = { fon: string | null; programName: string | null; awardName: string | null };

const COVER_FON = /^Funding\s+Opportunity\s+Number\s*:\s*([A-Z0-9][A-Z0-9-]*)\s*$/i;
/** The banner the title block sits under: "Program Announcement for the Defense Health Agency". */
const COVER_BANNER = /\bAnnouncement\s+for\s+the\b/i;
/** Where the programme's name ends and the award's begins, inside the rejoined title block. */
const COVER_SPLIT = /Research\s+(?:and\s+Development\s+)?Program\b/i;
/** How far into the document the cover page can be. The FY26 PAs print it in the first dozen lines. */
const COVER_SCAN_LINES = 60;

export function parseCdmrpCoverPage(lines: readonly TextLine[]): CdmrpCoverPage {
  const head = lines.slice(0, COVER_SCAN_LINES);
  const at = head.findIndex((l) => COVER_FON.test(l));
  if (at < 0) return { fon: null, programName: null, awardName: null };
  const fon = (COVER_FON.exec(head[at]!)?.[1] ?? "").toUpperCase() || null;

  // The title block is everything between the banner and the number — and it is
  // *wrapped*, not one line per name. Joint Warfighter's PDF breaks after
  // "Joint Warfighter Medical Research" and again after "Military Medical
  // Research and", so the lines are rejoined and then cut at the programme
  // suffix rather than at a line break.
  const banner = head.slice(0, at).map((l) => COVER_BANNER.test(l)).lastIndexOf(true);
  if (banner < 0) return { fon, programName: null, awardName: null };
  const title = head.slice(banner + 1, at).filter((l) => l !== "").join(" ").replace(/\s+/g, " ").trim();

  const split = COVER_SPLIT.exec(title);
  if (!split) return { fon, programName: title || null, awardName: null };
  const end = split.index + split[0].length;
  return { fon, programName: title.slice(0, end).trim() || null, awardName: title.slice(end).trim() || null };
}

// ---------------------------------------------------------------------------
// 4 · The heading tables
// ---------------------------------------------------------------------------

/**
 * The two headings a CDMRP **Broad Agency Announcement** spells differently
 * from a Program Announcement, and why they are here rather than in
 * `heading-tables.ts`.
 *
 * `HT942526JWMRPMMRDA` — Joint Warfighter, the one CDMRP programme published as
 * a BAA rather than a PA — numbers its blocks 1–9 exactly like every other
 * CDMRP document but writes `4. Application/Proposal Contents and Format` and
 * `6. Review Information`. PR 5.3's table matches neither, so it named three
 * blocks; HHS's simplified table matched four *contents-page entries* of 92,
 * 95, 160 and 828 characters and won on `sectionWithBestTable`'s "most named
 * blocks" criterion. The stored `objectives` was then the table-of-contents
 * blurb — "Describes the program mission and intent of the Military Medical
 * Research and Development Award" — instead of the **15,022-character** Program
 * Description. One row in 81, and exactly the failure D69 exists to prevent, so
 * it is worth two patterns.
 *
 * (15,022, not the 57,175 an earlier note here claimed: 57,175 is what block 3
 * measures when `cdmrp.6` is *missing* and the Program Description runs on
 * through Review Information to the end of the document. These two patterns are
 * what puts the boundary back, so the number they produce is 15,022.
 * `sectionWithBestTable`'s `MIN_NAMED_BLOCK_CHARS` is the second half of the
 * fix: it stops the contents page out-scoring the body in the first place.)
 *
 * They are `cdmrp.4` and `cdmrp.6`, the same section ids PR 5.3 uses, and each
 * is a superset of the pattern it precedes — so they replace rather than
 * duplicate, and a PA still sections identically. They live here because
 * `heading-tables.ts` is shared with the NSF adapter landing in parallel and
 * this is a CDMRP-only fact.
 */
const CDMRP_BAA_HEADINGS: readonly HeadingPattern[] = [
  { section: "cdmrp.4", roles: ["other"], test: /^(?:4\s*\.\s*)?(?:Application(?:\s*\/\s*Proposal)?\s+Contents(?:\s+and\s+Format)?)\s*:?\s*$/i },
  { section: "cdmrp.6", roles: ["review"], test: /^(?:6\s*\.\s*)?(?:(?:Application(?:\s*\/\s*Proposal)?\s+)?Review\s+Information)\s*:?\s*$/i },
];

/** PR 5.3's CDMRP table with the BAA spellings in front of it. */
export const CDMRP_PA_HEADINGS_ALL: readonly HeadingPattern[] = [...CDMRP_BAA_HEADINGS, ...CDMRP_PA_HEADINGS];

/**
 * PR 5.3's tables, CDMRP's first.
 *
 * `CDMRP_PA_HEADINGS` already gives `3. Program Description` the `objectives`
 * role — the mission, the vision and the Areas of Emphasis, which is the
 * highest-signal paradigm text in the whole non-NIH corpus — so nothing in
 * `heading-tables.ts` needed to change for this PR.
 *
 * The other two tables are kept as fallbacks because a handful of CDMRP-adjacent
 * DHA documents follow the classic federal skeleton instead: `W81XWH-22-DHAPP`,
 * the DoD HIV/AIDS Prevention Program's announcement, sections only under
 * `federal_nofo` and its objectives block is real. `sectionWithBestTable` scores
 * rather than takes the first match, and ties go to the first table listed, so
 * CDMRP leads.
 */
export const CDMRP_HEADING_TABLES: ReadonlyArray<{ id: string; patterns: readonly HeadingPattern[] }> = [
  { id: "cdmrp_pa", patterns: CDMRP_PA_HEADINGS_ALL },
  { id: "federal_nofo", patterns: FEDERAL_NOFO_HEADINGS },
  { id: "simplified_nofo", patterns: SIMPLIFIED_NOFO_HEADINGS },
];

const SECTION_OPTS = { ignoreHeading: isTableOfContentsLine, dedupe: "longest" as const };

/** Section one CDMRP document with the CDMRP-first table set. */
export function sectionCdmrpDocument(lines: readonly TextLine[]): SectionedDocument | null {
  return sectionWithBestTable(lines, CDMRP_HEADING_TABLES, SECTION_OPTS);
}

// ---------------------------------------------------------------------------
// 5 · The adapter
// ---------------------------------------------------------------------------

/** The columns the adapter reads. Identical to the Grants.gov adapter's, because the mirror fallback is that adapter. */
export type CdmrpRow = GrantsGovRow;

/** Same dependencies as the mirror it falls back to, so the driver injects one bag. */
export type CdmrpDeps = GrantsGovDeps;

/** What the direct `cdmrp.health.mil` route did, per notice — the number § 5c measured. */
export type CdmrpDirectOutcome = "ok" | "no_objectives" | "not_found" | "error" | "skipped";

/** What the dry run prints beyond the shared `Acquisition` fields. */
export type CdmrpExtra = {
  fon: CdmrpFon;
  /** The derived `_GG.pdf`, or null when the number is not the FY23+ shape. */
  directUrl: string | null;
  direct: CdmrpDirectOutcome;
  directError: string | null;
  /** The PA's own cover page, when the direct route read one. */
  cover: CdmrpCoverPage | null;
  /** Set when the cover page named a different FON than the one we asked for — the document is then refused. */
  fonMismatch: string | null;
  /** `"direct"` or `"mirror"`: which route produced the stored sections. */
  route: "direct" | "mirror" | null;
  table: string | null;
  roles: string[];
  objectives: string | null;
  objectiveSections: number;
  thin: boolean;
  /** The mirror's own report, when this notice needed it. */
  mirror: GrantsGovExtra | null;
};

export function appliesToCdmrpPa(row: CdmrpRow): boolean {
  if (row.forecasted === true) return false;
  return funderFamilyOf(row) === "dod_cdmrp";
}

function longestObjectives(doc: SectionedDocument): { text: string | null; count: number } {
  const blocks = doc.sections.filter((s) => (s.roles ?? []).includes("objectives"));
  return {
    text: blocks.reduce<string | null>((best, s) => (best == null || s.text.length > best.length ? s.text : best), null),
    count: blocks.length,
  };
}

/**
 * Read one CDMRP notice.
 *
 * The direct route is one GET, always — never a fan-out over guessed
 * filenames. If it does not produce an `objectives` block the notice falls
 * through to PR 5.3's Grants.gov/Simpler adapter, which is where the `_GG*.pdf`
 * mirror lives.
 */
export async function acquireCdmrpPa(row: CdmrpRow, deps: CdmrpDeps): Promise<Acquisition> {
  const maxBytes = deps.maxBytes ?? MAX_ATTACHMENT_BYTES;
  const read = deps.fetchDocument ?? fetchDocumentWithCap;
  const fon = decomposeCdmrpFon(row.opportunity_number);

  let pageFetches = 0;
  let direct: CdmrpDirectOutcome = "skipped";
  let directError: string | null = null;
  let cover: CdmrpCoverPage | null = null;
  let fonMismatch: string | null = null;
  let sectioned: SectionedDocument | null = null;

  const directUrl = hasDerivableProgramAnnouncement(fon) ? cdmrpProgramAnnouncementUrl(fon.fon) : null;

  if (directUrl) {
    pageFetches += 1;
    const doc: FetchedDocument = await deps.limiterFor(CDMRP_HOST).schedule(() => read(directUrl, maxBytes));
    if (doc.status === "not_found") {
      direct = "not_found";
      directError = `HTTP 404 ${directUrl}`;
    } else if (doc.status === "error") {
      direct = "error";
      directError = doc.error;
    } else {
      try {
        const lines = await documentToLines(doc);
        cover = parseCdmrpCoverPage(lines);
        // The URL is derived, so a mismatch means the route served somebody
        // else's announcement. Refuse it rather than store the wrong programme's
        // text against this notice; the mirror is keyed on the Grants.gov record
        // and cannot make the same mistake.
        if (cover.fon && cover.fon !== fon.fon) {
          direct = "error";
          fonMismatch = cover.fon;
          directError = `cover page names ${cover.fon}, asked for ${fon.fon}`;
        } else {
          const parsed = sectionCdmrpDocument(lines);
          if (parsed && hasObjectives(parsed.sections)) {
            sectioned = parsed;
            direct = "ok";
          } else {
            direct = "no_objectives";
            directError = parsed ? "no objectives block in the direct PA" : "the direct PA could not be sectioned";
          }
        }
      } catch (e) {
        direct = "error";
        directError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  if (sectioned) {
    const { text, count } = longestObjectives(sectioned);
    return {
      status: "ok",
      url: directUrl!,
      source: "cdmrp_pa",
      sections: sectioned.sections,
      textHash: announcementTextHash(sectioned.sections),
      pageFetches,
      simplerCalls: 0,
      extra: {
        fon,
        directUrl,
        direct,
        directError,
        cover,
        fonMismatch,
        route: "direct",
        table: sectioned.table,
        roles: sectioned.roles,
        objectives: text,
        objectiveSections: count,
        thin: text == null,
        mirror: null,
      } satisfies CdmrpExtra,
    };
  }

  // The mirror: PR 5.3's adapter, with this family's heading tables. `_GG*.pdf`
  // is attached to 74 of the 79 modern Grants.gov records (§ 5c), so this is a
  // real second route and not a formality. Passing the tables through is what
  // keeps a PA's `guide_sections` identical whichever route answered — without
  // it, a Joint Warfighter-style BAA read through the mirror would section
  // under HHS's table and store its contents-page blurb as `objectives`.
  //
  // `CDMRP_HEADING_TABLES` unconditionally, *not* `deps.headingTables ?? …`:
  // the direct route above sections with `sectionCdmrpDocument`, which owns its
  // table set, so honouring a caller's override here and not there would give
  // one notice two readings depending on which route answered — the precise
  // divergence this adapter exists to remove. There is no caller-settable knob,
  // so the two routes cannot disagree. `GrantsGovDeps.headingTables` remains
  // what it was added for: the seam one adapter uses to compose another.
  const mirror = await acquireGrantsGovAttachment(row, { ...deps, headingTables: CDMRP_HEADING_TABLES });
  const mirrorExtra = (mirror.extra ?? null) as GrantsGovExtra | null;
  const base = {
    fon,
    directUrl,
    direct,
    directError,
    cover,
    fonMismatch,
    mirror: mirrorExtra,
  };

  if (mirror.status === "ok") {
    return {
      ...mirror,
      pageFetches: pageFetches + mirror.pageFetches,
      extra: {
        ...base,
        route: "mirror",
        table: mirrorExtra?.table ?? null,
        roles: mirrorExtra?.roles ?? [],
        objectives: mirrorExtra?.objectives ?? null,
        objectiveSections: mirrorExtra?.objectiveSections ?? 0,
        thin: mirrorExtra?.objectives == null,
      } satisfies CdmrpExtra,
    };
  }
  // Unreachable today — the Grants.gov adapter has no stored per-file hash to
  // skip on — but the union allows it, and the extra must stay CDMRP-shaped or
  // the driver would print this row as a Grants.gov one.
  if (mirror.status === "unchanged") {
    return {
      ...mirror,
      pageFetches: pageFetches + mirror.pageFetches,
      extra: { ...base, route: "mirror", table: null, roles: [], objectives: null, objectiveSections: 0, thin: true } satisfies CdmrpExtra,
    };
  }

  // Both routes failed. D69's three statuses, with the worse of the two
  // outcomes winning: `error` (something broke, or a document read but would
  // not section) beats `not_found` (a candidate existed and 404'd) beats
  // `not_applicable` (no candidate exists anywhere, so nothing to retry).
  const status = mergeFailure(direct, mirror.status);
  return {
    status,
    url: directUrl ?? mirror.url,
    source: null,
    error: [directError, mirror.error].filter(Boolean).join("; ") || "no announcement on either route",
    pageFetches: pageFetches + mirror.pageFetches,
    simplerCalls: mirror.simplerCalls,
    extra: { ...base, route: null, table: null, roles: [], objectives: null, objectiveSections: 0, thin: true } satisfies CdmrpExtra,
  };
}

const FAILURE_RANK: Record<"not_applicable" | "not_found" | "error", number> = { not_applicable: 0, not_found: 1, error: 2 };

function mergeFailure(direct: CdmrpDirectOutcome, mirror: "not_applicable" | "not_found" | "error"): "not_applicable" | "not_found" | "error" {
  const fromDirect: "not_applicable" | "not_found" | "error" | null =
    direct === "not_found" ? "not_found" : direct === "error" || direct === "no_objectives" ? "error" : null;
  if (!fromDirect) return mirror;
  return FAILURE_RANK[fromDirect] >= FAILURE_RANK[mirror] ? fromDirect : mirror;
}

export const cdmrpPaAdapter: AnnouncementAdapter<CdmrpRow, CdmrpDeps> = {
  id: CDMRP_PA_ADAPTER_ID,
  family: "dod_cdmrp",
  applies: appliesToCdmrpPa,
  acquire: acquireCdmrpPa,
};
