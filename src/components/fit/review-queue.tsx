"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideCorrection, markPairReviewed } from "@/app/actions/fit-review-actions";
import { SectionCard } from "@/components/fit/inspector-ui";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { fmtMonDYear } from "@/lib/investigators/sources";
import type { CorrectionItem, LeadItem, ReviewQueue, ReviewSection } from "@/lib/fit/review/queue";
import { FIT_TIER_LABEL } from "@/lib/fit/tier-display";
import { suggestionTierOf } from "@/lib/fit/results";
import type { Tier } from "@/lib/fit/types";

/**
 * `/team/fit-review` (plan § PR 3.3). Four sections, each an item list with
 * the decision on the right: approve / reject for a correction, "mark
 * reviewed" for a lead or a dissent. Everything the sections show is built by
 * the pure `queueView`; this file is layout plus the two server actions.
 */

const tierLabel = (t: Tier | null | undefined): string => {
  if (!t) return "—";
  const s = suggestionTierOf(t);
  return s ? FIT_TIER_LABEL[s] : "Poor";
};

function ReJudging() {
  return (
    <span className="inline-flex h-[22px] items-center rounded-full border border-dashed border-line-control px-2 text-meta font-medium text-ink-muted" title="A correction on this profile was approved: the pair reverted to the engine's tier and is queued for the nightly judge.">
      re-judging
    </span>
  );
}

function Feedback({ error, note }: { error: string | null; note: string | null }) {
  if (error) return <p className="m-0 text-meta text-danger">{error}</p>;
  if (note) return <p className="m-0 text-meta text-success">{note}</p>;
  return null;
}

// ---------------------------------------------------------------------------
// Leads and dissents
// ---------------------------------------------------------------------------

function LeadRow({ item }: { item: LeadItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const mark = () => {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const r = await markPairReviewed({ investigatorId: item.pair.investigator_id, opportunityId: item.pair.opportunity_id });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNote(r.rows ? "Marked reviewed." : "Nothing to mark: this pair has no stored adjudication row.");
      router.refresh();
    });
  };

  return (
    <li className="flex flex-col gap-1.5 border-b border-line-row px-5 py-3.5 text-dense last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="m-0 font-medium text-ink">
            <Link href={item.pair.investigatorHref} className="text-ink hover:text-teal">
              {item.pair.investigator}
            </Link>
            <span className="text-ink-muted"> × </span>
            <Link href={item.pair.noticeHref} className="text-ink hover:text-teal">
              {item.pair.notice}
            </Link>
          </p>
          <p className="m-0 text-meta text-ink-muted">
            shown {tierLabel(item.tier)}
            {item.engineTier ? ` · engine ${tierLabel(item.engineTier)}` : ""}
            {item.blindVerdict ? ` · blind ${tierLabel(item.blindVerdict)}` : ""}
            {item.confidence ? ` · ${item.confidence.replace(/_/g, " ")}` : ""}
            {item.judgedAt ? ` · judged ${fmtMonDYear(item.judgedAt)}` : ""} · score {item.score.toFixed(0)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.reJudging ? <ReJudging /> : null}
          <Button type="button" variant="secondary" size={28} onClick={mark} disabled={pending}>
            {pending ? "Marking…" : "Mark reviewed"}
          </Button>
        </div>
      </div>
      {item.note ? <p className="m-0 text-meta leading-normal text-ink-body">{item.note}</p> : null}
      {item.rationale ? <p className="m-0 text-meta leading-normal text-ink-muted">{item.rationale}</p> : null}
      <p className="m-0 text-micro text-ink-muted">
        <Link href={item.pair.investigatorInspectorHref} className="text-teal hover:text-navy">
          Profile inspector →
        </Link>
        <span> · </span>
        <Link href={item.pair.noticeInspectorHref} className="text-teal hover:text-navy">
          Notice inspector →
        </Link>
      </p>
      <Feedback error={error} note={note} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

function CorrectionRowItem({ item }: { item: CorrectionItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const decide = (decision: "approve" | "reject") => {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const r = await decideCorrection({ ids: item.ids, decision });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNote(r.message);
      router.refresh();
    });
  };

  const scope =
    item.target === "opportunity_profile"
      ? item.rescoreInvestigators === null
        ? "Approving re-scores every investigator against this notice."
        : `Approving re-scores ${item.rescoreInvestigators} investigator${item.rescoreInvestigators === 1 ? "" : "s"} against this notice${item.rescoreSynchronous ? " — now" : " — in tonight's fit-results run"}.`
      : "Approving patches the stored fit profile and re-scores this investigator's pairs.";

  return (
    <li className="flex flex-col gap-1.5 border-b border-line-row px-5 py-3.5 text-dense last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="m-0 font-medium text-ink">
            {item.title}
            <span className="text-ink-muted"> on </span>
            <Link href={item.subjectHref} className="text-ink hover:text-teal">
              {item.subject}
            </Link>
          </p>
          <ul className="m-0 mt-0.5 flex list-none flex-col gap-0.5 p-0">
            {item.edits.map((e) => (
              <li key={e.id} className="text-meta text-ink-body">
                <span className="text-ink-muted">{e.pathLabel}: </span>
                <span className="font-mono">
                  {e.from} → {e.to}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.reJudging ? <ReJudging /> : null}
          <Pill variant="status-needs-review">Proposed</Pill>
          <Button type="button" variant="secondary" size={28} onClick={() => decide("reject")} disabled={pending}>
            Reject
          </Button>
          <Button type="button" size={28} onClick={() => decide("approve")} disabled={pending}>
            {pending ? "Working…" : "Approve"}
          </Button>
        </div>
      </div>
      <p className="m-0 text-meta leading-normal text-ink-body">
        <span className="text-ink-muted">Rests on: </span>
        {item.evidenceLine}
      </p>
      <p className="m-0 text-micro text-ink-muted">
        {item.kind.replace(/_/g, " ")} · proposed by {item.proposedBy === "judge" ? "the AI judge" : `a${item.proposedBy === "investigator" ? "n" : ""} ${item.proposedBy}`} · {fmtMonDYear(item.createdAt)} · {scope}{" "}
        <Link href={item.inspectorHref} className="text-teal hover:text-navy">
          Inspector →
        </Link>
      </p>
      <Feedback error={error} note={note} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Section<Item>({ section, empty, render }: { section: ReviewSection<Item>; empty: string; render: (item: Item) => React.ReactNode }) {
  return (
    <SectionCard title={`${section.title} (${section.count})`} aside={section.reviewed ? `${section.reviewed} marked reviewed` : undefined}>
      <p className="mb-0 mt-0 border-b border-line-row px-5 py-2 text-meta text-ink-muted">{section.blurb}</p>
      {section.items.length === 0 ? <p className="m-0 px-5 py-4 text-dense text-ink-muted">{empty}</p> : <ul className="m-0 flex list-none flex-col p-0">{section.items.map((item) => render(item))}</ul>}
    </SectionCard>
  );
}

export function ReviewQueueScreen({ queue, available, reviewStateAvailable, error, migrations }: { queue: ReviewQueue; available: boolean; reviewStateAvailable: boolean; error: string | null; migrations: { corrections: string; reviewState: string } }) {
  if (!available) {
    return (
      <EmptyState
        title="The fit engine's tables are not on the database yet"
        description={
          <>
            Apply <code className="font-mono text-meta">{migrations.corrections}</code> (and this PR&apos;s <code className="font-mono text-meta">{migrations.reviewState}</code>) and let the nightly <code className="font-mono text-meta">fit-judge</code> run; the queue fills from what it proposes.
          </>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="m-0 text-dense text-danger">Could not read the queue: {error}</p> : null}
      {!reviewStateAvailable ? (
        <p className="m-0 rounded-card border border-line-control bg-canvas px-4 py-2.5 text-meta text-ink-body">
          “Mark reviewed” needs <code className="font-mono text-micro">{migrations.reviewState}</code>; until it is applied, leads and dissents stay in the queue.
        </p>
      ) : null}
      {queue.reJudging ? <p className="m-0 text-meta text-ink-muted">{queue.reJudging} profile{queue.reJudging === 1 ? "" : "s"} are queued for re-judging or re-scoring after an approval; the nightly jobs take them first.</p> : null}
      <Section section={queue.leads} empty="No leads waiting. The judge raises one when it sees a fit the structure did not and cannot express it as a correction." render={(item) => <LeadRow key={item.key} item={item} />} />
      <Section section={queue.noticeCorrections} empty="No notice corrections waiting." render={(item) => <CorrectionRowItem key={item.key} item={item} />} />
      <Section section={queue.dissents} empty="No ungrounded dissents waiting." render={(item) => <LeadRow key={item.key} item={item} />} />
      <Section section={queue.profileCorrections} empty="No profile-weight corrections waiting. They arrive from the judge and from “wrong type of research” dismissals." render={(item) => <CorrectionRowItem key={item.key} item={item} />} />
    </div>
  );
}
