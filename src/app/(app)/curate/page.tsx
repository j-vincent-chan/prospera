import { redirect } from "next/navigation";
import { CurateForm } from "@/components/curate/curate-form";
import { EmptyState } from "@/components/ui/empty-state";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { loadCuratedRecord, loadOverlay, noticeSummary } from "@/lib/institution/curated";
import { hasRole } from "@/lib/institution/roles";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const dynamic = "force-dynamic";

export default async function CuratePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const context = await loadWorkspaceContext(supabase, user.id);
  const roles = context?.profile?.institutionRoles ?? [];
  if (!hasRole(roles, "curator")) {
    return (
      <div className="flex max-w-[1040px] flex-col gap-5">
        <EmptyState title="Curators only" description="Internal (UCSF) records and limited-submission overlays are entered by UCSF Curators. Ask a team owner to grant you the Curator role from Team settings → Members." />
      </div>
    );
  }
  const today = isoToday();
  const kindParam = typeof searchParams.kind === "string" ? searchParams.kind : "internal";
  const id = typeof searchParams.id === "string" ? searchParams.id : null;
  const noticeId = typeof searchParams.notice === "string" ? searchParams.notice : null;
  let kind: "internal" | "limited" = kindParam === "limited" ? "limited" : "internal";
  let record = null;
  let overlay = null;
  if (id) {
    if (kind === "internal") {
      record = await loadCuratedRecord(supabase, id);
      if (!record) {
        overlay = await loadOverlay(supabase, id, today);
        if (overlay) kind = "limited";
      }
    } else {
      overlay = await loadOverlay(supabase, id, today);
      if (!overlay) {
        record = await loadCuratedRecord(supabase, id);
        if (record) kind = "internal";
      }
    }
    if (!record && !overlay) redirect(`/curate?kind=${kind}`);
  }
  let preselected = null;
  if (!id && noticeId) {
    const { data: fo } = await supabase.from("funding_opportunities").select("id, title, agency, agency_code, opportunity_number, activity_code, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, source_url, raw_payload_json").eq("id", noticeId).maybeSingle();
    if (fo) {
      preselected = noticeSummary(fo as Record<string, unknown>, today);
      kind = "limited";
    }
  }
  return <CurateForm key={`${kind}-${id ?? "new"}`} kind={kind} today={today} viewer={{ name: context?.profile?.fullName?.trim() || user.email || "You" }} record={record} overlay={overlay} preselected={preselected} />;
}
