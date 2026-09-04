import { redirect } from "next/navigation";
import { CommunitiesScreen } from "@/components/communities/communities-screen";
import { loadCommunityOptions, loadCommunityOverview, loadLinkableSearches } from "@/lib/communities/queries";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";
import { listTeamMembers } from "@/lib/team/queries";

export const dynamic = "force-dynamic";

export default async function CommunitiesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const today = isoToday();
  const context = await loadWorkspaceContext(supabase, user.id);
  const teamId = context?.current?.teamId ?? null;
  const role = context?.current?.role ?? "member";
  const options = await loadCommunityOptions(supabase);
  const requested = typeof searchParams.community === "string" ? searchParams.community : null;
  const selected = options.find((o) => o.id === requested) ?? options.find((o) => o.active) ?? options[0] ?? null;
  const tabRaw = typeof searchParams.tab === "string" ? searchParams.tab : "overview";
  const tab = (["overview", "roster", "opportunities", "outreach", "searches"].includes(tabRaw) ? tabRaw : "overview") as "overview" | "roster" | "opportunities" | "outreach" | "searches";
  const [data, linkable, members] = await Promise.all([
    selected ? loadCommunityOverview(supabase, selected.id, { teamId, today }) : Promise.resolve(null),
    loadLinkableSearches(supabase, teamId),
    teamId ? listTeamMembers(supabase, teamId, user.id) : Promise.resolve([]),
  ]);
  return <CommunitiesScreen data={data} options={options} tab={tab} today={today} viewer={{ canEdit: role === "owner" || role === "admin", teamMembers: members.map((m) => ({ id: m.userId, name: m.fullName })) }} linkable={linkable} />;
}
