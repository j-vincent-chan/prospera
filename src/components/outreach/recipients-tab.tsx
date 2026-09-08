"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  addRecipientsAction,
  dismissCommunityAction,
  dismissSuggestionAction,
  type DismissalProposal,
  recordReplyAction,
  regenerateSuggestionsAction,
  removeRecipientAction,
  restoreProfileAction,
  restoreRecipientAction,
  restoreSuggestionsAction,
  searchDirectoryAction,
  setSuggestionsModeAction,
  updateProfileAction,
} from "@/app/actions/outreach-actions";
import { reviewIdentityAction } from "@/app/actions/investigator-actions";
import { ProposeCorrectionBanner } from "@/components/fit/propose-correction";
import { TierPill } from "@/components/fit/tier-pill";
import { VerdictRow } from "@/components/fit/verdict-row";
import { CAVEAT_TONE, CHIP_BASE, CHIP_TONE, TITLE_CLASS } from "@/components/fit/verdict-row-view";
import { communityCaveat, communityChips, communityState, COMMUNITY_LABEL_PILL, COMMUNITY_LABEL_TEXT, isCollapsed, isSuggested } from "@/components/outreach/community-row-view";
import { auditItemGroups, suggestionChecks } from "@/components/outreach/audit-items";
import { inspectorHref, snapshotLine } from "@/components/outreach/audit-sections";
import { DismissDialog } from "@/components/outreach/dismiss-dialog";
import { EvidenceView } from "@/components/outreach/evidence-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { orderedReasons, snapshotRationale } from "@/lib/fit/explain-view";
import { dismissReasonLabel, dismissReasonOptions } from "@/lib/fit/feedback/dismissal";
import type { FitEngine } from "@/lib/fit/flag";
import { fmtMonD } from "@/lib/investigators/sources";
import { personStatus, type DueField } from "@/lib/fit/verdict-fields";
import { profileSummaryLine } from "@/lib/outreach/profile";
import type { WorkspaceCommunity, WorkspaceData, WorkspaceRecipient, WorkspaceSuggestion } from "@/lib/outreach/queries";
import { COVERAGE_HELP, FACETS, type DismissReason, type FacetKey, type OpportunityProfile, type SuggestionOptions } from "@/lib/outreach/types";
import { cn } from "@/lib/utils/cn";

const pill = (cls: string) => cn("inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-micro font-medium", cls);

/**
 * The legacy row's coverage dots. Moved here from `evidence-view.tsx` in
 * fit-UX PR 4: the audit layer says confidence in words (§3a, the evidence
 * verdict), and three 6px dots are exactly the "strength and confidence
 * visually fused" §2.4 objects to. This is the only surface left that draws
 * them, and only under `teams.fit_engine = 'legacy'`, where there is no
 * evidence verdict to say instead.
 */
function EvidenceDots({ coverage }: { coverage: "strong" | "partial" | "limited" }) {
  const on = coverage === "strong" ? 3 : coverage === "partial" ? 2 : 1;
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => <span key={i} className={cn("inline-block h-1.5 w-1.5 rounded-full", i < on ? "bg-teal" : "bg-line-control")} />)}
    </span>
  );
}
const btnLink = "text-meta font-medium text-teal hover:text-navy whitespace-nowrap";

/**
 * What the disclosure's flag control says on this surface.
 *
 * **Not "This is wrong…".** The handler behind it is `setWrongTypeFor`, which
 * opens `DismissDialog` — titled "Wrong type of research", primary button
 * "Dismiss and propose correction" — so the generic words promised a report
 * and delivered a removal: a strategist who thought a chip was wrong lost the
 * person from the list. Routing to that dialog is right (§3 keeps "dismissal
 * reasons feeding profile corrections"); what must not surprise is the label,
 * so it names the dialog it opens, verbatim, and the `…` says a dialog is
 * where the choice is made — as it does on "Record a reply…" elsewhere on this
 * tab. The dialog's own button states the effect before anything happens.
 */
const WRONG_TYPE_LABEL = "Wrong type of research…";

export function RecipientsTab({ data, evidenceFor, onEvidence, viewer }: { data: WorkspaceData; evidenceFor: string | null; onEvidence: (id: string | null) => void; viewer: { id: string; name: string; isAdmin?: boolean } }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState<string[]>([]);
  const [showExpl, setShowExpl] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showAllComm, setShowAllComm] = useState(false);
  /** One disclosure open at a time (README §"Interactions & behaviour"). */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [options, setOptions] = useState<SuggestionOptions>(data.item.options);
  const [profileEdit, setProfileEdit] = useState(false);
  const [draftFacets, setDraftFacets] = useState<Record<FacetKey, string[]>>(data.profile.facets);
  const [applied, setApplied] = useState<{ removed: string[]; effect: string; previous: OpportunityProfile } | null>(null);
  const [replyFor, setReplyFor] = useState<WorkspaceRecipient | null>(null);
  /** PR 3.2: the suggestion whose "wrong type of research" sub-reason is being picked, and the profile correction the last such dismissal proposed. */
  const [wrongTypeFor, setWrongTypeFor] = useState<WorkspaceSuggestion | null>(null);
  const [proposal, setProposal] = useState<DismissalProposal | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; meta: string; email: string | null; alreadyAdded: boolean }>>([]);
  useEffect(() => setDraftFacets(data.profile.facets), [data.profile.facets]);
  useEffect(() => {
    if (query.trim().length < 2) return setResults([]);
    const t = setTimeout(() => { void searchDirectoryAction(query, data.item.id).then((r) => { if (r.ok) setResults(r.people); }); }, 250);
    return () => clearTimeout(t);
  }, [query, data.item.id]);

  const people = data.recipients.filter((r) => r.kind === "person");
  const tagged = data.recipients.filter((r) => r.kind === "community");
  const state = data.item.suggestionsState;
  const active = data.suggestions.filter((s) => s.status === "active");
  const main = active.filter((s) => s.tier !== "exploratory");
  const expl = active.filter((s) => s.tier === "exploratory");
  const dismissed = data.suggestions.filter((s) => s.status === "dismissed");
  const excluded = data.suggestions.filter((s) => s.status === "excluded");
  const onlyExploratory = state === "ready" && main.length === 0 && expl.length > 0;
  const allDismissed = state === "ready" && main.length === 0 && expl.length === 0 && dismissed.length > 0 && !showDismissed;
  const none = state === "ready" && active.length === 0 && dismissed.length === 0;
  /** PR 3.2: a fit-v1 team sees Exploratory under its own heading, always; legacy keeps the toggle. */
  const fit = data.team.fitEngine === "fit-v1";
  const explShown = fit || showExpl || onlyExploratory;
  const visible = [...main, ...(explShown ? expl : []), ...(showDismissed ? dismissed : [])];
  const evidence = evidenceFor ? data.suggestions.find((s) => s.id === evidenceFor || s.investigatorId === evidenceFor) ?? null : null;
  const refined = excluded.filter((s) => /option/.test(s.excludedReason ?? ""));

  const refresh = () => router.refresh();
  const regenerate = (opts?: Partial<SuggestionOptions>) =>
    startTransition(async () => {
      setOptionsOpen(false);
      const r = await regenerateSuggestionsAction(data.item.id, opts);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      refresh();
    });

  const add = (ids: string[], names: string[]) =>
    startTransition(async () => {
      const r = await addRecipientsAction({ itemId: data.item.id, investigatorIds: ids, origin: "suggested" });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setChecked((c) => c.filter((x) => !ids.includes(x)));
      refresh();
      toast({ message: names.length === 1 ? `Added ${names[0]} to recipients` : `Added ${names.length} to recipients`, action: { label: "Undo", onClick: () => startTransition(async () => { const { data: _d } = { data: null }; void _d; router.refresh(); toast({ message: "Remove them from Selected to undo." }); }) } });
    });

  const dismiss = (ids: string[], names: string[], reason: DismissReason, axisReason?: string | null) =>
    startTransition(async () => {
      const r = await dismissSuggestionAction({ itemId: data.item.id, suggestionIds: ids, reason, axisReason: axisReason ?? null });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setChecked((c) => c.filter((x) => !ids.includes(x)));
      setWrongTypeFor(null);
      if (evidence && ids.includes(evidence.id)) onEvidence(null);
      refresh();
      // The one-click profile correction a "wrong type of research" dismissal proposes (spec §12): shown above the list until proposed or declined.
      setProposal(r.proposal);
      if (r.proposalNote && axisReason) toast({ message: `Dismissed · ${r.label}. ${r.proposalNote}` });
      if (!r.axisStored) toast({ message: "The sub-reason could not be stored: the 3.2 migration (outreach_suggestions.axis_reason) is not applied yet. The reason was recorded.", tone: "error" });
      toast({ message: `Dismissed ${names.length === 1 ? names[0] : `${names.length} suggestions`}${r.label ? ` · ${r.label}` : ""}`, action: { label: "Undo", onClick: () => startTransition(async () => { const u = await restoreSuggestionsAction({ itemId: data.item.id, previous: r.previous, undoDoNotContact: reason === "do_not_contact" }); if (!u.ok) return toast({ message: u.error, tone: "error" }); setProposal(null); refresh(); }) } });
    });

  const removeRecipient = (r: WorkspaceRecipient) =>
    startTransition(async () => {
      const res = await removeRecipientAction(r.id);
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      refresh();
      toast({ message: `Removed ${r.name} from ${r.kind === "community" ? "this opportunity" : "recipients"}`, action: { label: "Undo", onClick: () => startTransition(async () => { const u = await restoreRecipientAction(r.id); if (!u.ok) return toast({ message: u.error, tone: "error" }); refresh(); }) } });
    });

  const tagCommunity = (c: WorkspaceCommunity) =>
    startTransition(async () => {
      const r = await addRecipientsAction({ itemId: data.item.id, communityIds: [c.id], origin: c.tier === "strong" || c.tier === "potential" ? "suggested" : "you" });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      refresh();
      toast({ message: `Tagged ${c.name} to this opportunity`, action: { label: "Undo", onClick: () => startTransition(async () => { const rec = data.recipients.find((x) => x.communityId === c.id); if (rec) await removeRecipientAction(rec.id); refresh(); }) } });
    });
  const dismissCommunity = (c: WorkspaceCommunity, dismissedFlag: boolean) =>
    startTransition(async () => {
      const r = await dismissCommunityAction(data.item.id, c.id, dismissedFlag);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      refresh();
      if (dismissedFlag) toast({ message: `Dismissed ${c.name} suggestion`, action: { label: "Undo", onClick: () => startTransition(async () => { await dismissCommunityAction(data.item.id, c.id, false); refresh(); }) } });
    });

  const applyProfile = () =>
    startTransition(async () => {
      const r = await updateProfileAction(data.item.id, draftFacets);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      const removed = FACETS.flatMap((f) => r.previous.facets[f.key].filter((t) => !draftFacets[f.key].includes(t)));
      setApplied({ removed, effect: r.removedSuggestions ? `${r.removedSuggestions} suggestion${r.removedSuggestions === 1 ? "" : "s"} removed` : "no change to suggestions", previous: r.previous });
      setProfileEdit(false);
      refresh();
    });

  /**
   * C4 — "Not this person", on publications only.
   *
   * `reviewIdentityAction` takes `kind: keyof typeof KIND_TABLE` and
   * `KIND_TABLE = { publication, grant, trial }`, so the reason the brief gives
   * for this restriction is not true; the restriction stands anyway
   * (`IMPLEMENTATION_DECISIONS.md` C4) and `identityReviewId` is where it is
   * enforced. `kind: "publication"` here is therefore honest rather than
   * incidental: this handler is only ever reached for a publication.
   */
  const notThisPerson = (publicationId: string, title: string) =>
    startTransition(async () => {
      if (!evidence) return;
      const r = await reviewIdentityAction({ investigatorId: evidence.investigatorId, kind: "publication", itemId: publicationId, decision: "reject" });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: `Marked “${title.slice(0, 40)}…” as not this person · profile updated` });
      refresh();
    });

  // ---- The audit layer replaces the list (fit-UX PR 4) ----
  //
  // The list's own state — which rows are checked, which disclosure is open,
  // the dismissed / excluded toggles — lives in this component and outlives
  // the view, so "← Back to the recipients" restores it exactly (README
  // §"State management"). The controls are this surface's: Add, Dismiss and the
  // menu of dismissal reasons, and the flag control keeps the words that name
  // the dialog it opens rather than the generic ones.
  if (evidence) {
    const dismissed = evidence.status === "dismissed";
    const evidenceActions = (
      <div className="flex shrink-0 items-center gap-1.5">
        {evidence.status === "added" ? (
          <span className="inline-flex h-8 items-center rounded-control bg-success-tint px-2.5 text-dense font-medium text-success">Added</span>
        ) : dismissed ? (
          <Button variant="secondary" size={32} onClick={() => startTransition(async () => { await restoreSuggestionsAction({ itemId: data.item.id, previous: [{ id: evidence.id, status: "active" }] }); refresh(); })}>Restore</Button>
        ) : (
          <>
            <Button variant="primary" size={32} onClick={() => add([evidence.investigatorId], [evidence.name])}>Add to recipients</Button>
            <Button variant="secondary" size={32} onClick={() => dismiss([evidence.id], [evidence.name], "not_relevant")}>Dismiss</Button>
            <Button variant="secondary" size={32} onClick={() => dismiss([evidence.id], [evidence.name], "wrong_person")}>Wrong person</Button>
          </>
        )}
      </div>
    );
    return (
      <EvidenceView
        subject="person"
        title={evidence.name}
        href={`/investigators/${evidence.investigatorId}`}
        meta={[evidence.dept, evidence.rank, evidence.identityLine].filter(Boolean).join(" · ") || null}
        provenance={snapshotLine(evidence.snapshotAt)}
        fit={evidence.fit ? { verdicts: evidence.fit.verdicts, panel: evidence.fit.disclosure, audit: evidence.fit.audit } : null}
        legacy={{ label: <TierPill tier={evidence.tier} engine={data.team.fitEngine} />, summary: evidence.summary, checks: [] }}
        checks={suggestionChecks(evidence)}
        items={auditItemGroups(evidence.groups)}
        inspectorHref={viewer.isAdmin ? inspectorHref("person", evidence.investigatorId) : null}
        onBack={() => onEvidence(null)}
        backLabel="← Back to the recipients"
        onFlag={fit ? () => setWrongTypeFor(evidence) : undefined}
        flagLabel={fit ? WRONG_TYPE_LABEL : undefined}
        actions={evidenceActions}
        onNotThisPerson={notThisPerson}
        pending={pending}
      />
    );
  }

  const suggestedCommunities = data.communities.filter((c) => isSuggested(c) && !c.tagged && !c.dismissed);
  const activeCommunities = data.communities.filter((c) => c.tier !== "inactive").length;
  const order = (c: WorkspaceCommunity) => (c.tagged ? 0 : isSuggested(c) && !c.dismissed ? 1 : 2);
  const sortedComm = [...data.communities].sort((a, b) => order(a) - order(b));
  // fit-UX PR 3: the matching and tagged communities get the row grammar;
  // every other monitored one collapses to a single line (README §"Screens / views" 3).
  const primaryComm = sortedComm.filter((c) => !isCollapsed(c));
  const restComm = sortedComm.filter((c) => isCollapsed(c));
  const commSummary = suggestedCommunities.length === 0
    ? tagged.length ? `${tagged.length} tagged · no other monitored community is a meaningful match` : "No monitored community is a meaningful match · you can still tag one"
    : `${suggestedCommunities.length} of ${activeCommunities} monitored suggested · ${tagged.length} tagged`;

  const fchip = (excl: boolean) => cn("inline-flex h-6 items-center whitespace-nowrap rounded-full px-[9px] text-meta", excl ? "bg-danger-tint text-danger-dark" : "border border-line bg-card text-ink-on-tint");
  const pendingEdits = FACETS.some((f) => JSON.stringify(draftFacets[f.key]) !== JSON.stringify(data.profile.facets[f.key]));
  /** The status a person's row shows, from the recipient row when there is one (§"Screens / views" 2: Status, never Deadline). */
  const statusOf = (investigatorId: string) => {
    const rec = data.recipients.find((r) => r.investigatorId === investigatorId);
    return personStatus(rec ? { status: rec.status, line: rec.statusLine } : {});
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      {/* Opportunity profile — one line of prose (fit-UX PR 3, README §"Screens / views" 3).
          The nine-row editable facet grid is unchanged behind "Edit what counts as a match";
          what it replaces is that grid sitting open above every list on the tab. */}
      <section className="rounded-card border border-line bg-footer-bar">
        {profileEdit ? (
          <>
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <p className="m-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">What counts as a match</p>
              <div className="flex gap-1.5">
                <Button variant="secondary" size={28} onClick={() => { setProfileEdit(false); setDraftFacets(data.profile.facets); }}>Cancel</Button>
                <Button variant="primary" size={28} disabled={!pendingEdits || pending} onClick={applyProfile}>{pending ? "Re-ranking…" : "Apply and re-rank"}</Button>
              </div>
            </div>
            <div className="px-3.5 pb-1.5">
              {FACETS.map((f) => (
                <div key={f.key} className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 border-t border-line-row py-2">
                  <p className="m-0 pt-1 text-meta text-ink-muted">{f.label}{f.key === "topics" && data.profile.sections?.topics ? <span className="block text-[11px]">{data.profile.sections.topics}</span> : null}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    {draftFacets[f.key].map((t) => (
                      <span key={t} className={fchip(Boolean(f.excluded))}>
                        {f.excluded ? `not: ${t}` : t}
                        <button type="button" aria-label="Remove" onClick={() => setDraftFacets((d) => ({ ...d, [f.key]: d[f.key].filter((x) => x !== t) }))} className="ml-1 text-dense leading-none opacity-60 hover:opacity-100">×</button>
                      </span>
                    ))}
                    <input
                      placeholder="+ add"
                      aria-label={`Add ${f.label}`}
                      className="h-6 w-[84px] rounded-full border border-dashed border-line-control bg-card px-2 text-meta outline-none focus:border-teal"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        const v = (e.currentTarget.value || "").trim();
                        if (!v) return;
                        setDraftFacets((d) => ({ ...d, [f.key]: Array.from(new Set([...d[f.key], v])) }));
                        e.currentTarget.value = "";
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="m-0 px-3.5 pb-3 pt-2 text-meta leading-normal text-ink-muted">Extracted by Prospera from the notice text; every facet links to the section it came from. Editing re-ranks suggestions only. Your selected recipients are unaffected.</p>
          </>
        ) : (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 px-3.5 py-2.5">
            <p className="m-0 min-w-0 flex-1 text-dense leading-normal text-ink-body">{profileSummaryLine(data.profile)}</p>
            <div className="flex shrink-0 items-center gap-3.5">
              <button type="button" className={btnLink} onClick={() => { setProfileEdit(true); setOptionsOpen(false); }}>Edit what counts as a match</button>
              <button type="button" className={btnLink} disabled={pending || state === "loading"} onClick={() => regenerate()}>Reassess</button>
            </div>
          </div>
        )}
      </section>

      {/* Communities */}
      <section className="rounded-card border border-line">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-row px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <p className="m-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Communities</p>
            <span className="whitespace-nowrap text-meta text-ink-muted">{commSummary}</span>
          </div>
          <Link href="/communities" className={btnLink}>Manage monitored list →</Link>
        </div>
        {primaryComm.map((c) => (
          <CommunityRow
            key={c.id}
            c={c}
            pending={pending}
            onTag={() => tagCommunity(c)}
            onDismiss={() => dismissCommunity(c, true)}
            onRestore={() => dismissCommunity(c, false)}
            onRemove={() => { const rec = data.recipients.find((x) => x.communityId === c.id); if (rec) removeRecipient(rec); }}
          />
        ))}
        {showAllComm
          ? restComm.map((c) => (
              <CommunityLine
                key={c.id}
                c={c}
                pending={pending}
                onTag={() => tagCommunity(c)}
                onRestore={() => dismissCommunity(c, false)}
              />
            ))
          : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-row px-3.5 py-2.5">
          {restComm.length ? <button type="button" className="whitespace-nowrap text-dense font-medium text-ink-muted hover:text-ink" onClick={() => setShowAllComm((v) => !v)}>{showAllComm ? "Hide other monitored communities" : `Show ${restComm.length} more monitored communities`}</button> : <span />}
          <span className="text-meta leading-normal text-ink-muted">Only the communities you monitor are evaluated. Tagging associates a community with this opportunity; nothing is sent until you compose outreach.</span>
        </div>
      </section>

      {/* Selected */}
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="m-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Selected · {people.length} {people.length === 1 ? "person" : "people"} · {tagged.length} {tagged.length === 1 ? "community" : "communities"}</p>
          <div className="relative flex items-center gap-2.5">
            <span className="whitespace-nowrap text-meta text-ink-muted">Chosen by you unless marked Suggested</span>
            <Input size={32} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add from directory — name, department, keyword…" aria-label="Add from directory" className="w-[290px] text-dense" />
            <Popover open={results.length > 0} onClose={() => setResults([])} label="Directory results" align="end" width={360} className="!top-[38px] p-1">
              {results.map((p) => (
                <button key={p.id} type="button" disabled={p.alreadyAdded || pending} onClick={() => { setQuery(""); setResults([]); startTransition(async () => { const r = await addRecipientsAction({ itemId: data.item.id, investigatorIds: [p.id], origin: "you" }); if (!r.ok) return toast({ message: r.error, tone: "error" }); refresh(); toast({ message: `Added ${p.name} to recipients` }); }); }} className="flex w-full items-center justify-between gap-3 rounded-tile px-2.5 py-2 text-left hover:bg-canvas disabled:opacity-50">
                  <span className="min-w-0"><span className="block truncate text-dense font-medium text-ink">{p.name}</span><span className="block truncate text-meta text-ink-muted">{p.meta || p.email || "—"}</span></span>
                  <span className="whitespace-nowrap text-meta text-ink-muted">{p.alreadyAdded ? "Added" : p.email ? "Add" : "No email"}</span>
                </button>
              ))}
            </Popover>
          </div>
        </div>
        <div className="rounded-card border border-line">
          {people.length === 0 ? <p className="m-0 px-3.5 py-3 text-dense text-ink-muted">No one selected yet. Add from the directory or from the suggestions below.</p> : null}
          {people.map((r) => (
            <div key={r.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto_28px] items-center gap-3 border-t border-line-row px-3.5 py-2.5 first:border-t-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-tint text-[11px] font-semibold text-teal">{r.initials}</span>
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-1.5 whitespace-nowrap text-body font-medium text-ink">{r.name} <span className={pill(r.origin === "you" ? "bg-line-row text-ink-body" : "bg-teal-tint text-teal")}>{r.origin === "you" ? "You" : "Suggested"}</span>{r.doNotContact ? <span className={pill("bg-danger-tint text-danger")}>Do not contact</span> : null}</p>
                <p className="mb-0 mt-0.5 truncate text-meta text-ink-muted">{r.meta || r.email || "—"}</p>
              </div>
              <span className={pill(r.statusKind === "good" ? "bg-success-tint text-success" : r.statusKind === "warn" ? "bg-warning-tint text-warning" : r.statusKind === "teal" ? "bg-teal-tint text-teal" : "bg-line-row text-ink-body")}>{r.statusLine}</span>
              <Menu label={`More for ${r.name}`} align="end" width={220} trigger={({ toggle, triggerProps }) => <button type="button" onClick={toggle} {...triggerProps} aria-label="More" className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted hover:border hover:border-line-control"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></button>}>
                <MenuItem href={`/investigators/${r.investigatorId}`}>Open profile</MenuItem>
                <MenuItem onSelect={() => setReplyFor(r)}>Record a reply…</MenuItem>
                <MenuSeparator />
                <MenuItem tone="destructive" onSelect={() => removeRecipient(r)}>Remove from recipients</MenuItem>
              </Menu>
            </div>
          ))}
        </div>
      </section>

      {/* Suggested */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-teal-tint px-2 text-micro font-semibold text-teal"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>Suggested</span>
            <span className="whitespace-nowrap text-meta text-ink-muted">{data.directoryCount} profiles · eligibility rules first, then ranked against the profile · refreshed nightly</span>
          </div>
          <div className="relative flex items-center gap-1.5">
            {dismissed.length ? <button type="button" className="mr-1.5 whitespace-nowrap text-dense font-medium text-ink-muted hover:text-ink" onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? "Hide" : "Show"} dismissed ({dismissed.length})</button> : null}
            <Button variant="secondary" size={28} onClick={() => setOptionsOpen((v) => !v)} aria-expanded={optionsOpen}>Options</Button>
            <Button variant="secondary" size={28} onClick={() => regenerate()} disabled={pending || state === "loading"}>{state === "none" ? "Generate suggestions" : "Regenerate"}</Button>
            <Popover open={optionsOpen} onClose={() => setOptionsOpen(false)} label="Suggestion options" align="end" width={340} className="!top-[36px]">
              <div className="flex flex-col gap-2.5">
                <p className="m-0 text-dense font-semibold text-ink">Options</p>
                {([["excludeRecentlyContacted", "Exclude people contacted in the last 90 days"], ["earlyCareerOnly", "Early-career investigators only"], ["excludeRenewalsDue", "Exclude people with renewals due within 6 months"]] as const).map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 text-dense text-ink"><Checkbox checked={options[k]} onChange={(e) => setOptions((o) => ({ ...o, [k]: e.target.checked }))} />{label}</label>
                ))}
                <p className="m-0 text-meta leading-normal text-ink-muted">To change what counts as a match, edit the opportunity profile above.</p>
                <div className="flex justify-end gap-1.5"><Button variant="secondary" size={28} onClick={() => setOptionsOpen(false)}>Cancel</Button><Button variant="primary" size={28} onClick={() => regenerate(options)}>Apply</Button></div>
              </div>
            </Popover>
          </div>
        </div>

        {refined.length && state === "ready" ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-tile border border-line bg-canvas px-3 py-2 text-dense">
            <span>Options applied · <span className="font-medium">{refined.length} removed</span> ({refined.slice(0, 3).map((s) => `${s.name}, ${s.excludedReason?.split(" (")[0]?.toLowerCase()}`).join("; ")}{refined.length > 3 ? "…" : ""})</span>
            <button type="button" className={btnLink} onClick={() => { setOptions({ excludeRecentlyContacted: false, earlyCareerOnly: false, excludeRenewalsDue: false }); regenerate({ excludeRecentlyContacted: false, earlyCareerOnly: false, excludeRenewalsDue: false }); }}>Undo</button>
          </div>
        ) : null}
        {applied ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-tile border border-line bg-canvas px-3 py-2 text-dense">
            <span>Profile updated{applied.removed.length ? ` · removed ${applied.removed.map((t) => `“${t}”`).join(", ")}` : ""} · <span className="font-medium">{applied.effect}</span></span>
            <button type="button" className={btnLink} onClick={() => startTransition(async () => { const r = await restoreProfileAction(data.item.id, applied.previous); if (!r.ok) return toast({ message: r.error, tone: "error" }); setApplied(null); refresh(); })}>Undo</button>
          </div>
        ) : null}
        {data.item.noticeChangedSince ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-tile border border-warning-border bg-warning-tint px-3 py-2 text-dense text-warning-dark">
            <span>The notice changed on {data.item.noticeChangedAt ? fmtMonD(data.item.noticeChangedAt) : "a later date"}. These suggestions were made before that.</span>
            <Button variant="secondary" size={28} className="border-warning-border text-warning-dark" onClick={() => regenerate()}>Re-check</Button>
          </div>
        ) : null}

        {state === "loading" || pending && state !== "ready" ? (
          <>
            <div className="rounded-card border border-line">
              {["60%", "45%", "55%"].map((w, i) => (
                <div key={i} className="grid grid-cols-[16px_28px_minmax(0,1fr)_auto] items-start gap-3 border-t border-line-row px-3.5 py-3 first:border-t-0">
                  <span className="h-4 w-4 rounded bg-skeleton" /><span className="h-7 w-7 rounded-full bg-skeleton" />
                  <span><span className="block h-3.5 rounded bg-skeleton" style={{ width: w }} /><span className="mt-2 block h-3 w-[90%] rounded bg-skeleton" /><span className="mt-1.5 block h-3 w-[40%] rounded bg-skeleton" /></span>
                  <span className="h-7 w-[100px] rounded bg-skeleton" />
                </div>
              ))}
            </div>
            <p className="mb-0 mt-2 text-meta text-ink-muted">Applying eligibility rules, then ranking {data.directoryCount} profiles against the opportunity profile · about 20 seconds. Manual selection works meanwhile.</p>
          </>
        ) : state === "error" ? (
          <div className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-tint px-4 py-3.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-meta font-semibold text-white">!</span>
            <div className="flex-1">
              <p className="m-0 text-body font-medium text-danger-dark">Suggestions aren’t available right now</p>
              <p className="mb-0 mt-1 text-dense leading-normal text-danger-dark">{data.item.suggestionsError ?? "The ranking service timed out."} Your selected recipients and everything else here are unaffected.</p>
              <div className="mt-2.5 flex gap-2"><Button variant="secondary" size={28} className="border-danger-border text-danger-dark" onClick={() => regenerate()}>Try again</Button><button type="button" className="text-dense font-medium text-danger-dark" onClick={() => startTransition(async () => { await setSuggestionsModeAction(data.item.id, "manual"); refresh(); })}>Continue without suggestions</button></div>
            </div>
          </div>
        ) : state === "manual" ? (
          <div className="flex items-center justify-between rounded-card border border-line bg-canvas px-3.5 py-2.5 text-dense text-ink-body">
            <span>Suggestions hidden for this opportunity. You’re working from your own selections.</span>
            <button type="button" className={btnLink} onClick={() => startTransition(async () => { await setSuggestionsModeAction(data.item.id, "ready"); refresh(); })}>Show suggestions</button>
          </div>
        ) : state === "none" ? (
          <div className="rounded-card border border-dashed border-line-control p-6 text-center">
            <p className="m-0 text-body font-semibold text-ink">No suggestions yet</p>
            <p className="mx-auto mb-0 mt-1.5 max-w-[440px] text-dense leading-normal text-ink-muted">Prospera extracts the opportunity profile from the notice, applies its eligibility rules and ranks your directory against it. Nothing is added or sent without you.</p>
            <div className="mt-3"><Button variant="primary" size={32} onClick={() => regenerate()} disabled={pending}>Generate suggestions</Button></div>
          </div>
        ) : none ? (
          <div className="rounded-card border border-dashed border-line-control p-6 text-center">
            <p className="m-0 text-body font-semibold text-ink">No eligible matches in your directory</p>
            <p className="mx-auto mb-0 mt-1.5 max-w-[440px] text-dense leading-normal text-ink-muted">{excluded.length ? `${excluded.length} candidate${excluded.length === 1 ? " was" : "s were"} excluded by the notice’s eligibility rules and nobody else clears the exploratory bar.` : "Nobody clears the exploratory bar."} Check the opportunity profile in case the extraction missed something, or add people to the directory.</p>
            <div className="mt-3 flex justify-center gap-3">{excluded.length ? <button type="button" className={btnLink} onClick={() => setShowExcluded((v) => !v)}>Show who was excluded</button> : null}<button type="button" className={btnLink} onClick={() => { setProfileEdit(true); }}>Edit opportunity profile</button><Link href="/investigators/import" className={btnLink}>Add to directory</Link></div>
          </div>
        ) : allDismissed ? (
          <div className="rounded-card border border-dashed border-line-control p-5 text-center">
            <p className="m-0 text-body font-medium text-ink">You dismissed all {dismissed.length} suggestions</p>
            <p className="mb-0 mt-1 text-dense text-ink-muted">Nothing else in the directory clears the bar. Edit the opportunity profile to try a different angle, or continue with your own picks.</p>
            <div className="mt-3 flex justify-center gap-3"><button type="button" className={btnLink} onClick={() => setShowDismissed(true)}>Show dismissed</button><button type="button" className={btnLink} onClick={() => { setProfileEdit(true); }}>Edit profile</button></div>
          </div>
        ) : (
          <>
            {onlyExploratory ? (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-tile border border-line bg-canvas px-3 py-2 text-dense text-ink-body">
                <span>No strong or potential matches in your directory. {expl.length} exploratory suggestion{expl.length === 1 ? " is" : "s are"} shown; treat them as leads to check, not recommendations.</span>
                <button type="button" className={btnLink} onClick={() => { setProfileEdit(true); }}>Edit profile</button>
              </div>
            ) : null}
            {proposal ? <ProposeCorrectionBanner proposal={{ investigatorId: proposal.investigatorId, name: proposal.name, axisReason: proposal.axisReason, suggestionId: proposal.suggestionId, preview: proposal.preview }} onDone={() => setProposal(null)} className="mb-2" /> : null}
            <div className="mb-1.5 mt-1 flex items-baseline justify-between">
              {/* fit-UX PR 3: under fit-v1 the heading carries no note. Both
                  notes that used to sit here explained the model rather than
                  the decision (§2.2) — "a tier is a set of floors, not a score
                  · evidence coverage is separate", and on the band below,
                  "Leads to check, not recommendations · the first line names
                  the gap". They are the same strings `fit-opportunities.tsx`
                  named as §2.2's fault and dropped from the investigator card,
                  and every row under them now says its own tier, its own
                  evidence verdict and its own gap. The legacy heading keeps
                  its note: a legacy row has no verdicts to say it. */}
              <p className="m-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">{fit ? "Recommended" : "Investigators"} · {fit ? main.length : main.length + (explShown ? expl.length : 0)}</p>
              {fit ? null : <span className="text-meta text-ink-muted">Match tier and evidence coverage are separate: a strong match can rest on limited data.</span>}
            </div>
            {checked.length ? (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-tile bg-navy py-1.5 pl-3.5 pr-1.5 text-white">
                <span className="text-dense font-medium">{checked.length} selected</span>
                <div className="flex gap-1.5">
                  <button type="button" className="h-7 rounded-control bg-white px-2.5 text-dense font-medium text-navy" onClick={() => { const rows = visible.filter((s) => checked.includes(s.id)); add(rows.map((s) => s.investigatorId), rows.map((s) => s.name)); }}>Add to recipients</button>
                  <button type="button" className="h-7 rounded-control border border-white/40 px-2.5 text-dense font-medium text-white" onClick={() => { const rows = visible.filter((s) => checked.includes(s.id)); dismiss(rows.map((s) => s.id), rows.map((s) => s.name), ""); }}>Dismiss</button>
                  <button type="button" aria-label="Clear selection" className="inline-flex h-7 w-7 items-center justify-center text-white" onClick={() => setChecked([])}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg></button>
                </div>
              </div>
            ) : null}
            <div className="rounded-card border border-line">
              {fit && !main.length ? <p className="m-0 px-3.5 py-3 text-dense text-ink-muted">No Strong or Moderate fit in your directory for this notice.</p> : null}
              {visible.map((s, i) => (
                <div key={s.id}>
                  {fit && s.status === "active" && s.tier === "exploratory" && (i === 0 || visible[i - 1]!.tier !== "exploratory" || visible[i - 1]!.status !== "active") ? (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line-row bg-footer-bar px-3.5 py-2 first:border-t-0">
                      <p className="m-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Exploratory · {expl.length}</p>
                    </div>
                  ) : null}
                  {fit && s.status === "dismissed" && (i === 0 || visible[i - 1]!.status !== "dismissed") ? (
                    <div className="flex items-baseline justify-between gap-3 border-t border-line-row bg-footer-bar px-3.5 py-2">
                      <p className="m-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Dismissed · {dismissed.length}</p>
                    </div>
                  ) : null}
                  <SuggestionRow s={s} engine={data.team.fitEngine} checked={checked.includes(s.id)} status={statusOf(s.investigatorId)} open={openRow === s.id} onOpen={() => setOpenRow((o) => (o === s.id ? null : s.id))} onCheck={(v) => setChecked((c) => (v ? [...c, s.id] : c.filter((x) => x !== s.id)))} onAdd={() => add([s.investigatorId], [s.name])} onDismiss={(reason) => dismiss([s.id], [s.name], reason)} onWrongType={() => setWrongTypeFor(s)} onRestore={() => startTransition(async () => { await restoreSuggestionsAction({ itemId: data.item.id, previous: [{ id: s.id, status: "active" }] }); refresh(); })} onEvidence={() => onEvidence(s.id)} />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-4 border-t border-line-row px-3.5 py-2.5">
                {expl.length && !onlyExploratory && !fit ? <button type="button" className="whitespace-nowrap text-dense font-medium text-ink-muted hover:text-ink" onClick={() => setShowExpl((v) => !v)}>{showExpl ? "Hide exploratory" : `Show ${expl.length} exploratory`}</button> : null}
                {excluded.length ? <button type="button" className="whitespace-nowrap text-dense font-medium text-ink-muted hover:text-ink" onClick={() => setShowExcluded((v) => !v)}>{showExcluded ? "Hide" : "Show"} {excluded.length} excluded by eligibility</button> : null}
              </div>
              {showExcluded && excluded.length ? (
                <div className="border-t border-line-row bg-footer-bar px-3.5 py-2.5 text-dense leading-normal text-ink-body">
                  <p className="mb-1 mt-0 font-medium text-ink">Excluded by the notice’s eligibility rules or your options {data.profile.sections?.eligibility ? <Link href={`/opportunities/${data.notice.id}`} className="ml-1 inline-flex h-5 items-center rounded-[5px] border border-line bg-card px-[7px] align-middle text-micro font-medium text-ink-body">{data.profile.sections.eligibility}</Link> : null}</p>
                  <ul className="m-0 pl-4">{excluded.map((s) => <li key={s.id}>{s.name} · {s.excludedReason}</li>)}</ul>
                  <p className="mb-0 mt-1.5 text-meta text-ink-muted">Rules run before ranking, so excluded people never appear as suggestions. If a rule is wrong, edit the Eligibility facet in the opportunity profile.</p>
                </div>
              ) : null}
            </div>
            <p className="mb-0 mt-2 text-meta leading-normal text-ink-muted">Suggestions describe fit, not merit, and come only from people already in your directory. Reasons cite verified items only (affiliation, ORCID or profile ID matched); name-only matches are shown in evidence but never used in reasons or messages. You decide who hears from the office.</p>
          </>
        )}
      </section>

      <ReplyDialog recipient={replyFor} onClose={() => setReplyFor(null)} onDone={() => { setReplyFor(null); refresh(); }} />
      {wrongTypeFor ? <DismissDialog name={wrongTypeFor.name} open onClose={() => setWrongTypeFor(null)} pending={pending} onSubmit={(axisReason) => dismiss([wrongTypeFor.id], [wrongTypeFor.name], "wrong_research_type", axisReason)} /> : null}
      <span className="hidden">{viewer.id}</span>
    </div>
  );
}

/**
 * One community, on the row grammar people use (fit-UX PR 3; README §"Screens
 * / views" 3): name + tier label, one reason line, one caveat line, chips, one
 * action. Not `VerdictRow` — a community is not scored by the fit engine, so
 * it has no approach / eligibility / evidence verdicts and does not pretend to
 * (see `community-row-view.ts`); it shares the grammar, the tokens and the
 * label vocabulary, which is what "the same grammar" asks for.
 */
function CommunityRow({ c, pending, onTag, onDismiss, onRestore, onRemove }: { c: WorkspaceCommunity; pending: boolean; onTag: () => void; onDismiss: () => void; onRestore: () => void; onRemove: () => void }) {
  const state = communityState(c);
  const caveat = communityCaveat(c);
  const chips = communityChips(c);
  const suggested = isSuggested(c) && !c.tagged && !c.dismissed;
  return (
    <div className={cn("grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 border-t border-line-row px-3.5 py-3 first:border-t-0", (c.tier === "inactive" || c.dismissed) && "opacity-60")}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-tint text-navy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></span>
      <div className="min-w-0">
        <p className="m-0">
          <Pill variant={COMMUNITY_LABEL_PILL[c.tier]} className="mr-2 align-[-2px]">{COMMUNITY_LABEL_TEXT[c.tier]}</Pill>
          <span className={TITLE_CLASS}>{c.name}</span>
          {state ? <span className="ml-2 align-[1px] text-meta text-ink-muted">{state}</span> : null}
        </p>
        <p className="mb-0 mt-2 text-body leading-[1.5] text-ink">{c.reason}</p>
        {caveat ? <p className={cn("mb-0 mt-1.5 text-body leading-[1.5]", CAVEAT_TONE[caveat.tone === "ok" ? "quiet" : "caution"])}>{caveat.text}</p> : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {chips.map((ch) => <span key={ch.text} className={cn(CHIP_BASE, CHIP_TONE[ch.tone])}>{ch.text}</span>)}
          {c.evaluatedAt ? <span className={cn(CHIP_BASE, CHIP_TONE.ok)}>Evaluated {fmtMonD(c.evaluatedAt)}</span> : null}
          <Link href={`/communities?community=${c.id}`} className="ml-1 text-meta font-medium text-teal hover:text-navy">Community profile</Link>
        </div>
      </div>
      <div className="flex items-start gap-1.5">
        {!c.tagged && c.tier !== "inactive" && !c.dismissed ? <Button variant="primary" size={28} onClick={onTag} disabled={pending}>Tag</Button> : null}
        {suggested ? <Button variant="secondary" size={28} onClick={onDismiss} disabled={pending}>Dismiss</Button> : null}
        {c.tagged ? <Button variant="secondary" size={28} onClick={onRemove} disabled={pending}>Remove</Button> : null}
        {c.dismissed ? <Button variant="secondary" size={28} onClick={onRestore} disabled={pending}>Restore</Button> : null}
        {c.tier === "cant_evaluate" && !c.tagged ? <Link href={`/communities?community=${c.id}`} className="inline-flex h-7 items-center whitespace-nowrap rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink">Complete profile</Link> : null}
      </div>
    </div>
  );
}

/** A monitored community that is not a match, collapsed to one line (README §"Screens / views" 3). Its reason is a click away; its state and its one action are not. */
function CommunityLine({ c, pending, onTag, onRestore }: { c: WorkspaceCommunity; pending: boolean; onTag: () => void; onRestore: () => void }) {
  const state = communityState(c);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line-row px-3.5 py-2 opacity-70">
      <p className="m-0 min-w-0 truncate text-dense text-ink-body">
        <span className="font-medium text-ink">{c.name}</span>
        <span className="text-ink-muted"> · {state ?? COMMUNITY_LABEL_TEXT[c.tier]}</span>
      </p>
      <div className="flex shrink-0 items-center gap-3.5">
        {c.dismissed ? <button type="button" className={btnLink} onClick={onRestore} disabled={pending}>Restore</button> : c.tier !== "inactive" ? <button type="button" className={btnLink} onClick={onTag} disabled={pending}>Tag</button> : null}
        <Link href={`/communities?community=${c.id}`} className={btnLink}>Profile →</Link>
      </div>
    </div>
  );
}

/**
 * One suggested person (fit-UX PR 3). Under **fit-v1** this is `VerdictRow` —
 * the same component, the same four slots and the same three chips as the
 * investigator page and the opportunity aside, with `subject="person"` so the
 * right-hand column is captioned Status. Under **legacy** the pre-redesign row
 * is unchanged: there are no verdicts to render without a `fit_results` row.
 *
 * The action cluster is this surface's, through `VerdictRow`'s `actions` slot:
 * Add, Dismiss and the menu of dismissal reasons (including the wrong-type
 * dismissal that proposes a profile correction), or Restore on a dismissed
 * row. `verdicts.action`'s single verb cannot express that, and losing it
 * would lose behaviour the tab is built on.
 *
 * Two things move rather than disappear: the snapshot's amber **flag line**
 * (identity unverified, sources conflict, stale profile, limited data) becomes
 * the first bullets of the disclosure under "Worth checking before you
 * contact" — none of them is disqualifying, and the fit model states the
 * disqualifying versions itself on the eligibility and evidence chips — and
 * "Why this suggestion →" becomes the disclosure's "All evidence and
 * components →", which opens the same `EvidenceView` it always did.
 */
function SuggestionRow({ s, engine, checked, status, open, onOpen, onCheck, onAdd, onDismiss, onWrongType, onRestore, onEvidence }: { s: WorkspaceSuggestion; engine: FitEngine; checked: boolean; status: DueField | null; open: boolean; onOpen: () => void; onCheck: (v: boolean) => void; onAdd: () => void; onDismiss: (reason: DismissReason) => void; onWrongType: () => void; onRestore: () => void; onEvidence: () => void }) {
  const dismissed = s.status === "dismissed";
  const fit = engine === "fit-v1";
  const rationale = fit ? snapshotRationale(s) : null;
  const options = dismissReasonOptions(engine);
  const actions = (
    <div className="flex items-start gap-1.5">
      {dismissed ? (
        <Button variant="secondary" size={28} onClick={onRestore}>Restore</Button>
      ) : (
        <>
          <Button variant="primary" size={28} onClick={onAdd}>Add</Button>
          <Button variant="secondary" size={28} onClick={() => onDismiss("")}>Dismiss</Button>
          <Menu label={`More options for ${s.name}`} align="end" width={fit ? 260 : 230} trigger={({ toggle, triggerProps }) => <button type="button" onClick={toggle} {...triggerProps} aria-label="More options" className="inline-flex h-7 w-7 items-center justify-center rounded-control border border-line-control bg-card text-ink-muted"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></button>}>
            <MenuLabel>Dismiss because…</MenuLabel>
            {options.filter((o) => !o.destructive).map((o) => (
              <MenuItem key={o.id} onSelect={() => (o.axis ? onWrongType() : onDismiss(o.id))}>{o.label}</MenuItem>
            ))}
            <MenuSeparator />
            {options.filter((o) => o.destructive).map((o) => (
              <MenuItem key={o.id} tone="destructive" onSelect={() => onDismiss(o.id)}>{o.label}</MenuItem>
            ))}
          </Menu>
        </>
      )}
    </div>
  );

  if (fit && s.fit) {
    const meta = [s.dept, s.rank, s.isNew ? "New to you" : null, dismissed && s.dismissedReason ? `dismissed · ${dismissReasonLabel(s.dismissedReason, s.axisReason)}` : null].filter(Boolean).join(" · ");
    // The snapshot's own warnings first, then what the engine and the notice
    // say. None of them is a block — an eligibility failure reaches the row on
    // the chip and in the caveat — and each is exactly "worth checking before
    // you contact": an unverified identity, a stale profile, a contact history.
    const checks = suggestionChecks(s);
    // Two lists, never one. Concatenating these onto the engine's own sentences
    // and taking the first five dropped every one of them on a row with three
    // flags, and drew what survived under a heading chosen from the label —
    // "Why it is ruled out" over "Identity unverified: name-only match", which
    // is not why it was ruled out. `disclosureSections` heads each group.
    const disclosure = {
      why: s.fit.disclosure.why,
      gaps: s.fit.disclosure.gaps,
      checks,
      items: rationale?.evidence.length
        ? rationale.evidence.map((it) => ({ id: it.id, title: it.heading, meta: it.sub, source: it.link?.label ?? null, href: it.link?.href ?? null }))
        : s.fit.disclosure.items,
    };
    return (
      <VerdictRow
        id={s.id}
        verdicts={s.fit.verdicts}
        title={s.name}
        href={`/investigators/${s.investigatorId}`}
        meta={meta || null}
        due={status ?? undefined}
        subject="person"
        selectable={!dismissed}
        selected={checked}
        onSelect={dismissed ? undefined : () => onCheck(!checked)}
        open={open}
        onToggle={onOpen}
        disclosure={disclosure}
        onDeep={onEvidence}
        onFlag={onWrongType}
        flagLabel={WRONG_TYPE_LABEL}
        actions={actions}
        className={cn(dismissed && "opacity-[0.55]")}
      />
    );
  }

  return (
    <div className={cn("grid grid-cols-[16px_28px_minmax(0,1fr)_auto] items-start gap-3 border-t border-line-row px-3.5 py-3 first:border-t-0", dismissed && "opacity-[0.55]", checked && "bg-teal-tint/30")}>
      <Checkbox checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${s.name}`} className="mt-1.5" disabled={dismissed} />
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-tint text-[11px] font-semibold text-teal">{s.initials}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 whitespace-nowrap text-body font-medium text-ink">{s.name}</p>
          <span className="text-meta text-ink-muted">{s.dept}</span>
          <TierPill tier={s.tier} engine={engine} />
          {s.isNew ? <span className="inline-flex h-5 items-center whitespace-nowrap rounded-full border border-dashed border-teal px-[7px] text-micro font-medium text-teal">New to you</span> : null}
          {dismissed && s.dismissedReason ? <span className="text-meta text-ink-muted">dismissed · {dismissReasonLabel(s.dismissedReason, s.axisReason)}</span> : null}
        </div>
        <ul className="mb-0 mt-1.5 flex flex-col gap-0.5 pl-4 text-dense leading-normal text-ink">
          {orderedReasons(s, engine).map((r, i) => (
            <li key={i}>{r.text} <span title={r.title} className="inline-flex h-5 items-center whitespace-nowrap rounded-[5px] border border-line bg-card px-[7px] align-middle text-micro font-medium text-ink-body hover:border-teal hover:text-teal">{r.source}</span></li>
          ))}
        </ul>
        {s.flags.length ? <p className="mb-0 mt-1.5 flex flex-wrap items-center gap-1.5 text-meta text-warning"><span aria-hidden className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-warning" />{s.flags.map((f) => f.text.split(":")[0]).join(" · ")}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-3.5">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-meta text-ink-muted" title={COVERAGE_HELP[s.coverage]}><EvidenceDots coverage={s.coverage} />Evidence: {s.coverage}</span>
          <span className={cn("whitespace-nowrap text-meta", s.freshWarn ? "text-warning" : "text-ink-muted")}>{s.freshLine}</span>
          {s.historyLine ? <span className={cn("text-meta", s.historyKind === "good" ? "text-success" : "text-warning")}>{s.historyLine}</span> : null}
        </div>
        <button type="button" onClick={onEvidence} className="mt-1.5 text-meta font-medium text-teal hover:text-navy">Why this suggestion →</button>
      </div>
      {actions}
    </div>
  );
}

function ReplyDialog({ recipient, onClose, onDone }: { recipient: WorkspaceRecipient | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"replied_interested" | "replied_maybe" | "replied_not_now" | "declined">("replied_interested");
  const [note, setNote] = useState("");
  return (
    <Dialog open={Boolean(recipient)} onClose={onClose} title="Record a reply" description={recipient ? `${recipient.name} replied outside Prospera (email, hallway, call).` : undefined} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => startTransition(async () => { if (!recipient) return; const r = await recordReplyAction({ recipientId: recipient.id, kind, note }); if (!r.ok) return toast({ message: r.error, tone: "error" }); toast({ message: `Recorded · ${recipient.name} replied ${kind === "replied_interested" ? "Interested" : kind === "replied_maybe" ? "Maybe" : kind === "replied_not_now" ? "Not now" : "Declined"}` }); onDone(); })}>{pending ? "Saving…" : "Record reply"}</Button></>}>
      <div className="flex flex-col gap-3 py-2">
        <Field label="Reply" labelSize={12}>{({ id }) => <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-full"><option value="replied_interested">Interested</option><option value="replied_maybe">Maybe</option><option value="replied_not_now">Not this cycle</option><option value="declined">Declined</option></Select>}</Field>
        <Field label="What they said (optional)" labelSize={12}>{({ id }) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" />}</Field>
      </div>
    </Dialog>
  );
}
