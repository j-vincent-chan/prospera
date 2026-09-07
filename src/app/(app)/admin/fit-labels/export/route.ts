import { requireAdmin } from "@/lib/auth/require-admin";
import { serializeCsv } from "@/lib/fit/goldset/csv";
import { assignSlots } from "@/lib/fit/goldset/labels";
import { loadGoldLabels, loadLabelerIdentities } from "@/lib/fit/goldset/load";
import { GOLDSET_MANIFEST, LABELER_CONFIG, LABELER_CONFIG_VALUES } from "@/lib/fit/goldset/manifest";
import { labeledCsvRows } from "@/lib/fit/goldset/page-view";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The current gold labels as CSV (plan § PR 2.4 "a CSV export of the current
 * labels"): the export's columns with the three slots' latest labels filled
 * in, in manifest order — what `scripts/fit-goldset-import.ts` reads back
 * (a synthetic pair's labels are in it like any other's once
 * `fit_labels.synthetic_source` exists; before that, fill them in by hand
 * and hand the CSV to `fit:metrics -- --labels-csv`). Admin-only
 * through the session client; reads only.
 */
export async function GET(): Promise<Response> {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return Response.json({ error: admin.error }, { status: admin.error === "Unauthorized" ? 401 : 403 });

  const labels = await loadGoldLabels(supabase);
  if (labels.error) return Response.json({ error: labels.error }, { status: 500 });
  const identities = await loadLabelerIdentities(supabase, [...labels.rows.map((r) => r.labeler), ...LABELER_CONFIG_VALUES]);
  const assignment = assignSlots(LABELER_CONFIG, identities, labels.rows);
  const csv = serializeCsv(labeledCsvRows(GOLDSET_MANIFEST, labels.rows, assignment.slots));
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="goldset-${GOLDSET_MANIFEST.version}-labels-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
