import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DataSourcesPanel,
  DetailHeaderActions,
  PublicationsList,
  ReviewModeProvider,
  type DataSourceRowView,
  type PublicationView,
} from "@/components/investigators/investigator-detail-client";
import type { InvestigatorFormValues } from "@/components/investigators/investigator-form-sheet";
import { Pill } from "@/components/ui/pill";
import { formatDegrees, selfDeclaredFormFromRow } from "@/lib/fit/self-declared";
import { addedViaLabel, grantIsActive, type CommunityOption } from "@/lib/investigators/directory";
import { rankOpportunitiesForInvestigator } from "@/lib/outreach/rank-opportunities";
import { TIER_LABEL, type SuggestionTier } from "@/lib/outreach/types";
import { loadWorkspaceContext } from "@/lib/team/current-team";
import {
  emptySourceRow,
  fmtMonD,
  fmtMonYear,
  personInitials,
  shortIc,
  type GrantEvidence,
  type InvestigatorSourceRow,
  type PublicationEvidence,
  type SourceContext,
  type SourceKey,
} from "@/lib/investigators/sources";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function SectionCard({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-card border border-line bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="m-0 whitespace-nowrap text-[15px] font-semibold text-ink">{title}</h2>
        {aside ? <span className="text-right text-meta text-ink-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function TagGroup({ label, tags }: { label: string; tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div>
      <p className="mb-1.5 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">{label}</p>
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span key={t} className="inline-flex h-[22px] items-center rounded-full bg-line-row px-2 text-meta text-ink-body">{t.replaceAll("_", " ")}</span>
        ))}
      </div>
    </div>
  );
}

const TIER_VARIANT: Record<SuggestionTier, "tier-strong" | "tier-potential" | "tier-exploratory"> = { strong: "tier-strong", potential: "tier-potential", exploratory: "tier-exploratory" };

const readinessLabel = (v: string | null | undefined) => (v && v !== "unknown" ? v[0]!.toUpperCase() + v.slice(1) : "—");
const collaborationLabel = (v: string | null | undefined) => ({ lead: "Lead PI", collaborator: "Co-investigator", either: "Multi-PI" } as Record<string, string>)[v ?? ""] ?? "—";

export default async function InvestigatorDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const id = params.id;
  const { data: inv } = await supabase.from("investigators").select("*").eq("id", id).is("archived_at", null).maybeSingle();
  if (!inv) notFound();

  const [
    { data: feats },
    { data: sourceRows },
    { data: grantRows },
    { data: pubRows },
    { data: trialRows },
    { data: relRows },
    { data: communityRows },
    fit,
    outreachItems,
  ] = await Promise.all([
    supabase.from("investigator_profile_features").select("*").eq("investigator_id", id).maybeSingle(),
    supabase.from("investigator_sources").select("*").eq("investigator_id", id),
    supabase.from("investigator_nih_grants").select("id, project_num, fiscal_year, project_title, ic_name, is_active, identity_status, raw_json, updated_at").eq("investigator_id", id).order("fiscal_year", { ascending: false }).limit(40),
    supabase.from("investigator_publications").select("id, pmid, title, journal, publication_date, identity_method, identity_status, reviewed_at").eq("investigator_id", id).order("publication_date", { ascending: false, nullsFirst: false }).limit(300),
    supabase.from("investigator_clinical_trials").select("nct_id, updated_at").eq("investigator_id", id).order("updated_at", { ascending: false }).limit(50),
    supabase.from("investigator_relationships").select("investigator_a_id, investigator_b_id, evidence_count").or(`investigator_a_id.eq.${id},investigator_b_id.eq.${id}`).eq("source_type", "pubmed_coauthorship").order("evidence_count", { ascending: false }).limit(8),
    supabase.from("pipeline_communities").select("id, slug, label").order("sort_order", { ascending: true }),
    rankOpportunitiesForInvestigator(supabase, id, 5),
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const ctx = user ? await loadWorkspaceContext(supabase, user.id) : null;
      const teamId = ctx?.current?.teamId ?? null;
      if (!teamId) return [] as Array<{ id: string; title: string; stage: string }>;
      const { data } = await supabase.from("outreach_items").select("id, stage, funding_opportunities(title)").eq("team_id", teamId).in("stage", ["triage", "contacting", "developing"]).order("last_activity_at", { ascending: false }).limit(40);
      return ((data ?? []) as Array<{ id: string; stage: string; funding_opportunities: { title: string } | { title: string }[] | null }>).map((r) => ({ id: r.id, stage: r.stage, title: (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities)?.title ?? "Opportunity" }));
    })(),
  ]);

  const communities = (communityRows ?? []) as CommunityOption[];
  const community = communities.find((c) => c.id === inv.research_community_id) ?? null;
  const lastName = (inv.last_name as string | null)?.trim() || String(inv.full_name).trim().split(/\s+/).slice(-1)[0] || String(inv.full_name);

  const sources = {} as Record<SourceKey, InvestigatorSourceRow>;
  for (const k of ["reporter", "pubmed", "biosketch", "orcid", "profiles"] as SourceKey[]) {
    sources[k] = ((sourceRows ?? []) as InvestigatorSourceRow[]).find((r) => r.source === k) ?? emptySourceRow(id, k);
  }

  const grants: Array<GrantEvidence & { id: string; updated_at: string }> = ((grantRows ?? []) as Array<Record<string, unknown>>).map((g) => {
    const raw = (g.raw_json ?? {}) as { project_start_date?: string; project_end_date?: string; contact_pi_name?: string };
    const end = raw.project_end_date?.slice(0, 10) ?? null;
    const fiscal_year = (g.fiscal_year as number | null) ?? null;
    return {
      id: String(g.id),
      project_num: String(g.project_num),
      project_title: (g.project_title as string | null) ?? null,
      ic_name: (g.ic_name as string | null) ?? null,
      fiscal_year,
      is_active: grantIsActive({ end, fiscal_year, is_active: (g.is_active as boolean | null) ?? null }),
      start: raw.project_start_date?.slice(0, 10) ?? null,
      end,
      role: raw.contact_pi_name?.toUpperCase().includes(lastName.toUpperCase()) ? "Contact PI" : null,
      identity_status: (g.identity_status as GrantEvidence["identity_status"]) ?? "verified",
      updated_at: String(g.updated_at),
    };
  });
  const pubs = ((pubRows ?? []) as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id),
    pmid: String(p.pmid),
    title: (p.title as string | null) ?? null,
    journal: (p.journal as string | null) ?? null,
    publication_date: (p.publication_date as string | null) ?? null,
    identity_method: p.identity_method as PublicationEvidence["identity_method"],
    identity_status: p.identity_status as PublicationEvidence["identity_status"],
    reviewed_at: (p.reviewed_at as string | null) ?? null,
  }));

  const ctx: SourceContext = {
    now: new Date(),
    fullName: String(inv.full_name),
    lastName,
    email: (inv.email as string | null)?.trim() || null,
    nihProfileId: (inv.nih_profile_id as string | null)?.trim() || null,
    orcid: (inv.orcid as string | null)?.trim() || null,
    addedVia: addedViaLabel(inv.raw_profile_json),
    addedAt: String(inv.created_at),
    grants,
    publications: pubs,
    repliedInterestedAt: null,
  };

  const matches = fit.matches;
  const openNotices = fit.openNotices;

  // Collaborators
  const otherIds = (relRows ?? []).map((r) => (r.investigator_a_id === id ? r.investigator_b_id : r.investigator_a_id) as string);
  const { data: collabRows } = otherIds.length ? await supabase.from("investigators").select("id, full_name").in("id", otherIds).is("archived_at", null) : { data: [] as Array<{ id: string; full_name: string }> };
  const collaborators = (relRows ?? [])
    .map((r) => {
      const other = (r.investigator_a_id === id ? r.investigator_b_id : r.investigator_a_id) as string;
      const row = (collabRows ?? []).find((c) => c.id === other);
      return row ? { id: other, name: row.full_name as string, shared: Number(r.evidence_count) } : null;
    })
    .filter((c): c is { id: string; name: string; shared: number } => Boolean(c));

  // Publications view
  const verifiedPubs = pubs.filter((p) => p.identity_status === "verified");
  const unverifiedPubs = pubs.filter((p) => p.identity_status === "unverified");
  const toView = (p: (typeof pubs)[number]): PublicationView => ({
    id: p.id,
    pmid: p.pmid,
    title: p.title?.trim() || `PMID ${p.pmid}`,
    meta: [p.journal, p.publication_date ? fmtMonYear(p.publication_date) : null, p.identity_status === "unverified" ? "name-only · confirm or reject" : p.identity_method === "manual" ? "confirmed by you" : null].filter(Boolean).join(" · "),
    identity_method: p.identity_method,
    identity_status: p.identity_status,
    reviewed_at: p.reviewed_at,
  });
  const shownVerified = verifiedPubs.slice(0, 6).map(toView);
  const methodSummary = (() => {
    const m = sources.pubmed.identity_method;
    if (m === "affiliation") return "name + UCSF affiliation match";
    if (m === "orcid") return "ORCID record match";
    if (m === "profiles") return "UCSF Profiles listing";
    if (m === "manual") return "confirmed by you";
    return "name search";
  })();
  const pubConfidence = unverifiedPubs.length ? "medium" : verifiedPubs.length ? "high" : null;
  const pubsAside = sources.pubmed.last_refreshed_at ? (
    <>
      PubMed · {methodSummary} · {pubConfidence === "medium" ? <span className="text-warning">medium confidence</span> : pubConfidence === "high" ? "high confidence" : "no matches"} · {shownVerified.length} of {verifiedPubs.length} · refreshed {fmtMonD(sources.pubmed.last_refreshed_at)}
    </>
  ) : (
    "PubMed · not yet queried"
  );
  const grantsAside = ctx.nihProfileId
    ? `NIH RePORTER · by profile ID ${ctx.nihProfileId} · high confidence${sources.reporter.last_refreshed_at ? ` · refreshed ${fmtMonD(sources.reporter.last_refreshed_at)}` : " · not yet fetched"}`
    : "NIH RePORTER · no profile ID on file";

  const trialsRefreshed = (trialRows ?? [])[0]?.updated_at as string | undefined;
  const dataSourceRows: DataSourceRowView[] = [
    { label: "PubMed", value: sources.pubmed.last_refreshed_at ? `${verifiedPubs.length}${unverifiedPubs.length ? ` (+${unverifiedPubs.length} unverified)` : ""} · ${fmtMonD(sources.pubmed.last_refreshed_at)}` : "not yet queried" },
    { label: "NIH RePORTER", value: sources.reporter.last_refreshed_at ? `${grants.filter((g) => g.identity_status !== "rejected").length} · ${fmtMonD(sources.reporter.last_refreshed_at)}` : ctx.nihProfileId ? "not yet fetched" : "no profile ID" },
    { label: "ClinicalTrials.gov", value: trialsRefreshed ? `${(trialRows ?? []).length} · ${fmtMonD(trialsRefreshed)}` : "not yet queried" },
    { label: "ORCID", value: sources.orcid.last_refreshed_at ? `${sources.orcid.item_count} works · ${fmtMonD(sources.orcid.last_refreshed_at)}` : ctx.orcid ? "iD on file · not fetched" : "not connected" },
    { label: "UCSF Profiles", value: sources.profiles.last_refreshed_at ? `${sources.profiles.item_count} listed · ${fmtMonD(sources.profiles.last_refreshed_at)}` : sources.profiles.last_error ? "no match" : "not connected" },
  ];

  const raw = (inv.raw_profile_json ?? {}) as Record<string, unknown>;
  const formInitial: InvestigatorFormValues = {
    id,
    first_name: (inv.first_name as string | null) ?? "",
    last_name: (inv.last_name as string | null) ?? "",
    email: ctx.email ?? "",
    home_department: (inv.home_department as string | null) ?? "",
    division: (inv.division as string | null) ?? "",
    research_community_id: (inv.research_community_id as string | null) ?? "",
    research_focus: typeof raw.primary_research_area === "string" ? raw.primary_research_area : "",
    orcid: ctx.orcid ?? "",
    nih_profile_id: ctx.nihProfileId ?? "",
    profiles_url_name: (inv.profiles_url_name as string | null) ?? "",
    title_series: (inv.title_series as string | null) ?? "",
    degrees: formatDegrees((inv.degrees as string[] | null) ?? []),
    research: selfDeclaredFormFromRow(inv as { self_declared_axes?: unknown; aspirations?: unknown; do_not_suggest?: unknown }),
  };

  const f = (feats ?? {}) as { science_tags?: string[]; disease_tags?: string[]; method_tags?: string[]; translational_tags?: string[]; grant_readiness_small?: string; grant_readiness_large?: string; collaboration_role_preference?: string };
  const science = Array.from(new Set([...(f.science_tags ?? []), ...(f.translational_tags ?? [])]));
  const metaLine = [inv.home_department, inv.division, ctx.email].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <Link href="/investigators" className="text-dense text-ink-muted hover:text-ink">← Investigators</Link>
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-tint text-[16px] font-semibold text-teal">{personInitials(String(inv.full_name))}</span>
          <div>
            <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">{String(inv.full_name)}</h1>
            <p className="mb-0 mt-1 text-body text-ink-muted">
              {metaLine || "No department or email on file"}
              {community ? (
                <>
                  {" · "}
                  <span className="inline-flex h-5 items-center rounded-full bg-line-row px-2 align-middle text-meta font-medium text-ink-body">{community.label}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <DetailHeaderActions investigatorId={id} fullName={String(inv.full_name)} communities={communities} formInitial={formInitial} outreachItems={outreachItems} />
      </header>

      <ReviewModeProvider>
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex flex-col gap-4">
              <SectionCard title="Opportunities that fit" aside={`Fit tier · evidence similarity vs ${new Intl.NumberFormat("en-US").format(openNotices)} open notices · computed when you open this page`}>
                {matches.length === 0 ? (
                  <div className="px-5 py-4 text-dense text-ink-muted">
                    {!fit.embedded ? "No embedded evidence yet. Refresh sources so publications and awards can be indexed, then reopen this page." : openNotices === 0 ? "Open notices haven’t been indexed yet; the nightly job fills this in." : "No open notice clears the exploratory bar for this profile."}
                  </div>
                ) : (
                  matches.map((m, i) => (
                    <div key={m.opportunityId} className={cn("flex items-start justify-between gap-4 px-5 py-3.5", i > 0 && "border-t border-line-row")}>
                      <div className="min-w-0">
                        <Link href={`/opportunities/${m.opportunityId}`} className="text-body font-medium text-ink hover:text-teal">{m.title}</Link>
                        <p className="mb-0 mt-1 text-meta leading-normal text-ink-muted">{m.why}</p>
                      </div>
                      <Pill variant={TIER_VARIANT[m.tier]}>{TIER_LABEL[m.tier]}</Pill>
                    </div>
                  ))
                )}
              </SectionCard>

              <SectionCard title="NIH projects" aside={grantsAside}>
                {grants.length === 0 ? (
                  <div className="px-5 py-4 text-dense text-ink-muted">{ctx.nihProfileId ? "No projects cached. Refresh sources to query RePORTER." : "Add the RePORTER profile ID in Data sources; awards are matched by ID only."}</div>
                ) : (
                  grants.slice(0, 12).map((g, i) => (
                    <div key={g.id} className={cn("px-5 py-3.5", i > 0 && "border-t border-line-row")}>
                      <div className="flex items-center gap-2 text-meta text-ink-muted">
                        <span className="font-mono text-ink">{g.project_num}</span>
                        <span>·</span>
                        <span>FY {g.fiscal_year ?? "—"}</span>
                        <span>·</span>
                        <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-micro font-medium", g.is_active ? "bg-success-tint text-success" : "bg-line-row text-ink-body")}>{g.is_active ? "Active" : "Ended"}</span>
                      </div>
                      <p className="mb-0 mt-1.5 text-body font-medium text-ink">{g.project_title || "Title not in RePORTER cache"}</p>
                      <p className="mb-0 mt-0.5 text-meta text-ink-muted">{shortIc(g.ic_name) ?? "—"}</p>
                    </div>
                  ))
                )}
              </SectionCard>

              <SectionCard title="Recent publications" aside={pubsAside} className="scroll-mt-6">
                <div id="publications" />
                <PublicationsList investigatorId={id} verified={shownVerified} unverified={unverifiedPubs.map(toView)} />
              </SectionCard>
            </div>

            <aside className="flex flex-col gap-4">
              <section className="flex flex-col gap-3 rounded-card border border-line bg-card px-5 py-4">
                <h2 className="m-0 text-[15px] font-semibold text-ink">Research profile</h2>
                {science.length || f.disease_tags?.length || f.method_tags?.length ? (
                  <>
                    <TagGroup label="Science" tags={science} />
                    <TagGroup label="Disease" tags={f.disease_tags ?? []} />
                    <TagGroup label="Methods" tags={f.method_tags ?? []} />
                  </>
                ) : (
                  <p className="m-0 text-dense leading-normal text-ink-muted">No tags yet. Add a research focus with Edit; fit tiers start from it.</p>
                )}
                <dl className="mb-0 mt-1 grid grid-cols-2 gap-x-3 gap-y-2 text-dense">
                  <dt className="text-ink-muted">Readiness</dt>
                  <dd className="m-0">{readinessLabel(f.grant_readiness_small)} / {readinessLabel(f.grant_readiness_large)}</dd>
                  <dt className="text-ink-muted">Collaboration</dt>
                  <dd className="m-0">{collaborationLabel(f.collaboration_role_preference)}</dd>
                  <dt className="text-ink-muted">ORCID</dt>
                  <dd className="m-0 font-mono text-meta">{ctx.orcid ?? "—"}</dd>
                </dl>
              </section>
              <DataSourcesPanel investigatorId={id} fullName={String(inv.full_name)} email={ctx.email} nihProfileId={ctx.nihProfileId} rows={dataSourceRows} biosketch={sources.biosketch} />
              <section className="flex flex-col gap-2.5 rounded-card border border-line bg-card px-5 py-4">
                <h2 className="m-0 text-[15px] font-semibold text-ink">Collaborators</h2>
                {collaborators.length === 0 ? (
                  <p className="m-0 text-dense text-ink-muted">No shared publications with anyone in the directory yet.</p>
                ) : (
                  collaborators.map((c) => (
                    <div key={c.id} className="flex justify-between gap-3 text-dense">
                      <Link href={`/investigators/${c.id}`} className="font-medium text-ink hover:text-teal">{c.name}</Link>
                      <span className="text-ink-muted">{c.shared} shared</span>
                    </div>
                  ))
                )}
              </section>
            </aside>
        </div>
      </ReviewModeProvider>
    </div>
  );
}
