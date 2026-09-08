/**
 * The Outreach snapshot as the audit layer's items (fit-UX PR 4; README
 * §"Screens / views" 4.7 — "The items, each with its source link").
 *
 * Pure, and separate from `evidence-view.tsx` for the reason
 * `verdict-row-view.ts` is separate from the row: this repo has no DOM test
 * environment, so anything a mutation could quietly break has to be a value a
 * `.ts` test can read. Three things here are exactly that:
 *
 *   1. **`identityItem` survives the mapping.** It is the only field
 *      `reviewIdentityAction` can act on, nothing else in the view reads it,
 *      and dropping it silently removes "Not this person" from every item
 *      while the page still renders (C4, widened by V1). The legacy
 *      `publicationId` is read here too: `outreach_suggestions.evidence` is a
 *      stored blob, so every snapshot generated before V1 still carries the
 *      old field and must keep its control.
 *   2. **The identity, quote, inferred and matched lines survive it.** They
 *      are the "evidence quoting with verified-source links" and the
 *      "Inferred" marker §3 lists under *Kept*.
 *   3. **`suggestionChecks` has one definition.** The row's disclosure and
 *      the audit view both list the snapshot's own warnings; two copies of
 *      that list is how the two surfaces come to disagree about what is worth
 *      checking before you contact someone.
 */
import type { AuditItem, AuditItemGroup } from "@/lib/fit/audit-view";
import { plainOrNull } from "@/lib/fit/decision-text";
import type { WorkspaceSuggestion } from "@/lib/outreach/queries";
import type { EvidenceGroup, EvidenceItem } from "@/lib/outreach/types";

/** How many of the snapshot's own warnings a surface lists. They never take room from the analysis; this only stops a row with every flag set from running long. */
export const MAX_CHECKS = 4;

/**
 * Prospera's own reading of an item, de-numbered (B7).
 *
 * `matched` and `inferred` are the two fields the snapshot *writes about the
 * fit*, and `suggestion-snapshot.ts` used to put `track record 70%` in the
 * second — rendered by `evidence-view.tsx` in section 7, **above** the
 * collapsed internals block. The writer no longer composes them that way, and
 * this is what covers the snapshots already stored with the old text: they are
 * read back on every render of an existing item and cannot be migrated without
 * a backfill.
 *
 * `quote` and `title` are **not** touched. A quote is verbatim source text and
 * a title is a publication's own — §3's *Kept* list is explicit that evidence
 * quoting stays as it is, and a paper called "IL-6 at 0.5 mg/kg" is not the
 * engine's voice.
 */
function said(text: string | null | undefined): string | null {
  const raw = text?.trim();
  if (!raw) return null;
  const out = plainOrNull(raw);
  if (out === null) return null;
  // A group's meta and an item's `inferred` are **fragments**, not sentences —
  // "Fit engine · Directory · roster" — and `plainClause` punctuates what it
  // returns. Keep the punctuation the source had, and drop the full stop the
  // de-numbering added.
  return /[.!?]$/.test(raw) || !out.endsWith(".") ? out : out.slice(0, -1);
}

/** Pure. One snapshot item as the audit view lists it. `heading`/`sub`/`tags` are the snapshot's names for title, meta and what matched. */
export function auditItem(it: EvidenceItem): AuditItem {
  return {
    id: it.id,
    title: it.heading,
    meta: it.sub || null,
    link: it.link ?? null,
    quote: it.quote ?? null,
    matched: said(it.tags),
    inferred: said(it.inferred),
    identity: it.identity ?? null,
    // V1: the stored shape gained `identityItem`; a snapshot written before it
    // carries `publicationId` and is read as the publication it was.
    identityItem: it.identityItem ?? (it.publicationId ? { kind: "publication", rowId: it.publicationId } : null),
  };
}

/**
 * Pure. The snapshot's evidence groups, each keeping its own heading, meta,
 * empty line — and its **action** (B8).
 *
 * `EvidenceGroup.action` is what the pre-PR-4 evidence view drew inside an
 * empty group: "Add profile ID" on a funding group with no RePORTER id,
 * "Request biosketch" / "Send reminder" on an empty self-described group.
 * `AuditItemGroup` had no field for it, so both were dropped on the floor by
 * the mapping — the only in-context prompts to fix the two most common data
 * gaps, gone from the fit-v1 and the legacy path alike. `profileHref` is the
 * destination the old markup hardcoded (`/investigators/<id>`), passed in
 * rather than rebuilt here, and the action is omitted when the caller has no
 * destination for it — a control is drawn only with its mechanism.
 */
export function auditItemGroups(groups: readonly EvidenceGroup[], opts: { profileHref?: string | null } = {}): AuditItemGroup[] {
  return groups.map((g) => ({
    key: g.key,
    title: g.title,
    meta: said(g.meta),
    items: g.items.map(auditItem),
    empty: g.empty ?? null,
    action: g.action && opts.profileHref ? { kind: g.action.kind, label: g.action.label, href: opts.profileHref } : null,
  }));
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
