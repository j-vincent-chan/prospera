/**
 * The Outreach snapshot as the audit layer's items (fit-UX PR 4; README
 * §"Screens / views" 4.7 — "The items, each with its source link").
 *
 * Pure, and separate from `evidence-view.tsx` for the reason
 * `verdict-row-view.ts` is separate from the row: this repo has no DOM test
 * environment, so anything a mutation could quietly break has to be a value a
 * `.ts` test can read. Three things here are exactly that:
 *
 *   1. **`publicationId` survives the mapping.** It is the only field
 *      `reviewIdentityAction` can act on, nothing else in the view reads it,
 *      and dropping it silently removes "Not this person" from every item
 *      while the page still renders (C4).
 *   2. **The identity, quote, inferred and matched lines survive it.** They
 *      are the "evidence quoting with verified-source links" and the
 *      "Inferred" marker §3 lists under *Kept*.
 *   3. **`suggestionChecks` has one definition.** The row's disclosure and
 *      the audit view both list the snapshot's own warnings; two copies of
 *      that list is how the two surfaces come to disagree about what is worth
 *      checking before you contact someone.
 */
import type { AuditItem, AuditItemGroup } from "@/lib/fit/audit-view";
import type { WorkspaceSuggestion } from "@/lib/outreach/queries";
import type { EvidenceGroup, EvidenceItem } from "@/lib/outreach/types";

/** How many of the snapshot's own warnings a surface lists. They never take room from the analysis; this only stops a row with every flag set from running long. */
export const MAX_CHECKS = 4;

/** Pure. One snapshot item as the audit view lists it. `heading`/`sub`/`tags` are the snapshot's names for title, meta and what matched. */
export function auditItem(it: EvidenceItem): AuditItem {
  return {
    id: it.id,
    title: it.heading,
    meta: it.sub || null,
    link: it.link ?? null,
    quote: it.quote ?? null,
    matched: it.tags ?? null,
    inferred: it.inferred ?? null,
    identity: it.identity ?? null,
    publicationId: it.publicationId ?? null,
  };
}

/** Pure. The snapshot's evidence groups, each keeping its own heading, meta and empty line. */
export function auditItemGroups(groups: readonly EvidenceGroup[]): AuditItemGroup[] {
  return groups.map((g) => ({ key: g.key, title: g.title, meta: g.meta || null, items: g.items.map(auditItem), empty: g.empty ?? null }));
}

/**
 * The clause `suggestion-snapshot.ts` appends to a flag to say what the cap
 * did — "Capped at Potential match.", "Capped at Potential match until
 * confirmed." (fit-UX PR 5's sweep).
 *
 * It is a **verdict written outside `verdicts.ts`**, and it reaches a
 * redesigned surface: `snapshotFor` builds these flags from a `FitResult`'s
 * own `caps`, `suggestionChecks` puts them in the fit-v1 row's disclosure and
 * in the audit view's checks, and there they say two wrong things at once —
 *
 *   - **the wrong word.** "Potential match" is the *legacy* pill's vocabulary
 *     (`TIER_LABEL`); D33 gave fit-v1 "Moderate match", which is what the pill
 *     three lines above the bullet says. One row, two names for one tier.
 *   - **twice.** `caveatOf` already names the binding cap, in the redesign's
 *     own words, in the caveat above the disclosure — §2.7's repetition with
 *     the vocabulary drifting between the copies.
 *
 * The observation itself is worth keeping: an unclear eligibility rule, a
 * low-confidence profile, a mechanism above readiness are all "worth checking
 * before you contact". Only the tier claim comes off, and only where there is
 * a verdict to make it instead.
 */
const CAP_CLAUSE = /\s*Capped at [^.]*\.\s*$/;

/**
 * Pure. The snapshot's own warnings — an unverified identity, a stale profile,
 * a contact history — as the bullets a surface lists under "Worth checking
 * before you contact".
 *
 * **None of them is disqualifying**, which is why they are a separate list
 * from the engine's gap sentences (§3c): an eligibility failure reaches the
 * reader on the chip and in the caveat, above the fold, and these do not
 * compete with it for the same heading.
 *
 * `verdicts: true` says the surface is drawing `FitVerdicts` beside these
 * bullets, and takes the cap clause off (see `CAP_CLAUSE`). It is the caller's
 * fact, not this module's: the legacy path has no verdicts and keeps the
 * sentence whole, which is D-a's "the legacy path is untouched".
 */
export function suggestionChecks(s: Pick<WorkspaceSuggestion, "flags" | "freshLine" | "freshWarn" | "historyLine">, opts: { verdicts?: boolean; max?: number } = {}): string[] {
  const said = (t: string) => (opts.verdicts ? t.replace(CAP_CLAUSE, "") : t);
  return [...s.flags.map((f) => f.text), ...(s.freshWarn ? [s.freshLine] : []), ...(s.historyLine ? [s.historyLine] : [])]
    .filter((t): t is string => Boolean(t?.trim()))
    .map((t) => said(t).trim())
    .filter((t) => t.length > 0)
    .slice(0, opts.max ?? MAX_CHECKS);
}
