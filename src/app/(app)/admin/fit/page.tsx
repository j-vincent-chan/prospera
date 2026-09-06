import Link from "next/link";
import { AdminsOnly, ConfidencePill, SectionCard, WeightBar } from "@/components/fit/inspector-ui";
import { Pill } from "@/components/ui/pill";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/require-admin";
import { FIT_LABELS_MIGRATION, loadInspectorIndex } from "@/lib/fit/inspect/load";
import { fmtMonDYear } from "@/lib/investigators/sources";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

/**
 * Spot-check index (plan § PR 1.6 checkpoint: strategists spot-check 30
 * investigators and 20 notices before Phase 2). Two tables from slim
 * JSON-path selects of the two profile tables, sorted by name / number,
 * each row linking to its inspector page. Admin-only; reads only.
 */
export default async function FitInspectorIndexPage() {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return <AdminsOnly />;

  const index = await loadInspectorIndex(supabase);
  const pendingInvestigators = index.investigators.filter((r) => r.pending_items > 0).length;
  const incompleteOpportunities = index.opportunities.filter((r) => !r.complete).length;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">Fit profiles</h1>
        <p className="mb-0 mt-1 text-body text-ink-muted">
          Admin spot check for the fit engine: {index.investigators.length} investigator profile{index.investigators.length === 1 ? "" : "s"}
          {pendingInvestigators ? ` (${pendingInvestigators} partial)` : ""} and {index.opportunities.length} notice profile{index.opportunities.length === 1 ? "" : "s"}
          {incompleteOpportunities ? ` (${incompleteOpportunities} incomplete)` : ""}. Open a row, read the evidence, flag what is wrong.
        </p>
        {index.tablesMissing.length ? (
          <p className="mb-0 mt-2 text-dense text-warning">
            Not on the database yet: <code className="font-mono text-meta">{index.tablesMissing.join(", ")}</code>
            {index.tablesMissing.includes("fit_labels") ? <> — flags need <code className="font-mono text-meta">{FIT_LABELS_MIGRATION}</code></> : null}.
          </p>
        ) : null}
        {index.errors.length ? <p className="mb-0 mt-2 text-dense text-danger">{index.errors.join(" · ")}</p> : null}
      </header>

      <SectionCard title="Investigators" aside={`${index.investigators.length} with a stored profile · by name`}>
        {index.investigators.length === 0 ? (
          <p className="m-0 px-5 py-4 text-dense text-ink-muted">No investigator profiles stored yet. The nightly fit-profiles job and scripts/fit-build-profiles.ts write them.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1080px]">
              <TableHead>
                <tr>
                  <TableHeaderCell first className="w-[220px]">Investigator</TableHeaderCell>
                  <TableHeaderCell className="w-[260px]">Dominant paradigm · career</TableHeaderCell>
                  <TableHeaderCell className="w-[220px]">Recent</TableHeaderCell>
                  <TableHeaderCell className="w-[190px]">Confidence P U D M O T</TableHeaderCell>
                  <TableHeaderCell align="right" className="w-[80px]">Items</TableHeaderCell>
                  <TableHeaderCell align="right" className="w-[90px]">Pending</TableHeaderCell>
                  <TableHeaderCell align="right" className="w-[70px]">Flags</TableHeaderCell>
                  <TableHeaderCell className="w-[120px]">Computed</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {index.investigators.map((r) => (
                  <TableRow key={r.investigator_id}>
                    <TableCell first>
                      <Link href={r.href} className="font-medium text-ink hover:text-teal">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.career ? (
                        <div className="flex flex-col">
                          <span className={cn("text-dense", r.career.known ? "text-ink" : "text-danger")}>
                            {r.career.label}
                            {!r.career.known ? <span className="text-micro"> · not in the taxonomy</span> : null}
                          </span>
                          <span className="flex items-center gap-2 text-meta text-ink-muted">
                            {r.career.family} <WeightBar weight={r.career.weight} />
                          </span>
                        </div>
                      ) : (
                        <span className="text-meta text-ink-muted">no paradigm evidence</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.recent ? (
                        <div className="flex flex-col">
                          <span className={cn("text-dense", !r.recent.known ? "text-danger" : r.moved ? "text-warning" : "text-ink")} title={r.moved ? "Dominant family differs from the career view" : undefined}>
                            {r.recent.label}
                            {r.moved ? " ↔" : ""}
                            {!r.recent.known ? <span className="text-micro"> · not in the taxonomy</span> : null}
                          </span>
                          <span className="flex items-center gap-2 text-meta text-ink-muted">
                            {r.recent.family} <WeightBar weight={r.recent.weight} />
                          </span>
                        </div>
                      ) : (
                        <span className="text-meta text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <ConfidencePill confidence={r.lowest} prefix="min" />
                        <span className="font-mono text-meta text-ink-muted">{r.confidence}</span>
                      </span>
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">{r.item_count}</TableCell>
                    <TableCell align="right" className="tabular-nums">{r.pending_items ? <Pill variant="status-needs-review">{r.pending_items}</Pill> : <span className="text-ink-muted">0</span>}</TableCell>
                    <TableCell align="right" className="tabular-nums">{r.flags ? <Pill variant="status-overdue">{r.flags}</Pill> : <span className="text-ink-muted">0</span>}</TableCell>
                    <TableCell className="text-meta text-ink-muted">
                      {fmtMonDYear(r.computed_at)}
                      {r.taxonomy_version ? <span className="block font-mono text-micro">{r.taxonomy_version}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Opportunities" aside={`${index.opportunities.length} with a stored profile · by number`}>
        {index.opportunities.length === 0 ? (
          <p className="m-0 px-5 py-4 text-dense text-ink-muted">No notice profiles stored yet. The nightly fit-opportunity-profiles job and scripts/fit-build-opportunity-profiles.ts write them.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1120px]">
              <TableHead>
                <tr>
                  <TableHeaderCell first className="w-[130px]">Number</TableHeaderCell>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell className="w-[120px]">Designation</TableHeaderCell>
                  <TableHeaderCell className="w-[240px]">Top required paradigm</TableHeaderCell>
                  <TableHeaderCell className="w-[110px]">Confidence</TableHeaderCell>
                  <TableHeaderCell className="w-[110px]">Complete</TableHeaderCell>
                  <TableHeaderCell align="right" className="w-[70px]">Flags</TableHeaderCell>
                  <TableHeaderCell className="w-[120px]">Computed</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {index.opportunities.map((r) => (
                  <TableRow key={r.opportunity_id}>
                    <TableCell first>
                      <Link href={r.href} className="font-mono text-dense font-medium text-ink hover:text-teal">
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={r.href} className="line-clamp-2 text-dense text-ink hover:text-teal" title={r.title}>
                        {r.title}
                      </Link>
                      {r.needs_review ? <Pill variant="status-needs-review" className="mt-1">Needs review</Pill> : null}
                    </TableCell>
                    <TableCell className="text-dense">{r.designation}</TableCell>
                    <TableCell>
                      {r.required ? (
                        <div className="flex flex-col">
                          <span className="text-dense text-ink">
                            {r.required.label}
                            {r.required.any ? <span className="text-meta text-ink-muted"> (any of)</span> : null}
                          </span>
                          <span className="flex items-center gap-2 text-meta text-ink-muted">
                            <WeightBar weight={r.required.weight} />
                            {r.excluded ? `${r.excluded} excluded` : null}
                          </span>
                        </div>
                      ) : (
                        <span className="text-meta text-ink-muted">no requirement{r.excluded ? ` · ${r.excluded} excluded` : ""}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ConfidencePill confidence={r.confidence} />
                      <span className="block text-micro text-ink-muted">{r.text}</span>
                    </TableCell>
                    <TableCell>{r.complete ? <Pill variant="status-open">complete</Pill> : <Pill variant="status-needs-review">incomplete</Pill>}</TableCell>
                    <TableCell align="right" className="tabular-nums">{r.flags ? <Pill variant="status-overdue">{r.flags}</Pill> : <span className="text-ink-muted">0</span>}</TableCell>
                    <TableCell className="text-meta text-ink-muted">
                      {fmtMonDYear(r.computed_at)}
                      {r.taxonomy_version ? <span className="block font-mono text-micro">{r.taxonomy_version}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
