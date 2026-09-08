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
 * Pure. The snapshot's own warnings — an unverified identity, a stale profile,
 * a contact history — as the bullets a surface lists under "Worth checking
 * before you contact".
 *
 * **None of them is disqualifying**, which is why they are a separate list
 * from the engine's gap sentences (§3c): an eligibility failure reaches the
 * reader on the chip and in the caveat, above the fold, and these do not
 * compete with it for the same heading.
 */
export function suggestionChecks(s: Pick<WorkspaceSuggestion, "flags" | "freshLine" | "freshWarn" | "historyLine">, max: number = MAX_CHECKS): string[] {
  return [...s.flags.map((f) => f.text), ...(s.freshWarn ? [s.freshLine] : []), ...(s.historyLine ? [s.historyLine] : [])]
    .filter((t): t is string => Boolean(t?.trim()))
    .slice(0, max);
}
