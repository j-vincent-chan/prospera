"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { describeLibraryUploadAction, discardLibraryUploadAction, finishLibraryUploadAction, stageLibraryUploadAction } from "@/app/actions/library-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SlideOver } from "@/components/ui/slide-over";
import { useToast } from "@/components/ui/toast";
import { CONTENT_TYPES, MECHANISM_OPTIONS, NIH_INSTITUTES, fiscalYearOf, type ContentType, type LibraryOutcome } from "@/lib/institution/types";
import type { SensitiveFindings } from "@/lib/institution/library";
import { cn } from "@/lib/utils/cn";

type Step = 1 | 2 | 3 | 4;
const LABELS: Record<Step, [string, string, string]> = {
  1: ["Step 1 of 3 · File and type", "Upload to the UCSF library", "Visible to all of UCSF once published"],
  2: ["Step 2 of 3 · Describe it", "Add the details people will filter by", "Sponsor, mechanism and department power search"],
  3: ["Step 3 of 3 · Visibility", "Who sees it, and when", "Steward review is recommended for examples"],
  4: ["Done", "Sent for review", ""],
};

export function LibraryUploadFlow({ open, onClose, viewer, today }: { open: boolean; onClose: () => void; viewer: { department: string | null }; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [type, setType] = useState<ContentType>("research_strategy");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [findings, setFindings] = useState<SensitiveFindings | null>(null);
  const [findingsLine, setFindingsLine] = useState<string | null>(null);
  const [showSamples, setShowSamples] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState<LibraryOutcome>("funded");
  const [sponsor, setSponsor] = useState("NIH · NIAID");
  const [mechanism, setMechanism] = useState("R01");
  const [department, setDepartment] = useState(viewer.department ?? "");
  const [fy, setFy] = useState(`FY${fiscalYearOf(today)}`);
  const [award, setAward] = useState("");
  const [reviewDue, setReviewDue] = useState(`${Number(today.slice(0, 4)) + 1}${today.slice(4)}`);
  const [visibility, setVisibility] = useState<"review" | "publish">("review");
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState<{ status: "pending_review" | "published"; ahead: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rateBlocked = type === "rates";
  const [label, heading, hint] = LABELS[step];

  const reset = () => {
    setStep(1);
    setFile(null);
    setItemId(null);
    setFindings(null);
    setFindingsLine(null);
    setShowSamples(false);
    setConsent(false);
    setDone(null);
    setError(null);
    setTitle("");
    setAward("");
  };
  const close = () => {
    if (itemId && !done) void discardLibraryUploadAction({ itemId });
    reset();
    onClose();
  };

  const pickFile = (f: File | null) => {
    setError(null);
    if (!f) return setFile(null);
    if (f.size > 25 * 1024 * 1024) return setError("Files must be 25 MB or smaller.");
    setFile(f);
  };

  const next = () => {
    setError(null);
    if (step === 1) {
      if (!file) return setError("Drop a PDF or Word file, or browse for one.");
      const fd = new FormData();
      fd.set("file", file);
      fd.set("content_type", type);
      start(async () => {
        const res = await stageLibraryUploadAction(fd);
        if (!res.ok) return setError(res.error);
        setItemId(res.itemId);
        setFindings(res.findings);
        setFindingsLine(res.findingsLine);
        setExtractionError(res.extractionError);
        if (!title) setTitle(res.suggestedTitle);
        setStep(2);
      });
      return;
    }
    if (step === 2) {
      if (!itemId) return;
      start(async () => {
        const res = await describeLibraryUploadAction({ itemId, title, content_type: type as Exclude<ContentType, "rates">, outcome: type === "specific_aims" || type === "research_strategy" || type === "budget_justification" || type === "human_subjects" ? outcome : null, sponsor, mechanism, department, funding_year: fy, linked_award_number: award || null, review_due: reviewDue });
        if (!res.ok) return setError(res.error);
        setStep(3);
      });
      return;
    }
    if (step === 3) {
      if (!itemId) return;
      start(async () => {
        const res = await finishLibraryUploadAction({ itemId, visibility, consent });
        if (!res.ok) return setError(res.error);
        setDone({ status: res.status, ahead: res.ahead });
        setStep(4);
        router.refresh();
      });
      return;
    }
    toast({ message: done?.status === "published" ? "Published to all of UCSF" : "Upload is in the steward queue" });
    reset();
    onClose();
  };

  const nextDisabled = pending || (step === 1 && (rateBlocked || !file)) || (step === 3 && !consent);
  const nextLabel = step === 3 ? (visibility === "review" ? "Submit for review" : "Publish now") : step === 4 ? "Done" : "Continue";
  const exampleType = type === "specific_aims" || type === "research_strategy" || type === "budget_justification" || type === "human_subjects";

  return (
    <SlideOver
      open={open}
      onClose={close}
      label="Upload to library"
      width={640}
      header={
        <div>
          <p className="mb-1 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">{label}</p>
          <h2 className="m-0 text-title font-semibold text-ink">{heading}</h2>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta text-ink-muted">{hint}</span>
          <div className="flex gap-2">
            {step > 1 && step < 4 ? <Button variant="secondary" size={32} onClick={() => setStep((s) => (s - 1) as Step)} disabled={pending}>Back</Button> : null}
            <Button variant="primary" size={32} onClick={next} disabled={nextDisabled}>{pending ? "Working…" : nextLabel}</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        {error ? <div className="rounded-[8px] border border-danger-border bg-danger-tint px-3 py-2.5 text-dense text-danger-dark" role="alert">{error}</div> : null}
        {step === 1 ? (
          <>
            <div className="rounded-card border border-navy bg-canvas px-4 py-3.5 text-body leading-normal">
              <p className="m-0 font-semibold text-ink">This will be visible to everyone at UCSF who uses Prospera.</p>
              <p className="mb-0 mt-1.5 text-ink-body">Not just your team. Remove unpublished preliminary data, named collaborators who haven&apos;t agreed, and anything under embargo before you continue. You can ask a steward to review it before it goes public.</p>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0] ?? null); }}
              className={cn("rounded-card border border-dashed px-7 py-7 text-center text-body text-ink-body", dragging ? "border-navy bg-canvas" : "border-line-control")}
            >
              {file ? (
                <>
                  <span className="font-medium text-ink">{file.name}</span> · {(file.size / 1024 / 1024).toFixed(1)} MB · <button type="button" className="font-medium text-teal" onClick={() => pickFile(null)}>remove</button>
                </>
              ) : (
                <>
                  Drop a PDF or Word file here, or <button type="button" className="font-medium text-teal" onClick={() => fileRef.current?.click()}>browse</button>
                </>
              )}
              <p className="mb-0 mt-1.5 text-meta text-ink-muted">Up to 25 MB · text is extracted for search; the original is kept for download</p>
              <input ref={fileRef} type="file" hidden accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <p className="mb-2 text-dense font-medium text-ink">Content type</p>
              <div className="flex flex-wrap gap-1.5">
                {CONTENT_TYPES.map((t) => (
                  <button key={t.key} type="button" onClick={() => setType(t.key)} className={cn("inline-flex h-[30px] items-center whitespace-nowrap rounded-full border px-3 text-dense font-medium", type === t.key ? "border-navy bg-navy text-white" : "border-line-control bg-card text-ink")}>{t.chip}</button>
                ))}
              </div>
              {rateBlocked ? (
                <div className="mt-2.5 rounded-[8px] border border-danger-border bg-danger-tint px-3 py-2.5 text-dense leading-normal text-danger-dark">
                  Rates and required language can&apos;t be uploaded. They come from OSR&apos;s rate agreement so a stale number can&apos;t reach a budget. If OSR&apos;s schedule is wrong or missing something, <a href="mailto:library-stewards@ucsf.edu?subject=Prospera%20rate%20schedule" className="font-medium text-danger-dark">tell the stewards</a>.
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Title">{({ id }) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Research Strategy — tissue-resident Treg mechanisms in cutaneous lupus (funded R01)" />}</Field>
              <Field label="Outcome">{({ id }) => <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value as LibraryOutcome)} disabled={!exampleType}><option value="funded">Funded</option><option value="not_funded">Not funded</option><option value="template">Not submitted / template</option></Select>}</Field>
              <Field label="Sponsor">{({ id }) => <Select id={id} value={sponsor} onChange={(e) => setSponsor(e.target.value)}>{NIH_INSTITUTES.map((ic) => <option key={ic} value={`NIH · ${ic}`}>NIH · {ic}</option>)}<option value="NIH · other">NIH · other</option><option value="NSF">NSF</option><option value="DoD">DoD</option><option value="Foundation">Foundation</option><option value="Other">Other</option></Select>}</Field>
              <Field label="Mechanism">{({ id }) => <Select id={id} value={mechanism} onChange={(e) => setMechanism(e.target.value)}>{MECHANISM_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}<option value="Other">Other</option><option value="">Not applicable</option></Select>}</Field>
              <Field label="Department / school">{({ id }) => <Input id={id} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Medicine · Rheumatology" />}</Field>
              <Field label="Funding year">{({ id }) => <Input id={id} value={fy} onChange={(e) => setFy(e.target.value)} placeholder="FY2024" />}</Field>
              <Field label={<>Linked OSR award <span className="font-normal text-ink-muted">(optional)</span></>}>{({ id }) => <Input id={id} value={award} onChange={(e) => setAward(e.target.value)} className="font-mono text-[13px]" placeholder="5R01AI158703-03" />}</Field>
              <Field label="Review due" help="You'll be asked to re-confirm it then.">{({ id }) => <Input id={id} type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} />}</Field>
            </div>
            <div className="rounded-card border border-line px-3.5 py-3 text-dense leading-normal text-ink-body">
              <p className="mb-1.5 font-medium text-ink">Found in the document</p>
              {extractionError ? <span>{extractionError}</span> : findingsLine ? (
                <>
                  {findingsLine}. <button type="button" className="font-medium text-teal" onClick={() => setShowSamples((s) => !s)}>{showSamples ? "Hide" : "Review and redact"}</button>
                  {showSamples && findings?.samples.length ? <ul className="mb-0 mt-2 list-disc pl-5 text-meta text-ink-body">{findings.samples.map((s) => <li key={s}>{s}</li>)}</ul> : null}
                  {showSamples ? <p className="mb-0 mt-2 text-meta text-ink-muted">Redact in the source file and upload again, or continue and ask a steward to review.</p> : null}
                </>
              ) : "No named collaborators, unpublished-data mentions or email addresses were detected. The scan is a heuristic; please still check the file."}
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="flex flex-col gap-2">
              {([
                ["review", "Ask a steward to review before it goes public", "Recommended for examples that name people or cite unpublished work. Usually reviewed within 3 business days; you're notified either way."],
                ["publish", "Publish to all of UCSF now", "Visible immediately as a Community upload with your name on it."],
              ] as const).map(([k, t, d]) => (
                <label key={k} className={cn("flex cursor-pointer items-start gap-2.5 rounded-[8px] border px-3 py-3", visibility === k ? "border-teal bg-teal-tint/40" : "border-line-control")}>
                  <input type="radio" name="vis" checked={visibility === k} onChange={() => setVisibility(k)} className="mt-[3px] accent-navy" />
                  <span>
                    <span className="block text-body font-medium text-ink">{t}</span>
                    <span className="block text-meta leading-normal text-ink-muted">{d}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="flex items-start gap-2.5 text-body leading-normal text-ink">
              <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-[3px]" />
              I have the right to share this document, and I understand it will be visible to anyone at UCSF using Prospera, attributed to me, and kept until I or a steward remove it.
            </label>
          </>
        ) : null}

        {step === 4 && done ? (
          <div className="rounded-card border border-line bg-canvas px-4 py-4 text-body leading-normal">
            <p className="m-0 font-semibold text-ink">{done.status === "published" ? "Published to all of UCSF" : "Sent for steward review"}</p>
            <p className="mb-0 mt-1.5 text-ink-body">
              {done.status === "published"
                ? `Your ${CONTENT_TYPES.find((t) => t.key === type)?.short ?? "item"} is live as a Community upload with your name on it. You'll be asked to re-confirm it by ${reviewDue}.`
                : `Your ${CONTENT_TYPES.find((t) => t.key === type)?.short ?? "item"} example is in the queue (${done.ahead} ahead of it). Until it's approved only you and the stewards can see it. You'll get an email when it's published or if changes are requested.`}
            </p>
          </div>
        ) : null}
      </div>
    </SlideOver>
  );
}
