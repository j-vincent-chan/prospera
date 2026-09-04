import { redirect } from "next/navigation";
import { AwardsScreen } from "@/components/awards/awards-screen";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { loadAwards, parseAwardsFilters } from "@/lib/institution/awards";
import { hasRole } from "@/lib/institution/roles";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const dynamic = "force-dynamic";

export default async function AwardsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const today = isoToday();
  const [context, data, refRates] = await Promise.all([loadWorkspaceContext(supabase, user.id), loadAwards(supabase, parseAwardsFilters(searchParams), today), supabase.from("reference_success_rates").select("id, mechanism, fiscal_year, rate, label, source_url").order("mechanism").order("fiscal_year", { ascending: false })]);
  const steward = hasRole(context?.profile?.institutionRoles, "library_steward");
  return <AwardsScreen data={data} viewerIsSteward={steward} referenceRates={(refRates.data ?? []) as Array<{ id: string; mechanism: string; fiscal_year: number; rate: number; label: string; source_url: string | null }>} today={today} />;
}
