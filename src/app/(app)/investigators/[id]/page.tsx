import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/formatting/dates";
import {
  normalizeSingleInvestigatorForm,
  updateInvestigatorNihProfileIdFormAction,
} from "@/app/actions/investigators-pipeline";
import { InvestigatorCacheRefreshButtons } from "@/components/investigators/investigator-cache-refresh-buttons";
import { extractOpportunityQuickTags } from "@/lib/quick-match/tag-opportunity";
import { buildPiQuickMatchProfile } from "@/lib/quick-match/normalize-pi";
import { rankOpportunitiesForPi } from "@/lib/quick-match/engine";
import { QuickMatchOpportunityList } from "@/components/quick-match/quick-match-lists";
import { QuickMatchTagChips } from "@/components/quick-match/quick-match-tag-chips";
import { DEFAULT_MAX_NOFOS_PER_SYNC } from "@/lib/services/simpler-grants-sync";
import {
  normalizeReporterAgencyField,
  normalizeReporterOrgName,
  pickReporterProjectTitle,
} from "@/lib/community/reporter-display";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function InvestigatorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const id = params.id;

  const { data: inv, error } = await supabase
    .from("investigators")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !inv) notFound();

  const { data: feats } = await supabase
    .from("investigator_profile_features")
    .select("*")
    .eq("investigator_id", id)
    .maybeSingle();

  const [
    { data: engagements },
    { data: publications },
    { data: nihGrants },
    { data: clinicalTrials },
    { data: relRows },
    { data: oppPool },
  ] = await Promise.all([
    supabase
      .from("strategist_engagements")
      .select(
        "id, status, engagement_type, next_step, next_step_due_date, notes, opportunity_id, funding_opportunities(id, title)"
      )
      .eq("investigator_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("investigator_publications")
      .select("pmid, title, journal, publication_date, match_confidence")
      .eq("investigator_id", id)
      .order("publication_date", { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from("investigator_nih_grants")
      .select(
        "project_num, fiscal_year, project_title, ic_name, org_name, award_amount, is_active, match_confidence, raw_json"
      )
      .eq("investigator_id", id)
      .order("fiscal_year", { ascending: false })
      .limit(20),
    supabase
      .from("investigator_clinical_trials")
      .select(
        "nct_id, title, overall_status, conditions, lead_sponsor, start_date, last_update_date, match_confidence"
      )
      .eq("investigator_id", id)
      .order("last_update_date", { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from("investigator_relationships")
      .select(
        "investigator_a_id, investigator_b_id, evidence_count, strength_score, last_seen_date, source_type"
      )
      .or(`investigator_a_id.eq.${id},investigator_b_id.eq.${id}`)
      .eq("source_type", "pubmed_coauthorship")
      .order("evidence_count", { ascending: false })
      .limit(15),
    supabase
      .from("funding_opportunities")
      .select(
        "id, title, agency, description, category, funding_instrument, applicant_types, raw_payload_json, posted_date"
      )
      .order("posted_date", { ascending: false, nullsFirst: false })
      .limit(DEFAULT_MAX_NOFOS_PER_SYNC),
  ]);

  const piQuick = buildPiQuickMatchProfile(inv, feats);
  const oppTagged = (oppPool ?? []).map((o) => ({
    id: o.id as string,
    title: String(o.title ?? ""),
    agency: (o.agency as string | null) ?? null,
    tags: extractOpportunityQuickTags({
      title: String(o.title ?? ""),
      description: o.description as string | null,
      agency: o.agency as string | null,
      category: o.category as string | null,
      funding_instrument: o.funding_instrument as string | null,
      applicant_types: o.applicant_types,
      raw_payload_json: o.raw_payload_json,
    }),
  }));
  const quickOppRanked = rankOpportunitiesForPi(piQuick, oppTagged);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/investigators"
          className="text-xs font-medium text-[var(--fo-ink-muted)] hover:text-[var(--fo-title)]"
        >
          ← People
        </Link>
        <h1 className="mt-2 app-page-title">{inv.full_name}</h1>
        <p className="mt-1 app-page-description">
          {inv.email ?? "—"} · {inv.home_department ?? inv.division ?? "—"}
        </p>
        {(inv as { orcid?: string | null; pubmed_query_override?: string | null }).orcid ||
        (inv as { orcid?: string | null; pubmed_query_override?: string | null })
          .pubmed_query_override ? (
          <p className="mt-2 text-xs text-slate-500">
            {(inv as { orcid?: string | null }).orcid ? (
              <>
                ORCID: {(inv as { orcid?: string | null }).orcid}
                {" · "}
              </>
            ) : null}
            {(inv as { pubmed_query_override?: string | null }).pubmed_query_override
              ? `PubMed query override: ${(inv as { pubmed_query_override?: string | null }).pubmed_query_override}`
              : null}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <form action={normalizeSingleInvestigatorForm}>
          <input type="hidden" name="investigatorId" value={id} />
          <Button type="submit" variant="secondary">
            Re-normalize profile
          </Button>
        </form>
      </div>

      <InvestigatorCacheRefreshButtons investigatorId={id} />

      <p className="text-xs text-slate-500">
        PubMed uses <code className="rounded bg-slate-100 px-1">pubmed_query_override</code> when
        set; otherwise strict Lastname F[Author] (+ middle initial when set) AND UCSF affiliation,
        with per-author verification. Each refresh pulls uncapped recent publications
        (override with <code className="rounded bg-slate-100 px-1">NCBI_PUBMED_MAX_RESULTS</code>,
        max 500). Set{" "}
        <code className="rounded bg-slate-100 px-1">NCBI_CONTACT_EMAIL</code> for E-utilities.
        NIH RePORTER only queries by <code className="rounded bg-slate-100 px-1">nih_profile_id</code>{" "}
        (numeric PI profile id from RePORTER/eRA). Without it, refresh clears any cached projects and
        does not call the API — name search is disabled to avoid unrelated PIs with the same name.
        ClinicalTrials.gov uses the public{" "}
        <a
          href="https://clinicaltrials.gov/data-api/about-api"
          className="text-[var(--fo-interaction)] underline"
          target="_blank"
          rel="noreferrer"
        >
          API v2
        </a>{" "}
        with <code className="rounded bg-slate-100 px-1">clinicaltrials_query_override</code> when set;
        otherwise quoted name search scoped to UCSF facility (medium confidence; verify matches).
      </p>

      <Card>
        <CardHeader
          title="NIH RePORTER PI profile id"
          description="Stored on this investigator as nih_profile_id. Find the numeric id in NIH RePORTER (PI profile) and enter it here for accurate grant lists."
        />
        <CardBody>
          <form
            action={updateInvestigatorNihProfileIdFormAction}
            className="flex flex-col gap-3 sm:max-w-md"
          >
            <input type="hidden" name="investigatorId" value={id} />
            <div>
              <Label htmlFor="nih-profile-id">NIH Reporter profile id (digits only)</Label>
              <Input
                id="nih-profile-id"
                name="nihProfileId"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 8033726"
                defaultValue={(inv.nih_profile_id as string | null) ?? ""}
                className="mt-1 font-mono"
              />
              <p className="mt-1 text-xs text-slate-500">
                {(inv.nih_profile_id as string | null)?.trim()
                  ? "Saved id is required for Refresh NIH RePORTER."
                  : "Required for NIH RePORTER — save the numeric PI profile id from RePORTER before refreshing."}
              </p>
            </div>
            <Button type="submit" variant="secondary">
              Save NIH profile id
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Normalized profile" />
        <CardBody className="space-y-3 text-sm text-slate-700">
          {feats ? (
            <>
              <TagBlock label="Science tags" values={feats.science_tags ?? []} />
              <TagBlock label="Disease tags" values={feats.disease_tags ?? []} />
              <TagBlock label="Method tags" values={feats.method_tags ?? []} />
              <TagBlock label="Translational tags" values={feats.translational_tags ?? []} />
              <p>
                <span className="font-medium">Readiness (small / large):</span>{" "}
                {feats.grant_readiness_small} / {feats.grant_readiness_large}
              </p>
              <p>
                <span className="font-medium">Collaboration preference:</span>{" "}
                {feats.collaboration_role_preference}
              </p>
              <p className="text-xs text-slate-500">
                Version {feats.normalization_version} · Updated{" "}
                {new Date(feats.updated_at).toLocaleString()}
              </p>
            </>
          ) : (
            <p className="text-slate-500">No feature row — run normalization.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Strategist engagements"
          description="Operational outreach tracked in Community."
        />
        <CardBody className="space-y-3 text-sm">
          {(engagements ?? []).length === 0 ? (
            <p className="text-ink-muted">No engagements yet.</p>
          ) : (
            <ul className="space-y-2">
              {(engagements ?? []).map((row) => {
                type Fo = { id?: string; title?: string };
                const fo = row.funding_opportunities as Fo | Fo[] | null | undefined;
                const f = Array.isArray(fo) ? fo[0] : fo;
                return (
                  <li
                    key={row.id}
                    className="rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{row.status}</Badge>
                      <span className="text-slate-600">{row.engagement_type}</span>
                    </div>
                    {f?.id ? (
                      <Link
                        href={`/funding-opportunities/${f.id}`}
                        className="mt-1 block text-[var(--accent)] hover:underline"
                      >
                        {f.title ?? "Opportunity"}
                      </Link>
                    ) : null}
                    {row.next_step ? (
                      <p className="mt-1 text-slate-700">Next: {row.next_step}</p>
                    ) : null}
                    <p className="text-xs text-slate-500">
                      Due {formatDate(row.next_step_due_date ?? null)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Recent publications (PubMed cache)"
          description="Medium confidence by default; name disambiguation is imperfect."
        />
        <CardBody>
          {(publications ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No cached publications — run Refresh PubMed.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(publications ?? []).map((p) => (
                <li key={p.pmid}>
                  <a
                    className="font-medium text-[var(--accent)] hover:underline"
                    href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {p.title || `PMID ${p.pmid}`}
                  </a>
                  <div className="text-xs text-slate-600">
                    {p.journal ?? "—"} · {formatDate(p.publication_date ?? null)} ·{" "}
                    {p.match_confidence}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="NIH projects (RePORTER cache)"
          description="Not the full funding universe; verify high-stakes decisions."
        />
        <CardBody>
          {(nihGrants ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No cached projects — run Refresh NIH RePORTER.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {(nihGrants ?? []).map((g) => {
                const institute =
                  normalizeReporterAgencyField(g.ic_name as unknown) ?? "—";
                const org = normalizeReporterOrgName(g.org_name as unknown);
                const titleFromCol = (g.project_title as string | null)?.trim() ?? "";
                const titleFromRaw =
                  !titleFromCol && g.raw_json && typeof g.raw_json === "object"
                    ? pickReporterProjectTitle(g.raw_json as Record<string, unknown>)
                    : "";
                const awardTitle = titleFromCol || titleFromRaw;
                return (
                  <li
                    key={`${g.project_num}-${g.fiscal_year}`}
                    className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-900">{g.project_num}</span>
                      <span className="text-slate-500">·</span>
                      <span>FY {g.fiscal_year}</span>
                      <span className="text-slate-500">·</span>
                      <Badge tone="neutral">{g.is_active ? "active" : "inactive"}</Badge>
                      <Badge tone="info">{g.match_confidence}</Badge>
                    </div>
                    {awardTitle ? (
                      <p className="mt-2 font-medium leading-snug text-slate-900">{awardTitle}</p>
                    ) : (
                      <p className="mt-2 text-xs italic text-slate-500">No title in cache</p>
                    )}
                    <p className="mt-1 text-sm text-slate-800">{institute}</p>
                    {org ? <p className="text-xs text-slate-600">{org}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Clinical trials (ClinicalTrials.gov cache)"
          description="Studies from the public API v2; name + UCSF facility search is medium confidence."
        />
        <CardBody>
          {(clinicalTrials ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">
              No cached trials — run Refresh ClinicalTrials.gov.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(clinicalTrials ?? []).map((t) => {
                const nctId = String(t.nct_id ?? "");
                const conditions = Array.isArray(t.conditions)
                  ? (t.conditions as string[]).filter(Boolean).slice(0, 3).join("; ")
                  : null;
                return (
                  <li key={nctId}>
                    <a
                      className="font-medium text-[var(--accent)] hover:underline"
                      href={`https://clinicaltrials.gov/study/${nctId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t.title || nctId}
                    </a>
                    <div className="text-xs text-slate-600">
                      {nctId}
                      {t.overall_status ? ` · ${t.overall_status}` : ""}
                      {conditions ? ` · ${conditions}` : ""}
                      {t.lead_sponsor ? ` · ${t.lead_sponsor}` : ""}
                      {" · "}
                      {formatDate(t.last_update_date ?? t.start_date ?? null)} · {t.match_confidence}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Collaboration signals (shared PubMed)"
          description="Co-authorship pairs derived from overlapping PMIDs across the directory."
        />
        <CardBody>
          {(relRows ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">
              No edges yet — refresh PubMed for multiple investigators, then run Recompute on
              Community overview.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(relRows ?? []).map((r) => {
                const other =
                  r.investigator_a_id === id ? r.investigator_b_id : r.investigator_a_id;
                return (
                  <li key={`${r.investigator_a_id}-${r.investigator_b_id}`}>
                    <Link
                      href={`/investigators/${other}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      View collaborator
                    </Link>{" "}
                    · {r.evidence_count} shared publication
                    {r.evidence_count === 1 ? "" : "s"} · strength{" "}
                    {Number(r.strength_score).toFixed(2)}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="AI-Assisted Matches profile"
          description="Canonical tags derived from CSV / profile fields (same dictionary as funding notices)."
        />
        <CardBody>
          <QuickMatchTagChips
            tags={{
              research_focal_areas: [...piQuick.researchPrimary, ...piQuick.researchSecondary],
              disease_areas: [...piQuick.diseasePrimary, ...piQuick.diseaseSecondary],
              technical_expertise: piQuick.technical,
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="AI-Assisted Matches — funding opportunities"
          description={`Top 10 notices by overlap, chosen from up to ${DEFAULT_MAX_NOFOS_PER_SYNC} recently posted rows in your database.`}
        />
        <CardBody>
          <QuickMatchOpportunityList items={quickOppRanked} />
        </CardBody>
      </Card>
    </div>
  );
}

function TagBlock({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">{label}</h3>
      <div className="mt-1 flex flex-wrap gap-1">
        {values.map((t) => (
          <Badge key={t} tone="info">
            {t.replaceAll("_", " ")}
          </Badge>
        ))}
      </div>
    </div>
  );
}
