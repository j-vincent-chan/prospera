/**
 * The counterpart fit profiles a decision surface needs to render verdicts
 * (fit-UX PR 3; `IMPLEMENTATION_DECISIONS.md` C3, D-h).
 *
 * `fitVerdicts` is pure and takes records the surface has already loaded — the
 * notice profile for approach, eligibility and requirements, the investigator
 * profile for approach and evidence, and `noticeComplete` for "Can't assess".
 * Before this module **no list surface loaded either**:
 * `loadInvestigatorFitSurface` read `funding_opportunities` for
 * `id, title, agency`, and `notice-fit.ts` read investigator names.
 * `loadOpportunityInspection` has the column list but is single-id.
 *
 * So: **one bounded multi-id read per surface**, over the shown rows only,
 * beside the title or name read the surface already does — never one per
 * candidate, which is the rule `investigator-fits.ts`'s header states. The
 * ids are chunked at `CHUNK` so a surface that ever shows more than that many
 * rows degrades into a second bounded read rather than a URL PostgREST will
 * not accept; every surface today shows far fewer.
 *
 * **`complete` comes from the column, not the record** (D22, C1). The profile
 * record's own `sources` is written as `{ text, exemplar_count }` and never
 * carries `complete`; the real signal is the sibling
 * `opportunity_fit_profiles.sources` column, which is what `service.ts`
 * (`p.sources?.complete !== false`) and `inspect/load.ts`
 * (`complete:sources->complete`) both read. This module selects the same JSON
 * path and hands the value to `VerdictInput.noticeComplete`, which is
 * required precisely so a caller cannot drop it and get a confident row for a
 * notice whose Part 2 never parsed.
 *
 * **Neither loader throws.** A table that is not on the database yet answers
 * `available: false`, and any other read failure answers `error` — both with
 * empty maps, the same contract as every other fit read. The first draft threw
 * on anything but the missing table, and one of these reads sits inside
 * `loadWorkspace`, which `outreach/page.tsx` awaits in a `Promise.all`: a
 * transient failure on a *presentation* read turned the whole Outreach board
 * into a 500, on a surface whose neighbouring evidence lookup has
 * `.catch(() => EMPTY_LOOKUP)` on the very next line precisely because it is
 * meant to degrade. What a failed read costs is bars, chips and a couple of
 * sentences; what it must not cost is the page.
 *
 * `available` and `error` are read, not decorative: the surfaces carry the
 * pair through as one `profilesDegraded` boolean and say so in the card's
 * footer, so a table that is missing for every row is distinguishable from a
 * notice that genuinely has no profile — the row's own "no notice profile on
 * file" is a claim about that notice, and it is the wrong claim when nothing
 * was read at all.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_TABLE } from "@/lib/fit/results";
import type { DirectoryCoverage } from "@/lib/fit/surface-states";
import type { InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";

/** Ids per read. PostgREST puts `in()` lists in the query string, so an unbounded list is a URL length problem, not a row-count one. */
export const CHUNK = 200;

/** Pure. The id list split into reads. Distinct, insertion-ordered, empty in → no read. */
export function idChunks(ids: Iterable<string>, size: number = CHUNK): string[][] {
  const distinct = Array.from(new Set(Array.from(ids).filter((id) => typeof id === "string" && id.length > 0)));
  const out: string[][] = [];
  for (let i = 0; i < distinct.length; i += Math.max(1, size)) out.push(distinct.slice(i, i + Math.max(1, size)));
  return out;
}

/**
 * Pure. D22 as both existing readers spell it: a row **without** the field
 * counts as complete. Only an explicit `false` makes a notice incomplete, so a
 * profile written before the field existed does not turn the whole list into
 * "Can't assess".
 */
export function noticeCompleteOf(row: { complete?: unknown } | null | undefined): boolean {
  return row?.complete !== false;
}

/** What every counterpart read answers with beside its rows: whether the table is there, and what went wrong if anything did. Neither throws. */
export type ProfilesRead = {
  /** False when the table is not on the database (the migration is not applied). */
  available: boolean;
  /** The read's own failure, warned by the surface; null when the read succeeded. */
  error: string | null;
};

/**
 * Pure. Whether the verdicts on a surface were built without the profiles they
 * are meant to be read against — the table missing, or the read failing. The
 * card says so once in its footer (`PROFILES_DEGRADED_NOTE`), because
 * otherwise the per-row wording ("no notice profile on file") makes a claim
 * about each notice that nobody established.
 */
export function profilesDegraded(...reads: readonly ProfilesRead[]): boolean {
  return reads.some((r) => !r.available || r.error !== null);
}

export type NoticeProfiles = ProfilesRead & {
  /** `opportunity_id` → the stored notice record. Absent for a notice with no profile row (the §3i degraded row). */
  profiles: Map<string, OpportunityFitProfile>;
  /** `opportunity_id` → `sources.complete` from the column (D22). A notice with no row is **not** called incomplete here — `noticeInputFor` decides that. */
  complete: Map<string, boolean>;
  /**
   * `opportunity_id` → `opportunity_fit_profiles.guide_html_hash`: the hash of
   * the notice text this profile — and therefore the assessment built on it —
   * was read from (B9). `null` when the profile was built without Guide text.
   *
   * **The honest "the notice changed" signal.** `updated_at` moves on any
   * UPDATE (`tr_funding_opportunities_updated_at` is a blanket `BEFORE UPDATE`
   * trigger), and `exemplars-sync.ts` stamps `exemplars_fetched_at` on open
   * NIH-like notices daily, so the banner fired on Prospera's own cron writes
   * while nothing about the notice's text had moved. This is the column the
   * profile cron itself compares to decide a rebuild is due
   * (`profile/opportunity.ts` `profileDue`: "guide_html_hash changed").
   */
  builtFrom: Map<string, string | null>;
};

export const EMPTY_NOTICE_PROFILES: NoticeProfiles = { profiles: new Map(), complete: new Map(), builtFrom: new Map(), available: true, error: null };

type NoticeProfileRow = { opportunity_id: string; profile: OpportunityFitProfile | null; complete?: unknown; guide_html_hash?: string | null };

/**
 * The notice profiles behind a set of shown rows: one read (per `CHUNK`), the
 * profile record and the `sources.complete` column. Degrades; never throws.
 */
export async function loadNoticeProfiles(db: SupabaseClient, opportunityIds: Iterable<string>): Promise<NoticeProfiles> {
  const profiles = new Map<string, OpportunityFitProfile>();
  const complete = new Map<string, boolean>();
  const builtFrom = new Map<string, string | null>();
  const chunks = idChunks(opportunityIds);
  if (!chunks.length) return { profiles, complete, builtFrom, available: true, error: null };
  const empty = (over: Partial<NoticeProfiles>): NoticeProfiles => ({ profiles: new Map(), complete: new Map(), builtFrom: new Map(), available: true, error: null, ...over });
  for (const chunk of chunks) {
    const { data, error } = await db.from("opportunity_fit_profiles").select("opportunity_id, profile, complete:sources->complete, guide_html_hash").in("opportunity_id", chunk);
    if (error) {
      if (MISSING_TABLE.test(error.message)) return empty({ available: false });
      return empty({ error: `opportunity_fit_profiles: ${error.message}` });
    }
    for (const r of (data ?? []) as NoticeProfileRow[]) {
      if (r.profile) profiles.set(r.opportunity_id, r.profile);
      complete.set(r.opportunity_id, noticeCompleteOf(r));
      builtFrom.set(r.opportunity_id, r.guide_html_hash ?? null);
    }
  }
  return { profiles, complete, builtFrom, available: true, error: null };
}

export type InvestigatorProfiles = ProfilesRead & {
  /** `investigator_id` → the stored profile record; absent for a person with no profile row. */
  profiles: Map<string, InvestigatorFitProfile>;
  /**
   * `investigator_id` → `investigator_fit_profiles.pending_items`, the items
   * classified but not yet folded into the profile.
   *
   * One more scalar on a read the surfaces already do, for the one thing the
   * profile record itself cannot say. `profile-state.profileGaps` turns it
   * into "12 items still waiting to be classified" in the card's footer, which
   * is what tells a strategist that a thin list is a fact about the profile
   * rather than about the person. Absent for a row whose column is null.
   */
  pending: Map<string, number>;
};

export const EMPTY_INVESTIGATOR_PROFILES: InvestigatorProfiles = { profiles: new Map(), pending: new Map(), available: true, error: null };

type InvestigatorProfileRow = { investigator_id: string; profile: InvestigatorFitProfile | null; pending_items: number | null };

/** The investigator profiles behind a set of shown rows: one read (per `CHUNK`). Degrades; never throws. */
export async function loadInvestigatorProfiles(db: SupabaseClient, investigatorIds: Iterable<string>): Promise<InvestigatorProfiles> {
  const profiles = new Map<string, InvestigatorFitProfile>();
  const pending = new Map<string, number>();
  const chunks = idChunks(investigatorIds);
  if (!chunks.length) return { profiles, pending, available: true, error: null };
  for (const chunk of chunks) {
    const { data, error } = await db.from("investigator_fit_profiles").select("investigator_id, profile, pending_items").in("investigator_id", chunk);
    if (error) {
      if (MISSING_TABLE.test(error.message)) return { profiles: new Map(), pending: new Map(), available: false, error: null };
      return { profiles: new Map(), pending: new Map(), available: true, error: `investigator_fit_profiles: ${error.message}` };
    }
    for (const r of (data ?? []) as InvestigatorProfileRow[]) {
      if (r.profile) profiles.set(r.investigator_id, r.profile);
      if (typeof r.pending_items === "number") pending.set(r.investigator_id, r.pending_items);
    }
  }
  return { profiles, pending, available: true, error: null };
}

/**
 * How much of the directory has been profiled at all — the two head counts
 * §3i's fourth state rests on (fit-UX PR 5).
 *
 * **Two `head: true` counts, never a row read.** Neither number is per
 * candidate and neither grows with the directory: PostgREST answers both from
 * the count alone, so a 129-person directory and a 12,000-person one cost the
 * same. `investigators` is filtered to live records because the surfaces are
 * (`notice-fit.ts` drops archived people from every ranked list), and counting
 * archived people into the denominator would make a tidy directory read as a
 * thin one.
 *
 * Degrades; never throws — the same contract as the two profile reads above,
 * and for the same reason: this decides a sentence, not a page.
 * `directoryIsThin` makes no claim from a read that did not land.
 */
export async function loadDirectoryCoverage(db: SupabaseClient): Promise<DirectoryCoverage> {
  const [people, profiles] = await Promise.all([
    db.from("investigators").select("id", { count: "exact", head: true }).is("archived_at", null),
    db.from("investigator_fit_profiles").select("investigator_id", { count: "exact", head: true }),
  ]);
  if (profiles.error && MISSING_TABLE.test(profiles.error.message)) return { directory: 0, profiled: 0, available: false, error: null };
  const failure = people.error ?? profiles.error;
  if (failure) return { directory: 0, profiled: 0, available: true, error: `directory coverage: ${failure.message}` };
  return { directory: people.count ?? 0, profiled: profiles.count ?? 0, available: true, error: null };
}

/**
 * Pure. The notice half of a `VerdictInput` for one row.
 *
 * A notice with no profile row keeps `noticeComplete: true` deliberately: it
 * is not a notice whose build stopped half way, it is a notice with nothing on
 * file, and `verdicts.ts` already has words for that — the approach and
 * eligibility chips read "not established" / "unverified" and the caveat says
 * the notice was not checked (D-h). Calling it incomplete instead would put
 * "Can't assess" on the row and hide which of the two it is.
 */
export function noticeInputFor(loaded: NoticeProfiles, opportunityId: string): { notice: OpportunityFitProfile | null; noticeComplete: boolean } {
  return { notice: loaded.profiles.get(opportunityId) ?? null, noticeComplete: loaded.complete.get(opportunityId) ?? true };
}
