import { parseSourcesFilter, type SourcesFilter } from "@/lib/investigators/sources";

export const INVESTIGATORS_PER_PAGE = 50;

export type InvestigatorsListState = {
  q: string;
  /** "" = all monitored communities, "none" = not in a community, else a community id. */
  community: string;
  sources: SourcesFilter;
  page: number;
};

export function parseInvestigatorsState(params: Record<string, string | string[] | undefined>): InvestigatorsListState {
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const page = Number.parseInt(get("page"), 10);
  return {
    q: get("q").trim(),
    community: get("community").trim(),
    sources: parseSourcesFilter(get("sources")),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

export function investigatorsHref(state: Partial<InvestigatorsListState>): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.community) p.set("community", state.community);
  if (state.sources && state.sources !== "any") p.set("sources", state.sources);
  if (state.page && state.page > 1) p.set("page", String(state.page));
  const qs = p.toString();
  return qs ? `/investigators?${qs}` : "/investigators";
}
