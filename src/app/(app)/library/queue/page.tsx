import { redirect } from "next/navigation";
import { QueueScreen } from "@/components/library/queue-screen";
import { EmptyState } from "@/components/ui/empty-state";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { loadStewardQueue } from "@/lib/institution/library";
import { hasRole } from "@/lib/institution/roles";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const context = await loadWorkspaceContext(supabase, user.id);
  if (!hasRole(context?.profile?.institutionRoles, "library_steward")) {
    return <EmptyState title="Library stewards only" description="The steward queue reviews uploads before they go public, resolves reader flags and chases past-due reviews. Ask a team owner to grant you the Library steward role from Team settings → Members." />;
  }
  const data = await loadStewardQueue(supabase, isoToday(), user.id);
  return <QueueScreen data={data} />;
}
