import { InvestigatorsScreen, type DirectoryRowView } from "@/components/investigators/investigators-screen";
import { directoryCounts, filterDirectory, loadDirectory } from "@/lib/investigators/directory";
import { INVESTIGATORS_PER_PAGE, parseInvestigatorsState } from "@/lib/investigators/list-state";
import { headerSummary, personInitials } from "@/lib/investigators/sources";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function InvestigatorsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const state = parseInvestigatorsState(searchParams);
  const supabase = createClient();
  const { people, communities } = await loadDirectory(supabase);
  const filtered = filterDirectory(people, state);
  const summary = headerSummary(directoryCounts(people));

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / INVESTIGATORS_PER_PAGE));
  const index = Math.min(state.page, pages);
  const slice = filtered.slice((index - 1) * INVESTIGATORS_PER_PAGE, index * INVESTIGATORS_PER_PAGE);

  const rows: DirectoryRowView[] = slice.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    initials: personInitials(p.fullName),
    email: p.email,
    departmentLine: p.departmentLine,
    communityLabel: p.communityLabel,
    tagsLine: p.tags.slice(0, 4).join(" · "),
    chips: p.chips,
    nihProfileId: p.nihProfileId,
    orcid: p.orcid,
    profilesUrlName: p.profilesUrlName,
  }));

  return (
    <InvestigatorsScreen
      summary={summary}
      rows={rows}
      totalInDirectory={people.length}
      state={{ ...state, page: index }}
      communities={communities}
      page={{ index, perPage: INVESTIGATORS_PER_PAGE, total }}
    />
  );
}
