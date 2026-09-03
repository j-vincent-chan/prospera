import { redirect } from "next/navigation";
import { LibraryScreen } from "@/components/library/library-screen";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { loadLibrary, loadLibraryItem, parseLibraryFilters } from "@/lib/institution/library";
import { hasRole } from "@/lib/institution/roles";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const today = isoToday();
  const context = await loadWorkspaceContext(supabase, user.id);
  const steward = hasRole(context?.profile?.institutionRoles, "library_steward");
  const filters = parseLibraryFilters(searchParams);
  const itemId = typeof searchParams.item === "string" ? searchParams.item : null;
  const [data, detail] = await Promise.all([loadLibrary(supabase, filters, { today, viewerId: user.id, viewerIsSteward: steward }), itemId ? loadLibraryItem(supabase, itemId, { today, viewerId: user.id, viewerIsSteward: steward }) : Promise.resolve(null)]);
  return <LibraryScreen data={data} detail={detail} viewer={{ id: user.id, name: context?.profile?.fullName?.trim() || user.email || "You", department: context?.profile?.department ?? null, isSteward: steward }} today={today} openUpload={searchParams.upload === "1"} />;
}
