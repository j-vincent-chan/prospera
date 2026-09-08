"use client";

import {
  DISCLOSURE_BOX,
  DISCLOSURE_GRID,
  SECTION_LABEL,
  type DisclosureSection,
  type RowVariant,
} from "@/components/fit/verdict-row-view";

/**
 * The fit row's inline disclosure (fit-UX PR 2; brief: `docs/fit-ux/README.md`
 * §"Screens / views" 1, `AUDIT_AND_DECISIONS.md` §3c).
 *
 * **This module exists to make §3c structural.** "Nothing disqualifying lives
 * inside a disclosure" was, in this PR's first draft, a comment plus a test
 * that grepped `verdict-row.tsx` between `function DisclosurePanel` and the
 * next section banner — a slice that a new prop three lines further up escapes
 * entirely, and that never covered `EvidenceCard` at all. So the panel is its
 * own file, and the file does not import `FitVerdicts`: the type is not in
 * scope here, and a disqualifying fact cannot reach this markup without
 * someone adding a prop to `DisclosureProps` and threading it across a module
 * boundary — a change that shows up in a diff and that
 * `verdict-row-view.test.ts` fails on.
 *
 * What the panel is allowed to know is exactly `DisclosureContent` — why the
 * pair was surfaced, what a person could *do*, and what the assessment rests
 * on — plus `sections`, whose headings are labels chosen from the verdict
 * *label* and the subject (not from any verdict's content) by
 * `disclosureSections`, and `flagLabel`, which is the caller's word for what
 * its own flag control does.
 *
 * **What this cannot check, and PR 3 must.** `why`, `gaps[]` and `items[]` are
 * caller-supplied strings. Nothing here can tell whether PR 3 puts a failed
 * eligibility rule into `gaps[0]`; §3c at that level is a contract on the
 * caller and belongs in PR 3's own tests, against real rows.
 */

export type VerdictRowEvidence = {
  id: string;
  /** The item as the disclosure names it — a paper title, a project title. */
  title: string;
  /** "Nature Immunology · Mar 2025 · matched neuroinflammation, microglia". */
  meta?: string | null;
  /** The source's name — "PubMed", "RePORTER". Rendered with a ↗ and linked when `href` is set. */
  source?: string | null;
  href?: string | null;
};

export type VerdictRowDisclosure = {
  /** "Why you are seeing this" — one paragraph. */
  why: string;
  /** The row's own analysis, under the heading its label picks. Never disqualifying (§3c). */
  gaps: readonly string[];
  /**
   * Things worth checking before writing or contacting — a surface's own
   * warnings about the person or the record, which are neither the analysis
   * nor a block. Kept apart from `gaps` so they cannot displace it or inherit
   * its heading (`disclosureSections`).
   */
  checks?: readonly string[];
  /** "What this rests on" — 2–3 cards. */
  items: readonly VerdictRowEvidence[];
};

/** One evidence card in "What this rests on". */
function EvidenceCard({ item }: { item: VerdictRowEvidence }) {
  return (
    <div className="rounded-tile border border-line bg-card px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2.5">
        <p className="text-dense font-medium leading-[1.4] text-ink">{item.title}</p>
        {item.source ? (
          item.href ? (
            <a href={item.href} target="_blank" rel="noreferrer" className="whitespace-nowrap text-micro font-medium text-teal hover:text-navy">
              {item.source} ↗
            </a>
          ) : (
            <span className="whitespace-nowrap text-micro font-medium text-ink-muted">{item.source}</span>
          )
        ) : null}
      </div>
      {item.meta ? <p className="mt-[3px] text-meta text-ink-muted">{item.meta}</p> : null}
    </div>
  );
}

/**
 * The disclosure's contents. Rendered and hidden with `hidden` rather than
 * unmounted, so the toggle's `aria-controls` never points at nothing — and
 * only rendered at all when something can reveal it (see `VerdictRow`).
 */
export function DisclosurePanel({
  id,
  labelledBy,
  open,
  sections,
  disclosure,
  onDeep,
  onFlag,
  flagLabel,
  variant,
}: {
  id: string;
  labelledBy: string;
  open: boolean;
  /** The bullet groups, each with its own label from `disclosureSections`. Headings, never facts. */
  sections: readonly DisclosureSection[];
  disclosure: VerdictRowDisclosure;
  onDeep?: () => void;
  onFlag?: () => void;
  /**
   * What the flag control says. **Paired with `onFlag`**: the row draws the
   * control only when both arrive, so a surface cannot inherit a label written
   * for somebody else's mechanism. One hardcoded "This is wrong…" over a
   * handler that opened a dialog whose primary button is "Dismiss and propose
   * correction" is the fault this pairing removes.
   */
  flagLabel?: string;
  variant: RowVariant;
}) {
  const linkClass = "rounded-control text-meta font-medium text-teal hover:text-navy";
  const flag = onFlag && flagLabel ? { onFlag, flagLabel } : null;
  return (
    <div id={id} role="region" aria-labelledby={labelledBy} hidden={!open} className={DISCLOSURE_BOX[variant]}>
      <div className={DISCLOSURE_GRID[variant]}>
        <div>
          <p className={`mb-1.5 ${SECTION_LABEL}`}>Why you are seeing this</p>
          <p className="text-body leading-relaxed text-ink">{disclosure.why}</p>
          {sections.map((s) => (
            <div key={s.heading}>
              <p className={`mb-1.5 mt-3.5 ${SECTION_LABEL}`}>{s.heading}</p>
              <ul className="list-disc space-y-[5px] pl-[18px] text-body leading-[1.5] text-ink">
                {/* The index is part of the key: the Outreach path composes its
                    bullets from two lists, and the same sentence can arrive
                    from both — a repeated string alone is a duplicate key. */}
                {s.bullets.map((b, i) => (
                  <li key={`${i}-${b}`}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div>
          <p className={`mb-2 ${SECTION_LABEL}`}>What this rests on</p>
          {/* An empty column under a heading reads as a failure to load. A row
              whose rationale cites nothing and whose profile has no provenance
              does exist — found by rendering PR 3's real rows — and it says so. */}
          {disclosure.items.length ? (
            <div className="flex flex-col gap-2">
              {disclosure.items.map((it) => (
                <EvidenceCard key={it.id} item={it} />
              ))}
            </div>
          ) : (
            <p className="text-body leading-relaxed text-ink-muted">No item is linked to this assessment yet.</p>
          )}
          {onDeep || flag ? (
            <div className="mt-3 flex flex-wrap gap-3.5">
              {onDeep ? (
                <button type="button" onClick={onDeep} className={linkClass}>
                  All evidence and components →
                </button>
              ) : null}
              {flag ? (
                <button type="button" onClick={flag.onFlag} className={linkClass}>
                  {flag.flagLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
