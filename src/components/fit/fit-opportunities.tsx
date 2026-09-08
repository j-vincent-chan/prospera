import { VerdictList, type VerdictListRow } from "@/components/fit/verdict-list";
import { provenanceLine } from "@/components/fit/verdict-list-view";
import type { InvestigatorFitRow, InvestigatorFitSurface } from "@/lib/fit/investigator-fits";

/**
 * "Funding that fits" — the investigator page's fit card (fit-UX PR 3; brief:
 * `docs/fit-ux/README.md` §"Screens / views" 1). **A server component**: it
 * shapes the loaded surface into plain serializable rows and hands them to
 * `VerdictList`, which is the client boundary and holds `{ open, deep,
 * selected, comparing, filter, showRuledOut }` and every handler (C7).
 *
 * What this replaces: `GroupHeading` + `FitRow`, i.e. three fixed groups
 * (Recommended / Exploratory / a "Why not?" `<details>`) each carrying its own
 * explanatory note, with `TierPill` + `EvidenceChips` per row. The groups are
 * gone because the filter chips do the same job from the data (§3a: the label
 * is on every row, so a heading that repeats it is §2.7's repetition), and the
 * three notes are gone because they explained the model rather than the
 * decision (§2.2). `TierPill` and `EvidenceChips` are untouched and still
 * render the two admin `/fit` inspectors.
 *
 * The card draws its own header, so the page does not wrap it in a
 * `SectionCard`: one header per card is the whole point of putting the
 * data-derived filter chips in it.
 */
export function FitOpportunities({ surface, viewerIsAdmin = false }: { surface: InvestigatorFitSurface; viewerIsAdmin?: boolean }) {
  const listRow = (r: InvestigatorFitRow): VerdictListRow => ({
    id: r.opportunityId,
    verdicts: r.verdicts,
    title: r.title,
    href: `/opportunities/${r.opportunityId}`,
    meta: r.meta,
    due: r.due,
    disclosure: { why: r.disclosure.why, gaps: r.disclosure.gaps, items: r.disclosure.items },
    // PR 4: the audit layer behind "All evidence and components →". The
    // disclosure and the audit view show the same `why` and the same bullets —
    // one `PanelContent`, so the sentence a strategist read on the row is the
    // sentence the audit view opens with.
    audit: { content: r.audit, panel: r.disclosure, items: r.items },
    ruledOut: r.ruledOut,
    ruledOutReason: r.ruledOutReason,
  });

  const rows = [...surface.recommended, ...surface.exploratory, ...surface.ruledOut].map(listRow);
  const provenance = provenanceLine({ audience: surface.audience, corpus: surface.openNotices, noun: "open notice", degraded: surface.profilesDegraded });

  if (surface.unavailable) return <Empty>Fit results are not available yet; the team is on fit-v1.</Empty>;
  if (!surface.scored) {
    return (
      <Empty>
        No fit results yet against the {new Intl.NumberFormat("en-US").format(surface.openNotices)} profiled open notices. The nightly fit-results run scores this profile once it has been built.
      </Empty>
    );
  }
  return (
    <VerdictList
      title="Funding that fits"
      rows={rows}
      audience={surface.audience}
      provenance={provenance}
      viewerIsAdmin={viewerIsAdmin}
      empty={
        surface.audience === "investigator"
          ? "No open notice reaches Moderate for your profile yet — the list refreshes nightly."
          : "Nothing open is worth your attention right now. The list refreshes nightly and new notices arrive most weeks."
      }
    />
  );
}

/** The degraded states keep the card's shape (§3i); the header they would carry has nothing to count. */
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
        <h2 className="m-0 text-[15px] font-semibold text-ink">Funding that fits</h2>
      </div>
      <p className="m-0 px-5 py-4 text-dense leading-normal text-ink-muted">{children}</p>
    </section>
  );
}
