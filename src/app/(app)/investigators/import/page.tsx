import { ImportWizard } from "@/components/investigators/import-wizard";
import type { CommunityOption } from "@/lib/investigators/directory";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function InvestigatorImportPage({ searchParams }: { searchParams: { add?: string } }) {
  const supabase = createClient();
  const { data } = await supabase.from("pipeline_communities").select("id, slug, label").order("sort_order", { ascending: true });
  const communities = (data ?? []) as CommunityOption[];
  return <ImportWizard communities={communities} openAdd={searchParams.add === "1"} />;
}
