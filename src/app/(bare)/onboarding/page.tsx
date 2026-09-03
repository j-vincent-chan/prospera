import { redirect } from "next/navigation";
import { OnboardingClient, type OnboardingStep } from "@/components/onboarding/onboarding-client";
import { createClient } from "@/lib/supabase/server";
import {
  getInviteLink,
  getProfile,
  listDiscoverableTeams,
  listMyAccessRequests,
  listMyInvitations,
  listMyMemberships,
} from "@/lib/team/queries";

const STEPS: OnboardingStep[] = ["chooser", "create", "invite", "waiting", "invited"];

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { step?: string; team?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, memberships, discoverable, requests, catalog] = await Promise.all([
    getProfile(supabase, user.id),
    listMyMemberships(supabase, user.id),
    listDiscoverableTeams(supabase),
    listMyAccessRequests(supabase, user.id),
    supabase.from("funding_opportunities").select("*", { count: "exact", head: true }),
  ]);
  if (!profile) redirect("/login");
  const invitations = await listMyInvitations(supabase, profile.email);

  const requestedStep = STEPS.find((s) => s === searchParams.step);
  const pendingRequests = requests.filter((r) => r.status === "pending");
  const landedTeam =
    (searchParams.team && memberships.find((m) => m.teamId === searchParams.team)) ||
    (requestedStep === "invited" ? memberships[memberships.length - 1] : undefined);

  const initialStep: OnboardingStep =
    requestedStep ??
    (memberships.length === 0 && (pendingRequests.length > 0 || invitations.length > 0) ? "waiting" : "chooser");

  // Owners landing after "Create team" need their invite link for step 2/3.
  const inviteLink =
    landedTeam && landedTeam.role === "owner" ? await getInviteLink(supabase, landedTeam.teamId) : null;

  return (
    <OnboardingClient
      viewer={{ firstName: profile.fullName?.split(/\s+/)[0] ?? profile.email?.split("@")[0] ?? "there", email: profile.email, domain: profile.email?.split("@")[1] ?? "ucsf.edu" }}
      initialStep={initialStep}
      discoverable={discoverable}
      requests={pendingRequests}
      invitations={invitations}
      hasTeam={memberships.length > 0}
      landedTeam={landedTeam ? { id: landedTeam.teamId, name: landedTeam.team.name, slug: landedTeam.team.slug, role: landedTeam.role, inviteToken: inviteLink?.token ?? null } : null}
      catalogCount={catalog.count ?? 0}
    />
  );
}
