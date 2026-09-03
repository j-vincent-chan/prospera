"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { useEffect, useMemo, useState, useTransition } from "react";
import { importInvestigatorRowsAction, previewImportEmailsAction, type ImportResult, type ImportRowInput } from "@/app/actions/investigator-actions";
import { InvestigatorFormSheet } from "@/components/investigators/investigator-form-sheet";
import { InvestigatorSignalImportForm } from "@/components/investigators/investigator-signal-import-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { normalizeCsvHeader } from "@/lib/csv/normalize-csv-header";
import type { CommunityOption } from "@/lib/investigators/directory";
import { cn } from "@/lib/utils/cn";

/**
 * Investigator Import v2: Upload → Map columns → Review & import, plus the
 * Add investigator sheet (`?add=1`). Parsing and mapping happen in the
 * browser; the server action receives rows already keyed by Prospera field.
 */

type FieldKey =
  | "first_name" | "last_name" | "full_name" | "middle_initial" | "email" | "home_department" | "division" | "rank"
  | "primary_research_area" | "research_summary" | "secondary_research_areas" | "primary_disease_focus" | "secondary_disease_focuses"
  | "technological_expertise" | "clinical_samples" | "biobanks" | "small_grants" | "large_grants"
  | "nih_profile_id" | "orcid" | "communities" | "note" | "skip";

const FIELDS: Array<{ value: FieldKey; label: string }> = [
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "full_name", label: "Full name (split into first and last)" },
  { value: "middle_initial", label: "Middle initial" },
  { value: "email", label: "Email" },
  { value: "home_department", label: "Department" },
  { value: "division", label: "Division" },
  { value: "rank", label: "Rank" },
  { value: "primary_research_area", label: "Research focus" },
  { value: "research_summary", label: "Research summary" },
  { value: "secondary_research_areas", label: "Secondary research areas" },
  { value: "primary_disease_focus", label: "Disease focus" },
  { value: "secondary_disease_focuses", label: "Secondary disease focuses" },
  { value: "technological_expertise", label: "Technical expertise" },
  { value: "clinical_samples", label: "Clinical samples" },
  { value: "biobanks", label: "Biobanks" },
  { value: "small_grants", label: "Small grants" },
  { value: "large_grants", label: "Large grants" },
  { value: "nih_profile_id", label: "RePORTER profile ID" },
  { value: "orcid", label: "ORCID iD" },
  { value: "communities", label: "Communities (multi)" },
  { value: "note", label: "Store as note (not used for fit)" },
  { value: "skip", label: "Skip this column" },
];

/** Fields that are stored but never feed fit tiers. */
const NOTE_ONLY: FieldKey[] = ["rank", "note", "middle_initial"];

const ALIASES: Record<string, FieldKey> = {
  first_name: "first_name", firstname: "first_name", fname: "first_name", given_name: "first_name",
  last_name: "last_name", lastname: "last_name", lname: "last_name", surname: "last_name", family_name: "last_name",
  name: "full_name", full_name: "full_name", investigator: "full_name", pi: "full_name", pi_name: "full_name",
  middle_initial: "middle_initial", mi: "middle_initial", middle: "middle_initial",
  email: "email", email_address: "email", ucsf_email: "email",
  home_department: "home_department", department: "home_department", dept: "home_department",
  division: "division", rank: "rank", title: "rank", academic_rank: "rank",
  primary_research_area: "primary_research_area", research_focus: "primary_research_area", research_area: "primary_research_area", research_interests: "primary_research_area", focus: "primary_research_area",
  research_summary: "research_summary", summary: "research_summary", bio: "research_summary",
  secondary_research_areas: "secondary_research_areas",
  primary_disease_focus: "primary_disease_focus", disease_focus: "primary_disease_focus", disease: "primary_disease_focus",
  secondary_disease_focuses: "secondary_disease_focuses",
  technological_expertise: "technological_expertise", technical_expertise: "technological_expertise", methods: "technological_expertise", techniques: "technological_expertise",
  clinical_samples: "clinical_samples", biobanks: "biobanks", small_grants: "small_grants", large_grants: "large_grants",
  nih_profile_id: "nih_profile_id", nih_reporter_id: "nih_profile_id", reporter_profile_id: "nih_profile_id", reporter_id: "nih_profile_id",
  orcid: "orcid", orcid_id: "orcid", orcid_iD: "orcid",
  affiliations: "communities", affiliation: "communities", community: "communities", communities: "communities",
};

/** Headers we won't guess: a human decides. */
const AMBIGUOUS = new Set(["profile_id", "id", "identifier", "uid", "notes", "comments", "interest", "interests"]);

type ColumnMap = { header: string; field: FieldKey | null; samples: string; blanks: number };

function autoMap(header: string): FieldKey | null {
  const n = normalizeCsvHeader(header);
  if (AMBIGUOUS.has(n)) return null;
  return ALIASES[n] ?? null;
}

function splitName(full: string): { first: string; last: string } {
  const t = full.trim().replace(/\s+/g, " ");
  if (!t) return { first: "", last: "" };
  if (t.includes(",")) {
    const [last, first] = t.split(",").map((s) => s.trim());
    return { first: first ?? "", last: last ?? "" };
  }
  const parts = t.split(" ");
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}

type ReviewRow = { line: number; name: string; email: string; department: string; communities: string; status: "create" | "update" | "error"; note: string; input: ImportRowInput };

const TEMPLATE = "first_name,last_name,email,home_department,division,rank,primary_research_area,research_summary,nih_profile_id,orcid,affiliations\n";

export function ImportWizard({ communities, openAdd }: { communities: CommunityOption[]; openAdd: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  // Portal-based sheets render nothing on the server; open after hydration so the markup matches.
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => setAddOpen(openAdd), [openAdd]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [columns, setColumns] = useState<ColumnMap[]>([]);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [assignTo, setAssignTo] = useState<string>(communities[0]?.id ?? "");
  const [existingEmails, setExistingEmails] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const closeAdd = () => {
    setAddOpen(false);
    if (openAdd) router.replace("/investigators/import");
  };

  const onFile = (file: File) => {
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim()));
        if (!data.length) return setParseError("The file has a header row but no data rows.");
        const headers = (res.meta.fields ?? []).filter(Boolean);
        const cols: ColumnMap[] = headers.map((h) => {
          const values = data.map((r) => String(r[h] ?? "").trim());
          const distinct = Array.from(new Set(values.filter(Boolean))).slice(0, 3);
          return { header: h, field: autoMap(h), samples: distinct.join(" · ") || "—", blanks: values.filter((v) => !v).length };
        });
        setFileName(file.name);
        setRows(data);
        setColumns(cols);
        setResult(null);
        setStep(2);
      },
      error: (err) => setParseError(err.message),
    });
  };

  // Which emails are already in the directory, for the "will be updated" note.
  const emailHeader = columns.find((c) => c.field === "email")?.header ?? null;
  useEffect(() => {
    if (step !== 2 || !emailHeader) return;
    const emails = rows.map((r) => String(r[emailHeader] ?? "").trim().toLowerCase()).filter((e) => e.includes("@"));
    if (!emails.length) return setExistingEmails(new Set());
    let alive = true;
    previewImportEmailsAction(emails).then((r) => {
      if (alive && r.ok) setExistingEmails(new Set(r.existing));
    });
    return () => {
      alive = false;
    };
  }, [step, emailHeader, rows]);

  const mappedCount = columns.filter((c) => c.field && c.field !== "skip").length;
  const undecided = columns.filter((c) => c.field === null).length;
  const hasNames = columns.some((c) => c.field === "full_name") || (columns.some((c) => c.field === "first_name") && columns.some((c) => c.field === "last_name"));
  const noEmailRows = emailHeader ? rows.filter((r) => !String(r[emailHeader] ?? "").trim()).length : rows.length;
  const willUpdate = emailHeader ? rows.filter((r) => existingEmails.has(String(r[emailHeader] ?? "").trim().toLowerCase())).length : 0;
  const noteOnlyLabels = columns.filter((c) => c.field && NOTE_ONLY.includes(c.field)).map((c) => `“${c.header}”`);

  const reviewRows: ReviewRow[] = useMemo(() => {
    if (step !== 3) return [];
    return rows.map((r, i) => {
      const input: ImportRowInput = { line: i + 2, communities: [], extra: {} };
      for (const c of columns) {
        const v = String(r[c.header] ?? "").trim();
        if (!c.field || c.field === "skip") continue;
        if (c.field === "full_name") {
          const { first, last } = splitName(v);
          if (!input.first_name) input.first_name = first;
          if (!input.last_name) input.last_name = last;
        } else if (c.field === "communities") {
          input.communities = [...(input.communities ?? []), ...v.split(/[;|,]/).map((s) => s.trim()).filter(Boolean)];
        } else if (c.field === "note") {
          input.extra = { ...(input.extra ?? {}), [normalizeCsvHeader(c.header) || c.header]: v };
        } else {
          (input as Record<string, unknown>)[c.field] = v;
        }
      }
      const name = `${input.first_name ?? ""} ${input.last_name ?? ""}`.trim();
      const email = (input.email ?? "").toLowerCase();
      let status: ReviewRow["status"] = "create";
      let note = "New profile";
      if (!input.first_name || !input.last_name) {
        status = "error";
        note = "First and last name are required";
      } else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        status = "error";
        note = "Not a valid email";
      } else if (email && existingEmails.has(email)) {
        status = updateExisting ? "update" : "error";
        note = updateExisting ? "Updates the existing profile" : "Already in the directory (updates are off)";
      } else if (!email) {
        note = "New profile · no email, can't receive outreach";
      }
      return { line: input.line, name, email: input.email ?? "", department: input.home_department ?? "", communities: (input.communities ?? []).join("; "), status, note, input };
    });
  }, [step, rows, columns, existingEmails, updateExisting]);

  const importable = reviewRows.filter((r) => r.status !== "error");

  const runImport = () =>
    startTransition(async () => {
      const r = await importInvestigatorRowsAction({ rows: importable.map((x) => x.input), updateExisting, defaultCommunityId: assignTo || null, fileName });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      const rest: ImportResult = { created: r.created, updated: r.updated, errors: r.errors, ids: r.ids };
      setResult(rest);
      toast({ message: `Imported ${rest.created} new and updated ${rest.updated}${rest.errors.length ? ` · ${rest.errors.length} row${rest.errors.length === 1 ? "" : "s"} need attention` : ""}.` });
    });

  const errorReportHref = useMemo(() => {
    if (!result) return null;
    const clientErrors = reviewRows.filter((r) => r.status === "error").map((r) => ({ line: r.line, message: r.note }));
    const all = [...clientErrors, ...result.errors].sort((a, b) => a.line - b.line);
    if (!all.length) return null;
    const csv = Papa.unparse(all.map((e) => ({ line: e.line, problem: e.message })));
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  }, [result, reviewRows]);

  const stepLabel = step === 1 ? "step 1 of 3" : step === 2 ? "step 2 of 3" : "step 3 of 3";

  return (
    <div className="flex max-w-[1100px] flex-col gap-5">
      <Link href="/investigators" className="text-dense text-ink-muted hover:text-ink">← Investigators</Link>
      <header>
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.015em] text-ink">Import investigators</h1>
        <p className="mb-0 mt-1.5 text-body text-ink-muted">{fileName ? `${fileName} · ${rows.length} row${rows.length === 1 ? "" : "s"} · ${stepLabel}` : "A CSV from a community roster, or one person at a time"}</p>
      </header>

      <Stepper step={step} />

      {step === 1 ? (
        <>
          <section className="rounded-card border border-line bg-card px-6 py-6">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-control bg-canvas px-6 py-10 text-center hover:border-teal">
              <span className="text-[15px] font-semibold text-ink">Choose a CSV file</span>
              <span className="max-w-[420px] text-dense text-ink-muted">One row per person. Columns are matched by name on the next step, so any roster export works.</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            </label>
            {parseError ? <p className="mb-0 mt-3 text-meta text-danger" role="alert">{parseError}</p> : null}
            <p className="mb-0 mt-3 text-meta text-ink-muted">
              Recognized columns: first_name, last_name (or name), email, home_department, division, rank, primary_research_area, research_summary, nih_profile_id, orcid, affiliations.{" "}
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="prospera-investigators-template.csv" className="font-medium text-teal">Download a template</a>
            </p>
          </section>
          <details className="rounded-card border border-line bg-card px-6 py-4">
            <summary className="cursor-pointer text-dense font-medium text-ink">Other sources · sync from Signal</summary>
            <div className="mt-3">
              <InvestigatorSignalImportForm />
            </div>
          </details>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <section className="overflow-hidden rounded-card border border-line bg-card">
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
              <p className="m-0 text-dense">
                <span className="font-medium text-ink">{mappedCount} of {columns.length} columns</span>{" "}
                <span className="text-ink-muted">mapped automatically{undecided ? ` · ${undecided} need${undecided === 1 ? "s" : ""} a decision` : ""}</span>
              </p>
              <label className="flex items-center gap-2 text-dense text-ink-body">
                <Checkbox checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                Update existing people by email
              </label>
            </div>
            <table className="w-full table-fixed border-collapse text-dense">
              <thead>
                <tr className="bg-canvas text-left text-meta text-ink-muted">
                  <th className="w-[26%] px-5 py-2.5 font-medium">CSV column</th>
                  <th className="w-[30%] px-3 py-2.5 font-medium">Sample values</th>
                  <th className="w-[28%] px-3 py-2.5 font-medium">Prospera field</th>
                  <th className="w-[16%] px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c, i) => {
                  const kind = c.field === null ? "warn" : c.field === "skip" || c.field === "note" ? "skip" : c.field === "email" && c.blanks > 0 ? "warn" : "ok";
                  const status = c.field === null ? "Needs decision" : c.field === "skip" ? "Skipped" : c.field === "note" ? "Stored as note" : c.field === "email" && c.blanks > 0 ? `${c.blanks} blank` : "Mapped";
                  return (
                    <tr key={c.header} className="border-t border-line-row">
                      <td className="px-5 py-2.5 font-mono text-meta text-ink">{c.header}</td>
                      <td className="truncate px-3 py-2.5 text-ink-body" title={c.samples}>{c.samples}</td>
                      <td className="px-3 py-2.5">
                        <Select
                          size={30}
                          value={c.field ?? ""}
                          onChange={(e) => setColumns((cols) => cols.map((x, j) => (j === i ? { ...x, field: (e.target.value || null) as FieldKey | null } : x)))}
                          className={cn("w-full", c.field === null && "border-warning")}
                          aria-label={`Field for ${c.header}`}
                        >
                          <option value="">Choose field…</option>
                          {FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-5 py-2.5">
                        <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-micro font-medium", kind === "ok" ? "bg-success-tint text-success" : kind === "warn" ? "bg-warning-tint text-warning" : "bg-line-row text-ink-body")}>{status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="rounded-card border border-warning-border bg-warning-tint px-4 py-3.5 text-dense leading-normal text-warning-dark">
            <span className="font-medium">Before you import:</span>{" "}
            {[
              noEmailRows ? `${noEmailRows} row${noEmailRows === 1 ? " has" : "s have"} no email (they can't receive outreach)` : null,
              willUpdate ? `${willUpdate} row${willUpdate === 1 ? "" : "s"} match${willUpdate === 1 ? "es" : ""} people already in the directory and will be ${updateExisting ? "updated" : "skipped"}` : null,
              noteOnlyLabels.length ? `${noteOnlyLabels.join(", ")} will be stored but ${noteOnlyLabels.length === 1 ? "isn't" : "aren't"} used for fit tiers` : null,
              !hasNames ? "map a Full name column, or both First name and Last name, to continue" : null,
            ]
              .filter(Boolean)
              .join(", ") || "everything is mapped and every row has an email."}
            {undecided ? " Columns marked Needs decision must be mapped or skipped." : ""}
          </section>

          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
            <div className="flex items-center gap-2">
              <span className="text-meta text-ink-muted">Assign all to</span>
              <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Assign all rows to a community">
                {communities.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
                <option value="">No community</option>
              </Select>
              <Button variant="primary" disabled={!hasNames || undecided > 0} onClick={() => setStep(3)}>Review {rows.length} row{rows.length === 1 ? "" : "s"} →</Button>
            </div>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <section className="overflow-hidden rounded-card border border-line bg-card">
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 text-dense">
              <p className="m-0">
                <span className="font-medium text-ink">{importable.length} of {reviewRows.length} rows</span>{" "}
                <span className="text-ink-muted">ready · {reviewRows.filter((r) => r.status === "create").length} new · {reviewRows.filter((r) => r.status === "update").length} updates · {reviewRows.filter((r) => r.status === "error").length} with problems</span>
              </p>
              {result ? <span className="text-ink-muted">Imported {result.created} new · updated {result.updated}</span> : null}
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full table-fixed border-collapse text-dense">
                <thead>
                  <tr className="sticky top-0 bg-canvas text-left text-meta text-ink-muted">
                    <th className="w-[7%] px-5 py-2.5 font-medium">Line</th>
                    <th className="w-[22%] px-3 py-2.5 font-medium">Name</th>
                    <th className="w-[24%] px-3 py-2.5 font-medium">Email</th>
                    <th className="w-[17%] px-3 py-2.5 font-medium">Department</th>
                    <th className="w-[30%] px-5 py-2.5 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map((r) => {
                    const serverError = result?.errors.find((e) => e.line === r.line);
                    const status = serverError ? "error" : result && r.status !== "error" ? "done" : r.status;
                    return (
                      <tr key={r.line} className="border-t border-line-row">
                        <td className="px-5 py-2 font-mono text-meta text-ink-muted">{r.line}</td>
                        <td className="truncate px-3 py-2 text-ink">{r.name || "—"}</td>
                        <td className="truncate px-3 py-2 text-ink-body">{r.email || "—"}</td>
                        <td className="truncate px-3 py-2 text-ink-body">{r.department || "—"}</td>
                        <td className="px-5 py-2">
                          <span className={cn("mr-1.5 inline-flex h-5 items-center rounded-full px-2 text-micro font-medium", status === "error" ? "bg-danger-tint text-danger" : status === "update" ? "bg-warning-tint text-warning" : status === "done" ? "bg-success-tint text-success" : "bg-success-tint text-success")}>
                            {status === "error" ? "Problem" : status === "update" ? "Update" : status === "done" ? "Imported" : "Create"}
                          </span>
                          <span className="text-meta text-ink-muted">{serverError?.message ?? r.note}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={pending}>Back</Button>
            <div className="flex items-center gap-2">
              {errorReportHref ? (
                <a href={errorReportHref} download={`${(fileName ?? "import").replace(/\.csv$/i, "")}-errors.csv`} className="text-dense font-medium text-teal hover:text-navy">Download error report</a>
              ) : null}
              {result ? (
                <Button variant="primary" onClick={() => router.push("/investigators")}>Open investigators</Button>
              ) : (
                <Button variant="primary" onClick={runImport} disabled={pending || importable.length === 0}>{pending ? "Importing…" : `Import ${importable.length} row${importable.length === 1 ? "" : "s"}`}</Button>
              )}
            </div>
          </div>
          {result ? (
            <p className="m-0 text-meta text-ink-muted">New people get their sources fetched by the nightly refresh; open a profile and use Refresh sources to fetch sooner.</p>
          ) : null}
        </>
      ) : null}

      <InvestigatorFormSheet open={addOpen} onClose={closeAdd} communities={communities} defaultCommunityId={communities[0]?.id ?? null} />
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const items = ["Upload", "Map columns", "Review & import"];
  return (
    <div className="flex text-dense">
      {items.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <span key={label} className={cn("flex items-center gap-2", i === 0 ? "pr-5" : "border-l border-line px-5", state === "done" ? "text-success" : state === "current" ? "font-medium text-ink" : "text-ink-muted")}>
            <span className={cn("flex h-[22px] w-[22px] items-center justify-center rounded-full text-meta font-semibold", state === "done" ? "bg-success-tint" : state === "current" ? "bg-navy text-white" : "bg-line-row")}>{state === "done" ? "✓" : n}</span>
            {label}
          </span>
        );
      })}
    </div>
  );
}
