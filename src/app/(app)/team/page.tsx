import { redirect } from "next/navigation";
import { TeamSettingsClient, type SubTab, type TopTab } from "@/components/team/team-settings-client";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";
import {
  getInviteLink,
  listFormerMembers,
  listTeamAccessRequests,
  listTeamInvitations,
  listTeamMembers,
} from "@/lib/team/queries";

export default async function TeamSettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const context = await loadWorkspaceContext(supabase, user.id);
  if (!context?.current) redirect("/onboarding");
  const { current } = context;
  const isAdmin = current.role !== "member";

  const [members, formerMembers, requests, invitations, inviteLink] = await Promise.all([
    listTeamMembers(supabase, current.teamId, user.id),
    listFormerMembers(supabase, current.teamId),
    isAdmin ? listTeamAccessRequests(supabase, current.teamId) : Promise.resolve([]),
    isAdmin ? listTeamInvitations(supabase, current.teamId) : Promise.resolve([]),
    isAdmin ? getInviteLink(supabase, current.teamId) : Promise.resolve(null),
  ]);

  const tab = searchParams.tab;
  const initialTab: TopTab = tab === "general" || tab === "outreach" ? tab : "members";
  const initialSub: SubTab = tab === "requests" ? "requests" : tab === "invites" || tab === "invitations" ? "invites" : "members";

  return (
    <TeamSettingsClient
      team={current.team}
      viewerId={user.id}
      viewerRole={current.role}
      members={members}
      formerMembers={formerMembers}
      requests={requests}
      invitations={invitations}
      inviteLink={inviteLink}
      initialTab={initialTab}
      initialSub={initialSub}
    />
  );
}
