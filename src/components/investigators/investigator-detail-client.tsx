"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  recordBiosketchAction,
  refreshSourcesAction,
  restoreBiosketchAction,
  reviewIdentityAction,
  revokeBiosketchAction,
  undoIdentityReviewAction,
  updateIdentifiersAction,
  type IdentityPrevious,
} from "@/app/actions/investigator-actions";
import { BiosketchRequestDialog, IdentifierDialog, type BiosketchRequestKind, type IdentifierKind } from "@/components/investigators/investigator-dialogs";
import { InvestigatorFormSheet, type InvestigatorFormValues } from "@/components/investigators/investigator-form-sheet";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { CommunityOption } from "@/lib/investigators/directory";
import type { IdentityMethod, IdentityStatus, InvestigatorSourceRow } from "@/lib/investigators/sources";
import { fmtMonD, fmtMonDYear, fmtMonYear, IDENTITY_METHOD_LABEL } from "@/lib/investigators/sources";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Header actions: Refresh sources · Edit · Add to outreach
// ---------------------------------------------------------------------------

export function DetailHeaderActions({ investigatorId, fullName, communities, formInitial }: { investigatorId: string; fullName: string; communities: CommunityOption[]; formInitial: InvestigatorFormValues }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(params.get("edit") === "1");
  useEffect(() => {
    if (params.get("edit") === "1") setEditOpen(true);
  }, [params]);

  const refresh = () =>
    startTransition(async () => {
      const r = await refreshSourcesAction(investigatorId, "all");
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: `${fullName}: ${r.summary}` });
      router.refresh();
    });

  const closeEdit = () => {
    setEditOpen(false);
    if (params.get("edit") === "1") router.replace(`/investigators/${investigatorId}`);
  };

  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={refresh} disabled={pending}>{pending ? "Refreshing…" : "Refresh sources"}</Button>
      <Button variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
      <Link href="/outreach" title="The Outreach workspace arrives in step 5" className="inline-flex h-9 items-center rounded-control border border-navy bg-navy px-3.5 text-body font-medium text-white hover:bg-navy-hover">
        Add to outreach
      </Link>
      <InvestigatorFormSheet
        open={editOpen}
        onClose={closeEdit}
        communities={communities}
        initial={formInitial}
        onSaved={() => {
          closeEdit();
          router.refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Publications with identity review
// ---------------------------------------------------------------------------

export type PublicationView = {
  id: string;
  pmid: string;
  title: string;
  meta: string;
  identity_method: IdentityMethod;
  identity_status: IdentityStatus;
  reviewed_at: string | null;
};

export function PublicationsList({ investigatorId, verified, unverified, reviewMode }: { investigatorId: string; verified: PublicationView[]; unverified: PublicationView[]; reviewMode: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const decide = (p: PublicationView, decision: "confirm" | "reject") => {
    setBusy(p.id);
    startTransition(async () => {
      const r = await reviewIdentityAction({ investigatorId, kind: "publication", itemId: p.id, decision });
      setBusy(null);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
      const previous: IdentityPrevious = r.previous;
      toast({
        message: decision === "confirm" ? `Confirmed “${p.title.slice(0, 60)}${p.title.length > 60 ? "…" : ""}” as this person` : `Marked as not this person`,
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              const u = await undoIdentityReviewAction({ investigatorId, kind: "publication", itemId: p.id, previous });
              if (!u.ok) return toast({ message: u.error, tone: "error" });
              router.refresh();
            }),
        },
      });
    });
  };

  const Row = ({ p, actions }: { p: PublicationView; actions: React.ReactNode }) => (
    <li className="flex items-start justify-between gap-4 border-t border-line-row px-5 py-3">
      <div className="min-w-0">
        <a href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`} target="_blank" rel="noreferrer" className="text-body font-medium text-ink hover:text-teal">{p.title}</a>
        <p className="mb-0 mt-0.5 text-meta text-ink-muted">{p.meta}</p>
      </div>
      {actions ? <div className="flex shrink-0 gap-1.5">{actions}</div> : null}
    </li>
  );

  return (
    <ul className="m-0 list-none p-0">
      {verified.length === 0 && unverified.length === 0 ? <li className="border-t border-line-row px-5 py-4 text-dense text-ink-muted">No publications cached yet. Fetch PubMed from the Data sources panel.</li> : null}
      {verified.map((p) => (
        <Row
          key={p.id}
          p={p}
          actions={
            reviewMode && p.identity_method !== "manual" ? (
              <Button variant="secondary" size={28} disabled={busy === p.id} onClick={() => decide(p, "reject")}>Not this person</Button>
            ) : null
          }
        />
      ))}
      {unverified.length ? (
        <li className="border-t border-line-row bg-warning-tint/40 px-5 py-2 text-meta font-medium text-warning">
          {unverified.length} name-only match{unverified.length === 1 ? "" : "es"} · not used in fit tiers until confirmed
        </li>
      ) : null}
      {unverified.map((p) => (
        <Row
          key={p.id}
          p={p}
          actions={
            <>
              <Button variant="secondary" size={28} disabled={busy === p.id} onClick={() => decide(p, "confirm")}>Confirm</Button>
              <Button variant="secondary" size={28} disabled={busy === p.id} onClick={() => decide(p, "reject")}>Not this person</Button>
            </>
          }
        />
      ))}
    </ul>
  );
}

export function ReviewModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="text-teal hover:text-navy">
      {active ? "Done flagging" : "Flag a wrong match"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Data sources panel: rows, RePORTER ID, biosketch actions
// ---------------------------------------------------------------------------

export type DataSourceRowView = { label: string; value: string; muted?: boolean };

export function DataSourcesPanel({
  investigatorId,
  fullName,
  email,
  nihProfileId,
  rows,
  biosketch,
  onReviewToggle,
  reviewActive,
}: {
  investigatorId: string;
  fullName: string;
  email: string | null;
  nihProfileId: string | null;
  rows: DataSourceRowView[];
  biosketch: InvestigatorSourceRow;
  onReviewToggle: () => void;
  reviewActive: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [profileId, setProfileId] = useState(nihProfileId ?? "");
  const [identifier, setIdentifier] = useState<IdentifierKind | null>(null);
  const [request, setRequest] = useState<BiosketchRequestKind | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  useEffect(() => setProfileId(nihProfileId ?? ""), [nihProfileId]);

  const saveProfileId = () =>
    startTransition(async () => {
      const r = await updateIdentifiersAction(investigatorId, { nihProfileId: profileId }, { refresh: profileId.trim() ? ["reporter"] : [] });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: r.summary ? `Saved. ${r.summary}` : "Profile ID cleared; cached projects removed." });
      router.refresh();
    });

  const revoke = () =>
    startTransition(async () => {
      const r = await revokeBiosketchAction(investigatorId);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
      toast({
        message: "Biosketch authorization withdrawn",
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              const u = await restoreBiosketchAction(investigatorId, r.snapshot);
              if (!u.ok) return toast({ message: u.error, tone: "error" });
              router.refresh();
            }),
        },
      });
    });

  const bio = biosketch;
  const bioLine = (() => {
    switch (bio.state) {
      case "on_file":
        return `${bio.document_date ? fmtMonYear(bio.document_date) : "on file"}${bio.authorized_at ? ` · authorized ${fmtMonD(bio.authorized_at)}` : ""}`;
      case "requested":
        return `requested ${bio.reminder_sent_at ? fmtMonD(bio.reminder_sent_at) : bio.requested_at ? fmtMonD(bio.requested_at) : ""} · no reply yet`;
      case "declined":
        return `declined${bio.declined_at ? ` ${fmtMonYear(bio.declined_at)}` : ""}`;
      case "revoked":
        return `withdrawn${bio.revoked_at ? ` ${fmtMonDYear(bio.revoked_at)}` : ""}`;
      default:
        return email ? "not requested" : "not requested · no email";
    }
  })();

  return (
    <section className="flex flex-col gap-2.5 rounded-card border border-line bg-card px-5 py-4">
      <h2 className="m-0 text-[15px] font-semibold text-ink">Data sources</h2>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-3 text-dense">
          <span className="text-ink">{r.label}</span>
          <span className={cn("text-right", r.muted === false ? "text-ink" : "text-ink-muted")}>{r.value}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 text-dense">
        <span className="text-ink">Biosketch</span>
        <span className="text-right text-ink-muted">{bioLine}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {bio.state === "on_file" ? (
          <>
            <Button variant="secondary" size={28} onClick={() => setRequest("update")} disabled={!email || pending}>Request update</Button>
            <Button variant="secondary" size={28} onClick={revoke} disabled={pending}>Withdraw</Button>
          </>
        ) : bio.state === "requested" ? (
          <>
            <Button variant="secondary" size={28} onClick={() => setRequest("reminder")} disabled={!email || pending}>Send reminder</Button>
            <Button variant="secondary" size={28} onClick={() => setRecordOpen(true)}>Record a biosketch</Button>
          </>
        ) : bio.state === "declined" ? (
          <Button variant="secondary" size={28} onClick={() => setRecordOpen(true)}>Record a biosketch</Button>
        ) : (
          <>
            {email ? (
              <Button variant="secondary" size={28} onClick={() => setRequest("request")} disabled={pending}>Request biosketch</Button>
            ) : (
              <Button variant="secondary" size={28} onClick={() => setIdentifier("add_email")}>Add email</Button>
            )}
            <Button variant="secondary" size={28} onClick={() => setRecordOpen(true)}>Record a biosketch</Button>
          </>
        )}
      </div>
      <p className="mb-0 mt-1 text-meta leading-normal text-ink-muted">
        Confidence reflects how each source was matched. <ReviewModeToggle active={reviewActive} onToggle={onReviewToggle} />
      </p>
      <div className="border-t border-line-row pt-2.5">
        <label htmlFor="reporter-profile-id" className="mb-1.5 block text-meta font-medium text-ink-body">RePORTER profile ID</label>
        <div className="flex gap-2">
          <Input id="reporter-profile-id" size={32} value={profileId} onChange={(e) => setProfileId(e.target.value)} inputMode="numeric" placeholder="e.g. 8033726" className="flex-1 font-mono text-meta" />
          <Button variant="secondary" size={32} onClick={saveProfileId} disabled={pending || profileId.trim() === (nihProfileId ?? "")}>Save</Button>
        </div>
      </div>

      <IdentifierDialog kind={identifier} investigatorId={investigatorId} investigatorName={fullName} initialValue={identifier === "add_email" ? email : ""} onClose={() => setIdentifier(null)} onSaved={() => { setIdentifier(null); router.refresh(); }} />
      <BiosketchRequestDialog kind={request} investigatorId={investigatorId} investigatorName={fullName} email={email} onClose={() => setRequest(null)} onSent={() => { setRequest(null); router.refresh(); }} />
      <RecordBiosketchDialog open={recordOpen} investigatorId={investigatorId} investigatorName={fullName} onClose={() => setRecordOpen(false)} onSaved={() => { setRecordOpen(false); router.refresh(); }} />
    </section>
  );
}

function RecordBiosketchDialog({ open, investigatorId, investigatorName, onClose, onSaved }: { open: boolean; investigatorId: string; investigatorName: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const lastName = investigatorName.trim().split(/\s+/).slice(-1)[0] ?? "";
  return (
    <Dialog open={open} onClose={onClose} title="Record a biosketch" description={`${investigatorName} sent it to you directly. Note who authorized its use and when.`} width={520}>
      <form
        className="flex flex-col gap-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("investigatorId", investigatorId);
          startTransition(async () => {
            setError(null);
            const r = await recordBiosketchAction(fd);
            if (!r.ok) return setError(r.error);
            toast({ message: `Biosketch recorded for ${investigatorName}.` });
            onSaved();
          });
        }}
      >
        <Field label="PDF (optional)" labelSize={12}>{({ id }) => <input id={id} name="file" type="file" accept="application/pdf,.pdf" className="block w-full text-dense file:mr-3 file:h-8 file:rounded-control file:border file:border-line-control file:bg-card file:px-3 file:text-dense file:font-medium file:text-ink" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Document written in" labelSize={12}>{({ id }) => <Input id={id} name="documentDate" type="month" required size={32} />}</Field>
          <Field label="Written for" labelSize={12}>{({ id }) => <Input id={id} name="writtenFor" placeholder="an R01 renewal" size={32} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Authorized by" labelSize={12}>{({ id }) => <Input id={id} name="authorizedBy" defaultValue={lastName ? `Dr. ${lastName}` : ""} required size={32} />}</Field>
          <Field label="Authorized on" labelSize={12}>{({ id }) => <Input id={id} name="authorizedAt" type="date" required size={32} />}</Field>
        </div>
        <Field label="Personal statement (optional)" labelSize={12} help="One or two sentences in their words; shown as evidence.">{({ id }) => <Textarea id={id} name="personalStatement" className="min-h-[72px]" />}</Field>
        <Field label="Contributions to science (optional)" labelSize={12} help="One per line, e.g. “Treg tissue residency — …”">{({ id }) => <Textarea id={id} name="contributions" className="min-h-[72px]" />}</Field>
        {error ? <p className="m-0 text-meta text-danger" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save biosketch"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Wires the review toggle in the Data sources panel to the publications list. */
export function DetailEvidence({ publications, dataSources }: { publications: (reviewMode: boolean) => React.ReactNode; dataSources: (toggle: () => void, active: boolean) => React.ReactNode }) {
  const [reviewMode, setReviewMode] = useState(false);
  return (
    <>
      {publications(reviewMode)}
      {dataSources(() => setReviewMode((v) => !v), reviewMode)}
    </>
  );
}

export { IDENTITY_METHOD_LABEL };
