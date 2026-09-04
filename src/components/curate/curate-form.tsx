"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteOverlayAction, deleteCuratedAction, restoreCuratedAction, restoreOverlayAction, saveCuratedAction, saveOverlayAction, searchCatalogAction, unpublishCuratedAction, unpublishOverlayAction, type CuratedInput, type OverlayInput } from "@/app/actions/curate-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { CuratedRecord, NoticeSummary, OverlayRecord } from "@/lib/institution/curated";
import { REVIEW_PROCESSES, SOURCE_KINDS, derivedStatus, ptDate, type SourceKind } from "@/lib/institution/types";
import { cn } from "@/lib/utils/cn";

type Kind = "internal" | "limited";

export type CurateFormProps = {
  kind: Kind;
  today: string;
  viewer: { name: string };
  /** Editing an existing internal record. */
  record: CuratedRecord | null;
  /** Editing an existing overlay (with its notice or curated non-federal notice). */
  overlay: { overlay: OverlayRecord; notice: NoticeSummary | null; curated: CuratedRecord | null } | null;
  /** Pre-selected synced notice when arriving from a notice page. */
  preselected: NoticeSummary | null;
};

const inputCls = "w-full";
const monoCls = "font-mono text-[13px]";

function SectionCard({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="m-0 text-section font-semibold uppercase text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function CurateForm(props: CurateFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const kind = props.kind;
  const isInternal = kind === "internal";
  const existingStatus = props.record?.status ?? props.overlay?.overlay.status ?? "draft";
  const [status, setStatus] = useState<"draft" | "published">(existingStatus);
  const [id, setId] = useState<string | null>(props.record?.id ?? props.overlay?.overlay.id ?? null);

  // Internal fields
  const r = props.record;
  const [title, setTitle] = useState(r?.title ?? "");
  const [funder, setFunder] = useState(r?.funder ?? "");
  const [award, setAward] = useState(r?.award_summary ?? "");
  const [due, setDue] = useState(r?.application_due ?? "");
  const [loi, setLoi] = useState(r?.loi_due ?? "");
  const [eligibility, setEligibility] = useState(r?.eligibility ?? "");
  const [reviewProcess, setReviewProcess] = useState<string>(r?.review_process ?? "committee_scored");
  const [contact, setContact] = useState(r ? [r.contact_name, r.contact_email].filter(Boolean).join(" · ") : "");
  const [programUrl, setProgramUrl] = useState(r?.program_url ?? "");

  // Limited fields
  const o = props.overlay?.overlay ?? null;
  const [notice, setNotice] = useState<NoticeSummary | null>(props.overlay?.notice ?? props.preselected ?? null);
  const [nonfederal, setNonfederal] = useState<boolean>(Boolean(props.overlay?.curated));
  const [nfTitle, setNfTitle] = useState(props.overlay?.curated?.title ?? "");
  const [nfFunder, setNfFunder] = useState(props.overlay?.curated?.funder ?? "");
  const [nfDue, setNfDue] = useState(props.overlay?.curated?.application_due ?? "");
  const [nfNumber, setNfNumber] = useState(props.overlay?.curated?.sponsor_notice_number ?? "");
  const [nfUrl, setNfUrl] = useState(props.overlay?.curated?.program_url ?? "");
  const [internalDue, setInternalDue] = useState(o?.internal_due ?? "");
  const [cap, setCap] = useState<string>(o?.cap != null ? String(o.cap) : "1");
  const [nominated, setNominated] = useState<string>(o ? String(o.nominated_count) : "0");
  const [process, setProcess] = useState(o?.process ?? "");
  const [infoready, setInfoready] = useState(o?.infoready_url ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoticeSummary[]>([]);
  const [searching, setSearching] = useState(false);

  // Provenance
  const prov = (r ?? o) as { source_kind: SourceKind | null; source_url: string | null; review_by: string | null; verified_by_name: string | null; verified_at: string | null } | null;
  const [sourceKind, setSourceKind] = useState<SourceKind>(prov?.source_kind ?? (isInternal ? "program_office" : "infoready"));
  const [sourceUrl, setSourceUrl] = useState(prov?.source_url ?? "");
  const [reviewBy, setReviewBy] = useState(prov?.review_by ?? "");
  const [error, setError] = useState<string | null>(null);
  const [verifiedNow, setVerifiedNow] = useState(false);

  // Default review-by: the day after the deadline (design: 2027-02-16 for a Feb 15 due).
  useEffect(() => {
    if (reviewBy) return;
    const base = isInternal ? due : internalDue;
    if (!base) return;
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    setReviewBy(d.toISOString().slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, internalDue]);

  // Catalog search (debounced).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isInternal || notice || nonfederal) return;
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const res = await searchCatalogAction({ q: query });
      setSearching(false);
      setResults(res.ok ? res.notices : []);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, isInternal, notice, nonfederal]);

  const derived = derivedStatus({ status, review_by: reviewBy || null, application_due: isInternal ? due || null : null }, props.today);
  const published = status === "published";
  const scopeName = isInternal ? "Internal (UCSF)" : "Limited submissions";
  const interestLine = o ? `${o.nominated_count} of ${o.cap ?? "—"} · ${o.interest_count} expression${o.interest_count === 1 ? "" : "s"} of interest` : "0 of 1 · 0 expressions of interest";

  const buildInternal = (): CuratedInput => {
    const [cName, cEmail] = contact.split("·").map((s) => s.trim());
    return { id: id ?? undefined, kind: "internal", title, funder: funder || null, award_summary: award || null, application_due: due || null, loi_due: loi || null, eligibility: eligibility || null, review_process: (reviewProcess || null) as CuratedInput["review_process"], contact_name: cName || null, contact_email: cEmail && cEmail.includes("@") ? cEmail : cName?.includes("@") ? cName : null, program_url: programUrl || null, source_kind: sourceKind, source_url: sourceUrl || null, review_by: reviewBy || null };
  };
  const buildOverlay = (): OverlayInput => ({ id: id ?? undefined, opportunity_id: nonfederal ? null : notice?.id ?? null, curated_opportunity_id: nonfederal ? props.overlay?.curated?.id ?? null : null, nonfederal: nonfederal ? { title: nfTitle, funder: nfFunder || null, application_due: nfDue || null, sponsor_notice_number: nfNumber || null, program_url: nfUrl || null } : null, internal_due: internalDue || null, cap: cap === "" ? null : Number(cap), nominated_count: Number(nominated) || 0, process: process || null, infoready_url: infoready || null, source_kind: sourceKind, source_url: sourceUrl || null, review_by: reviewBy || null });

  const save = (publish: boolean) => {
    setError(null);
    start(async () => {
      const res = isInternal ? await saveCuratedAction(buildInternal(), { publish }) : await saveOverlayAction(buildOverlay(), { publish });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setId(res.id);
      setStatus(res.status);
      if (publish) setVerifiedNow(true);
      toast({ message: res.message });
      if (!id) router.replace(`/curate?kind=${kind}&id=${res.id}`);
    });
  };

  const unpublish = () => {
    if (!id) return;
    start(async () => {
      const res = isInternal ? await unpublishCuratedAction({ id }) : await unpublishOverlayAction({ id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStatus("draft");
      toast({ message: res.message });
    });
  };

  const remove = () => {
    if (!id) return;
    const theId = id;
    start(async () => {
      const res = isInternal ? await deleteCuratedAction({ id: theId }) : await deleteOverlayAction({ id: theId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast({
        message: `Deleted “${(isInternal ? title : notice?.title ?? nfTitle).slice(0, 40)}”`,
        action: { label: "Undo", onClick: () => void (isInternal ? restoreCuratedAction({ id: theId }) : restoreOverlayAction({ id: theId })).then(() => router.push(`/curate?kind=${kind}&id=${theId}`)) },
      });
      router.push(`/opportunities?scope=${kind}`);
    });
  };

  const statusPill = useMemo(() => {
    if (derived === "published") return <Pill variant="status-published">Published</Pill>;
    if (derived === "needs_review") return <Pill variant="status-needs-review">Needs review</Pill>;
    if (derived === "closed") return <Pill variant="status-closed">Published · closed</Pill>;
    return <Pill variant="status-draft">Draft · curators only</Pill>;
  }, [derived]);

  const statusHint = published
    ? derived === "needs_review"
      ? "Past its review-by date: shown as Needs review and left out of suggestions and Home until you publish again."
      : `Visible in the ${scopeName} scope with your name and verification date.`
    : "Publishing requires source, source link and a review-by date. The federal catalog is never touched.";

  return (
    <div className="flex max-w-[1040px] flex-col gap-5">
      <Link href={`/opportunities?scope=${kind}`} className="text-dense text-ink-muted hover:text-navy">← Opportunities · {scopeName}</Link>
      <header>
        <p className="mb-1 text-label font-semibold uppercase text-ink-muted">UCSF scope · you are a Curator</p>
        <h1 className="m-0 text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink">{isInternal ? "Curate an internal funding opportunity" : "Add a limited-submission overlay"}</h1>
        <p className="mb-0 mt-1.5 text-body leading-normal text-ink-muted">Curated records live apart from the synced federal catalog. They appear only in the Internal (UCSF) or Limited submissions scope, carry a Curated mark and your name, and are hidden from everyone but curators until published.</p>
      </header>

      <section className="flex flex-wrap items-center gap-1.5 rounded-card border border-line bg-card px-5 py-4">
        <span className="mr-1.5 text-dense font-medium text-ink">What are you adding?</span>
        {(["internal", "limited"] as Kind[]).map((k) => (
          <Link key={k} href={id ? `/curate?kind=${kind}&id=${id}` : `/curate?kind=${k}`} aria-disabled={Boolean(id) && k !== kind} className={cn("inline-flex h-8 items-center whitespace-nowrap rounded-control border px-3 text-dense font-medium", k === kind ? "border-navy bg-navy text-white" : "border-line-control bg-card text-ink", id && k !== kind && "pointer-events-none opacity-50")}>
            {k === "internal" ? "Internal funding" : "Limited-submission overlay on a synced notice"}
          </Link>
        ))}
      </section>

      {!isInternal ? (
        <SectionCard title="Sponsor notice (synced, read-only)">
          <div className="flex flex-col gap-3 px-5 py-4">
            {nonfederal ? (
              <div className="grid grid-cols-2 gap-3.5">
                <Field label="Sponsor notice title" className="col-span-2">{({ id }) => <Input id={id} value={nfTitle} onChange={(e) => setNfTitle(e.target.value)} placeholder="Pew Biomedical Scholars Program" />}</Field>
                <Field label="Sponsor">{({ id }) => <Input id={id} value={nfFunder} onChange={(e) => setNfFunder(e.target.value)} placeholder="Pew Charitable Trusts" />}</Field>
                <Field label="Sponsor due">{({ id }) => <Input id={id} type="date" value={nfDue} onChange={(e) => setNfDue(e.target.value)} />}</Field>
                <Field label="Sponsor reference" hint="optional">{({ id }) => <Input id={id} value={nfNumber} onChange={(e) => setNfNumber(e.target.value)} />}</Field>
                <Field label="Sponsor page">{({ id }) => <Input id={id} value={nfUrl} onChange={(e) => setNfUrl(e.target.value)} className={monoCls} placeholder="https://" />}</Field>
                <p className="col-span-2 m-0 text-meta leading-normal text-ink-muted">
                  This notice will carry a <Pill variant="trust-curated">Curated</Pill> mark and never appear in the Federal scope.{" "}
                  {!id ? <button type="button" className="font-medium text-teal" onClick={() => setNonfederal(false)}>Use a synced notice instead</button> : null}
                </p>
              </div>
            ) : notice ? (
              <>
                <Input readOnly value={notice.title} aria-label="Selected sponsor notice" />
                <div className="flex items-center justify-between gap-3 rounded-[8px] border border-line bg-canvas px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-body font-medium text-ink">{notice.title}</p>
                    <p className="mb-0 mt-0.5 text-meta text-ink-muted">
                      {notice.agencyShort}{notice.number ? ` · ${notice.number}` : ""} · sponsor due {notice.dueLabel} · <Pill variant="trust-synced">Synced</Pill> from {notice.source === "nih_guide" ? "the NIH Guide" : "Simpler.Grants.gov"}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-meta text-ink-muted">Nothing above this line can be edited</span>
                </div>
                {!id ? <button type="button" className="self-start text-meta font-medium text-teal" onClick={() => setNotice(null)}>Choose a different notice</button> : null}
              </>
            ) : (
              <>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the synced catalog by title or number…" aria-label="Search the synced catalog" autoFocus />
                {query.trim().length >= 2 ? (
                  <div className="rounded-[8px] border border-line">
                    {searching && !results.length ? <p className="m-0 px-3.5 py-3 text-dense text-ink-muted">Searching…</p> : null}
                    {!searching && !results.length ? <p className="m-0 px-3.5 py-3 text-dense text-ink-muted">No synced notice matches “{query}”.</p> : null}
                    {results.map((n) => (
                      <button key={n.id} type="button" onClick={() => setNotice(n)} className="flex w-full items-center justify-between gap-3 border-t border-line-row px-3.5 py-2.5 text-left first:border-t-0 hover:bg-canvas">
                        <span className="min-w-0">
                          <span className="block truncate text-dense font-medium text-ink">{n.title}</span>
                          <span className="block text-meta text-ink-muted">{n.agencyShort}{n.number ? ` · ${n.number}` : ""} · {n.dueTone === "closed" ? "closed" : `due ${n.dueLabel}`}</span>
                        </span>
                        <Pill variant="trust-synced">Synced</Pill>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            {!nonfederal ? (
              <p className="m-0 text-meta leading-normal text-ink-muted">
                Sponsor not in the catalog (a foundation, say)? <button type="button" className="font-medium text-teal" onClick={() => { setNonfederal(true); setNotice(null); }}>Create a curated non-federal notice</button> instead; it will carry a Curated mark and never appear in the Federal scope.
              </p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title={isInternal ? "Program details" : "UCSF process for this notice"}>
        <div className="grid grid-cols-2 gap-3.5 px-5 py-4">
          {isInternal ? (
            <>
              <Field label="Program title" className="col-span-2">{({ id }) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Diabetes Center Pilot & Feasibility Program — 2027 cycle" className={inputCls} />}</Field>
              <Field label="Funder (UCSF unit)">{({ id }) => <Input id={id} value={funder} onChange={(e) => setFunder(e.target.value)} placeholder="UCSF Diabetes Center · NIDDK P30 DRC" />}</Field>
              <Field label="Award">{({ id }) => <Input id={id} value={award} onChange={(e) => setAward(e.target.value)} placeholder="Up to $50,000 direct · 12 months · 4 awards" />}</Field>
              <Field label="Application due">{({ id }) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
              <Field label="Letter of intent">{({ id }) => <Input id={id} type="date" value={loi} onChange={(e) => setLoi(e.target.value)} />}</Field>
              <Field label="UCSF eligibility" className="col-span-2">{({ id }) => <Textarea id={id} value={eligibility} onChange={(e) => setEligibility(e.target.value)} rows={3} placeholder="UCSF faculty at any rank without current NIDDK R01 support in the proposed area; early-career investigators encouraged. One application per PI per cycle." />}</Field>
              <Field label="Review process">{({ id }) => <Select id={id} value={reviewProcess} onChange={(e) => setReviewProcess(e.target.value)}>{REVIEW_PROCESSES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select>}</Field>
              <Field label="Program contact">{({ id }) => <Input id={id} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Karen Liu · karen.liu@ucsf.edu" />}</Field>
              <Field label="Program page" hint="optional" className="col-span-2">{({ id }) => <Input id={id} value={programUrl} onChange={(e) => setProgramUrl(e.target.value)} className={monoCls} placeholder="https://" />}</Field>
            </>
          ) : (
            <>
              <Field label="Internal nomination due">{({ id }) => <Input id={id} type="date" value={internalDue} onChange={(e) => setInternalDue(e.target.value)} />}</Field>
              <Field label="Institutional cap">
                {({ id }) => (
                  <div className="flex items-center gap-2">
                    <Input id={id} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, "").slice(0, 2))} className="w-16 text-center" />
                    <span className="text-dense text-ink-body">nominee(s) UCSF may put forward</span>
                  </div>
                )}
              </Field>
              <Field label="Internal process" className="col-span-2">{({ id }) => <Textarea id={id} value={process} onChange={(e) => setProcess(e.target.value)} rows={3} placeholder="Submit a 2-page pre-proposal and NIH biosketch through InfoReady by the internal deadline. The Limited Submissions Committee selects the nominee within 10 business days." />}</Field>
              <Field label="InfoReady competition link">{({ id }) => <Input id={id} value={infoready} onChange={(e) => setInfoready(e.target.value)} className={monoCls} placeholder="https://ucsf.infoready4.com/#competitionDetail/…" />}</Field>
              <Field label="Nominations so far">
                {({ id }) => (
                  <div className="flex items-center gap-2">
                    <Input id={id} inputMode="numeric" value={nominated} onChange={(e) => setNominated(e.target.value.replace(/\D/g, "").slice(0, 3))} className="w-16 text-center" />
                    <span className="text-dense text-ink-body">{interestLine}</span>
                  </div>
                )}
              </Field>
            </>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Provenance · required to publish" aside={<Pill variant="trust-curated">Curated</Pill>}>
        <div className="grid grid-cols-2 gap-3.5 px-5 py-4">
          <Field label="Source">{({ id }) => <Select id={id} value={sourceKind} onChange={(e) => setSourceKind(e.target.value as SourceKind)}>{SOURCE_KINDS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>}</Field>
          <Field label="Source link">{({ id }) => <Input id={id} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={monoCls} placeholder={isInternal ? "https://diabetes.ucsf.edu/research/pilot-feasibility" : "https://ucsf.infoready4.com/#competitionDetail/…"} />}</Field>
          <Field label="Verified by">{({ id }) => <Input id={id} readOnly className="bg-canvas" value={verifiedNow ? `${props.viewer.name} (you) · today` : prov?.verified_by_name && prov.verified_at ? `${prov.verified_by_name} · ${ptDate(prov.verified_at) === props.today ? "today" : ptDate(prov.verified_at)}` : `${props.viewer.name} (you) · on publish`} />}</Field>
          <Field label="Review by" help="After this date the record shows “Needs review” and drops out of suggestions and Home until re-verified.">{({ id }) => <Input id={id} type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} />}</Field>
        </div>
      </SectionCard>

      {error ? <div className="rounded-card border border-danger-border bg-danger-tint px-4 py-3 text-dense text-danger-dark" role="alert">{error}</div> : null}

      <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3">
        <div className="flex items-center gap-2.5">
          {statusPill}
          <span className="text-dense text-ink-muted">{statusHint}</span>
        </div>
        <div className="flex gap-2">
          {id ? <Button variant="destructive-outline" size={36} onClick={remove} disabled={pending}>Delete</Button> : null}
          <Button variant="secondary" size={36} onClick={() => save(false)} disabled={pending}>Save draft</Button>
          {published ? <Button variant="secondary" size={36} onClick={unpublish} disabled={pending}>Unpublish</Button> : null}
          <Button variant="primary" size={36} onClick={() => save(true)} disabled={pending}>{published ? "Publish changes" : "Publish"}</Button>
        </div>
      </div>
    </div>
  );
}
