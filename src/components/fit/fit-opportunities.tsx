import { FitStateCard } from "@/components/fit/fit-state-card";
import { VerdictList, type VerdictListRow } from "@/components/fit/verdict-list";
import { provenanceLine } from "@/components/fit/verdict-list-view";
import { corpusOf, investigatorCardState, type InvestigatorFitRow, type InvestigatorFitSurface } from "@/lib/fit/investigator-fits";

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
 *
 * **§3i, in fit-UX PR 5.** The two states this direction can be in are chosen
 * by `investigatorSurfaceState` from what the loader read, and nothing here
 * writes a sentence:
 *
 *   - **no profile built** — the card is the state (`FitStateCard`): there are
 *     no rows to filter, no ruled-out rows to count and no corpus this person
 *     was assessed against, so a header of chips reading "All 0" and a footer
 *     claiming an assessment would both be false.
 *   - **nothing clears the bar** — the state is drawn *inside* the card, which
 *     keeps its chips (all at zero, so only "All 0" is drawn), its footer and
 *     its provenance line: the sweep did run, over a corpus the footer states,
 *     and the answer is the card's content rather than a replacement for it.
 *
 * The old first branch said "No fit results yet against the *n* profiled open
 * notices" for **both** — a person whose profile has never been built and a
 * person whose profile cleared nothing — which is the distinction §3i's first
 * two states exist to make, and the one thing a strategist needs to know to
 * decide whether there is anything to do about it.
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
  // B5: `corpusOf` is `null` when the head count did not come back, and the
  // line then states no corpus rather than stating zero.
  const provenance = provenanceLine({ audience: surface.audience, corpus: corpusOf(surface), noun: "open notice", degraded: surface.profilesDegraded });
  // §3i, decided in `investigator-fits.ts` and not here: which rows count as
  // listed, which count the "nearest" button may offer, and whose audience the
  // sentence is written for are three choices with plausible wrong answers,
  // and a choice made in this file is one no test in this repo can reach.
  const state = investigatorCardState(surface);

  if (surface.unavailable) return <Unavailable />;
  // No profile: the state *is* the card. Chips and a provenance line would be
  // claims about an assessment that has not happened.
  if (state?.id === "no_profile") return <FitStateCard title="Funding that fits" state={state} investigatorId={surface.investigatorId} />;
  return (
    <VerdictList
      title="Funding that fits"
      rows={rows}
      audience={surface.audience}
      provenance={provenance}
      viewerIsAdmin={viewerIsAdmin}
      empty={state ?? undefined}
    />
  );
}

/**
 * The one state that is about the system rather than the data: `fit_results`
 * is not on the database. It is not one of §3i's four — those all describe
 * something true about a person, a notice or a directory — so it keeps the
 * plain line it had rather than borrowing a state's shape and its actions.
 */
function Unavailable() {
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
        <h2 className="m-0 text-[15px] font-semibold text-ink">Funding that fits</h2>
      </div>
      <p className="m-0 px-5 py-4 text-dense leading-normal text-ink-muted">Fit results are not available yet; the team is on fit-v1.</p>
    </section>
  );
}
