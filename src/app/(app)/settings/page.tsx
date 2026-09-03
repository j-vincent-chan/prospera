import { redirect } from "next/navigation";
import { SettingsClient } from "@/components/settings/settings-client";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";
import { getNotificationPreferences } from "@/lib/team/queries";
import { ROLE_LABEL } from "@/lib/team/types";

export default async function SettingsPage({ searchParams }: { searchParams: { password?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [context, preferences] = await Promise.all([
    loadWorkspaceContext(supabase, user.id),
    getNotificationPreferences(supabase, user.id),
  ]);
  if (!context) redirect("/login");

  const passwordAccount = (user.identities ?? []).some((i) => i.provider === "email") || user.app_metadata?.provider === "email";
  const roleLabel = context.current
    ? ROLE_LABEL[context.current.role]
    : context.profile.legacyRole === "admin"
      ? "Admin"
      : "Staff";

  return (
    <SettingsClient
      profile={context.profile}
      roleLabel={roleLabel}
      teamName={context.current?.team.name ?? null}
      preferences={preferences}
      passwordAccount={passwordAccount}
      passwordReset={searchParams.password === "reset"}
    />
  );
}
