/**
 * Data sources (Team settings): per-source health from the sync log and the
 * sources model. A source is Degraded after one failed run and Failing after
 * two in a row; Manual and Not connected are states, not failures.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SourceStatus = "healthy" | "degraded" | "failing" | "manual" | "not_connected";

export type SourceRow = {
  key: "simpler" | "pubmed" | "reporter" | "profiles" | "orcid" | "biosketches" | "osr" | "rap" | "infoready" | "email";
  name: string;
  what: string;
  status: SourceStatus;
  statusLabel: string;
  coverage: string;
  last: string;
  next: string;
  action: { kind: "sync_simpler" | "retry_pubmed" | "refresh_connectors" | "link" | "send_test" | "none"; label: string; href?: string; primary?: boolean };
};

export type RunRow = { id: string; when: string; what: string; result: "OK" | "Failed" | "Degraded" | "Running"; tone: "ok" | "bad" | "warn" };

export type SourceHealth = {
  summary: string;
  stale: { hours: number; failures: number; since: string; error: string | null } | null;
  sources: SourceRow[];
  runs: RunRow[];
};

const STATUS_LABEL: Record<SourceStatus, string> = { healthy: "Healthy", degraded: "Degraded", failing: "Failing", manual: "Manual", not_connected: "Not connected" };

const JOB_NAME: Record<string, string> = {
  simpler_grants_sync: "Simpler.Grants.gov",
  nih_guide: "NIH Guide",
  investigator_sources: "Investigator sources",
  opportunity_embeddings: "Notice index",
  outreach_suggestions: "Suggestions",
  annotation: "Portfolio annotation",
};

export function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) === today.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  return `${sameDay ? "Today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })} · ${time}`;
}

type Log = { id: string; job_type: string; status: string; message: string | null; details: Record<string, unknown> | null; started_at: string; finished_at: string | null };

function statusFromRuns(runs: Log[]): SourceStatus {
  const finished = runs.filter((r) => r.status !== "started");
  if (!finished.length) return "not_connected";
  if (finished[0]!.status === "error") return finished[1]?.status === "error" ? "failing" : "degraded";
  return "healthy";
}

export async function sourceHealth(db: SupabaseClient): Promise<SourceHealth> {
  const [{ data: logs }, { count: notices }, { count: forecasted }, { count: withCycles }, { data: sources }, { count: sentWeek }, { count: failedWeek }, { count: repliesWeek }, { count: osrAwards }, { count: reporterAwards }, { data: lastBatch }, { data: declineAgg }, { data: curatedRows }, { data: overlayRows }] = await Promise.all([
    db.from("sync_job_logs").select("id, job_type, status, message, details, started_at, finished_at").order("started_at", { ascending: false }).limit(120),
    db.from("funding_opportunities").select("id", { count: "exact", head: true }),
    db.from("funding_opportunities").select("id", { count: "exact", head: true }).eq("forecasted", true),
    db.from("funding_opportunities").select("id", { count: "exact", head: true }).eq("cycles_source", "nih_guide"),
    db.from("investigator_sources").select("source, state, identity_method, last_refreshed_at, last_attempted_at, external_id"),
    db.from("outreach_message_recipients").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
    db.from("outreach_message_recipients").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db.from("outreach_recipients").select("id", { count: "exact", head: true }).like("status", "replied_%").gte("replied_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
    db.from("osr_awards").select("id", { count: "exact", head: true }).eq("source", "osr"),
    db.from("osr_awards").select("id", { count: "exact", head: true }).eq("source", "reporter"),
    db.from("osr_import_batches").select("kind, created_at, imported_by_name").order("created_at", { ascending: false }).limit(1),
    db.rpc("osr_success_rates", {}),
    db.from("curated_opportunities").select("id, kind, status, source_kind, review_by, application_due, verified_at").is("deleted_at", null),
    db.from("limited_submission_overlays").select("id, status, review_by, verified_at").is("deleted_at", null),
  ]);
  const declines = ((declineAgg ?? []) as Array<{ declined: number }>).reduce((n, r) => n + Number(r.declined), 0);
  const batch = ((lastBatch ?? []) as Array<{ kind: string; created_at: string; imported_by_name: string | null }>)[0] ?? null;
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const curated = ((curatedRows ?? []) as Array<{ kind: string; status: string; source_kind: string | null; review_by: string | null; application_due: string | null; verified_at: string | null }>).filter((c) => c.kind === "internal");
  const curatedLive = curated.filter((c) => c.status === "published" && (!c.application_due || c.application_due >= todayIso));
  const curatedNeedsReview = curatedLive.filter((c) => c.review_by && c.review_by < todayIso).length;
  const overlays = (overlayRows ?? []) as Array<{ status: string; review_by: string | null; verified_at: string | null }>;
  const overlaysLive = overlays.filter((o) => o.status === "published");
  const overlaysNeedsReview = overlaysLive.filter((o) => o.review_by && o.review_by < todayIso).length;
  const lastVerified = (rows: Array<{ verified_at: string | null }>) => rows.map((r) => r.verified_at).filter((x): x is string => Boolean(x)).sort().slice(-1)[0] ?? null;
  const all = (logs ?? []) as Log[];
  const byJob = (job: string) => all.filter((l) => l.job_type === job);
  const simpler = byJob("simpler_grants_sync");
  const invJobs = byJob("investigator_sources");
  const src = (sources ?? []) as Array<{ source: string; state: string; identity_method: string | null; last_refreshed_at: string | null; last_attempted_at: string | null; external_id: string | null }>;
  const of = (k: string) => src.filter((s) => s.source === k);
  const pub = of("pubmed");
  const rep = of("reporter");
  const prof = of("profiles");
  const orc = of("orcid");
  const bio = of("biosketch");
  const people = new Set(src.map((s) => s.source === "reporter" ? s : null).filter(Boolean)).size || rep.length;

  const lastOkSimpler = simpler.find((s) => s.status === "success");
  const lastSimplerAt = lastOkSimpler?.finished_at ?? lastOkSimpler?.started_at ?? null;
  const hours = lastSimplerAt ? Math.floor((Date.now() - new Date(lastSimplerAt).getTime()) / 3_600_000) : null;
  const recentFailures = simpler.filter((s) => s.status === "error" && (!lastSimplerAt || s.started_at > lastSimplerAt)).length;
  const simplerStatus = statusFromRuns(simpler) === "not_connected" ? "not_connected" : hours != null && hours >= 24 ? "failing" : statusFromRuns(simpler);
  const stale = hours != null && hours >= 24 ? { hours, failures: recentFailures, since: new Date(lastSimplerAt!).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" }), error: simpler.find((s) => s.status === "error")?.message ?? null } : null;

  const pubErrors = pub.filter((s) => s.state === "error").length;
  const pubNever = pub.filter((s) => !s.last_refreshed_at).length;
  const invStatus = statusFromRuns(invJobs);
  const nightly = "Next 1:00 AM PT · nightly";
  const emailReady = Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
  const fromAddress = (process.env.RESEND_FROM_EMAIL ?? "").replace(/^.*<([^>]+)>.*$/, "$1") || "not configured";

  const base: Array<Omit<SourceRow, "statusLabel">> = [
    { key: "simpler", name: "Simpler.Grants.gov", what: "Funding notices, receipt cycles, attachments and eligibility text. The catalog every team shares.", status: simplerStatus, coverage: `${(notices ?? 0).toLocaleString("en-US")} notices · ${(forecasted ?? 0).toLocaleString("en-US")} forecasted · ${(withCycles ?? 0).toLocaleString("en-US")} with cycles`, last: fmtWhen(simpler[0]?.finished_at ?? simpler[0]?.started_at ?? null), next: nightly, action: { kind: "sync_simpler", label: stale ? "Retry now" : "Sync now", primary: Boolean(stale) } },
    { key: "pubmed", name: "PubMed", what: "Publications matched to investigators by affiliation, ORCID or name. Drives research-alignment reasons.", status: pubErrors ? (invStatus === "failing" ? "failing" : "degraded") : invStatus === "not_connected" && !pub.some((s) => s.last_refreshed_at) ? "not_connected" : "healthy", coverage: `${pub.filter((s) => s.last_refreshed_at).length} of ${pub.length} profiles${pubErrors ? ` · ${pubErrors} profile${pubErrors === 1 ? "" : "s"} failing` : ""}${pubNever ? ` · ${pubNever} never fetched` : ""}`, last: fmtWhen(invJobs[0]?.finished_at ?? invJobs[0]?.started_at ?? null), next: nightly, action: pubErrors ? { kind: "retry_pubmed", label: `Retry ${pubErrors} failed` } : { kind: "link", label: "Review profiles", href: "/investigators?sources=missing_pubmed" } },
    { key: "reporter", name: "NIH RePORTER", what: "Awards, mechanisms and roles, matched by RePORTER profile ID only.", status: rep.some((s) => s.state === "error") ? "degraded" : "healthy", coverage: `${rep.filter((s) => s.identity_method === "profile_id").length} linked · ${rep.filter((s) => s.identity_method !== "profile_id").length} without a profile ID`, last: fmtWhen(invJobs[0]?.finished_at ?? invJobs[0]?.started_at ?? null), next: nightly, action: { kind: "link", label: "Review missing IDs", href: "/investigators?sources=missing_reporter" } },
    { key: "profiles", name: "UCSF Profiles", what: "Titles, departments, appointments and research interests for all faculty. Fixes ‘rank not on file’ and lets suggestions cover the campus.", status: prof.some((s) => s.state === "available") ? (prof.some((s) => s.state === "error") ? "degraded" : "healthy") : "not_connected", coverage: `${prof.filter((s) => s.state === "available").length} matched · ${prof.filter((s) => s.state !== "available" && s.last_attempted_at).length} no page found · ${prof.filter((s) => !s.last_attempted_at).length} not tried`, last: fmtWhen(prof.map((s) => s.last_refreshed_at).filter(Boolean).sort().slice(-1)[0] ?? null), next: "Nightly with the source refresh", action: { kind: "refresh_connectors", label: prof.some((s) => s.state === "available") ? "Refresh connectors" : "Connect", primary: !prof.some((s) => s.state === "available") } },
    { key: "orcid", name: "ORCID", what: "Author identifiers that remove name ambiguity in PubMed.", status: orc.some((s) => s.state === "available") ? "healthy" : "not_connected", coverage: `${orc.filter((s) => s.external_id).length} linked · ${orc.filter((s) => !s.external_id).length} unlinked`, last: fmtWhen(orc.map((s) => s.last_refreshed_at).filter(Boolean).sort().slice(-1)[0] ?? null), next: "Nightly with the source refresh", action: { kind: "refresh_connectors", label: "Look up unlinked" } },
    { key: "biosketches", name: "Biosketches", what: "Authorized documents from investigators. Excerpts visible to team members only; never leave the workspace.", status: "healthy", coverage: `${bio.filter((s) => s.state === "on_file").length} on file · ${bio.filter((s) => s.state === "requested").length} request${bio.filter((s) => s.state === "requested").length === 1 ? "" : "s"} pending · ${bio.filter((s) => s.state === "declined").length} declined`, last: fmtWhen(bio.map((s) => s.last_refreshed_at).filter(Boolean).sort().slice(-1)[0] ?? null), next: "On upload", action: { kind: "link", label: "View requests", href: "/investigators?sources=no_biosketch" } },
    { key: "osr", name: "OSR awards & declines", what: "UCSF award history and aggregated decline counts from the Office of Sponsored Research. Powers Awards and the track-record panel. No OSR API: stewards import OSR's export; NIH RePORTER (public) fills in awards meanwhile.", status: (osrAwards ?? 0) > 0 ? (byJob("osr_awards").some((l) => l.status === "error") ? "degraded" : "healthy") : (reporterAwards ?? 0) > 0 ? "manual" : "not_connected", coverage: `${(osrAwards ?? 0).toLocaleString("en-US")} OSR-verified · ${declines.toLocaleString("en-US")} declines (counted only) · ${(reporterAwards ?? 0).toLocaleString("en-US")} from NIH RePORTER`, last: batch ? `${fmtWhen(batch.created_at)} · ${batch.kind === "osr_export" ? "OSR export" : "RePORTER sync"}${batch.imported_by_name ? ` · ${batch.imported_by_name}` : ""}` : "—", next: "RePORTER weekly (Sun 3:00 AM PT) · OSR export when stewards import one", action: { kind: "link", label: (osrAwards ?? 0) + (reporterAwards ?? 0) > 0 ? "Open Awards" : "Import or sync", href: "/library/awards", primary: (osrAwards ?? 0) + (reporterAwards ?? 0) === 0 } },
    { key: "rap", name: "RAP (internal funding)", what: "Resource Allocation Program announcements, published to the Internal (UCSF) scope as Curated records. No feed confirmed: curators enter each cycle with the RAP announcement as its source.", status: curatedLive.length ? (curatedNeedsReview ? "degraded" : "manual") : "not_connected", coverage: curatedLive.length ? `${curatedLive.length} internal program${curatedLive.length === 1 ? "" : "s"} published · ${curatedLive.filter((c) => c.source_kind === "rap").length} from RAP${curatedNeedsReview ? ` · ${curatedNeedsReview} need${curatedNeedsReview === 1 ? "s" : ""} review` : ""}` : "No internal programs curated yet", last: fmtWhen(lastVerified(curatedLive)), next: "Curators re-verify by each record's review-by date", action: { kind: "link", label: curatedLive.length ? "Open Internal scope" : "Curate", href: curatedLive.length ? "/opportunities?scope=internal" : "/curate" } },
    { key: "infoready", name: "InfoReady (limited submissions)", what: "No API confirmed. Curators re-key competitions as overlays on synced sponsor notices.", status: overlaysLive.length ? (overlaysNeedsReview ? "degraded" : "manual") : "manual", coverage: overlaysLive.length ? `${overlaysLive.length} overlay${overlaysLive.length === 1 ? "" : "s"} published${overlaysNeedsReview ? ` · ${overlaysNeedsReview} need${overlaysNeedsReview === 1 ? "s" : ""} review` : ""}` : "No overlays published yet", last: fmtWhen(lastVerified(overlaysLive)), next: "Check weekly", action: { kind: "link", label: "Open InfoReady", href: "https://ucsf.infoready4.com/" } },
    { key: "email", name: "Email delivery", what: `${fromAddress} · sent as “Name via Prospera” · reply-to the team inbox.`, status: emailReady ? "healthy" : "not_connected", coverage: `${sentWeek ?? 0} sent this week · ${failedWeek ?? 0} failed · ${repliesWeek ?? 0} repl${repliesWeek === 1 ? "y" : "ies"} recorded`, last: fmtWhen(null), next: "Continuous", action: { kind: "send_test", label: "Send test" } },
  ];
  const rows: SourceRow[] = base.map((r) => ({ ...r, statusLabel: STATUS_LABEL[r.status] }));

  const failing = rows.filter((r) => r.status === "failing").length;
  const degraded = rows.filter((r) => r.status === "degraded").length;
  const healthy = rows.filter((r) => r.status === "healthy").length;
  const notConnected = rows.filter((r) => r.status === "not_connected").length;
  const manual = rows.filter((r) => r.status === "manual").length;
  const summary = [failing ? `${failing} failing` : null, degraded ? `${degraded} degraded` : null, `${healthy} healthy`, manual ? `${manual} manual` : null, notConnected ? `${notConnected} not connected` : null, "nightly at 1:00 AM PT"].filter(Boolean).join(" · ");

  const runs: RunRow[] = all.slice(0, 40).map((l) => ({
    id: l.id,
    when: fmtWhen(l.finished_at ?? l.started_at),
    what: `${JOB_NAME[l.job_type] ?? l.job_type} · ${(l.message ?? "").split("\n")[0]?.slice(0, 140) || (l.status === "started" ? "running" : "no details")}`,
    result: l.status === "error" ? "Failed" : l.status === "started" ? "Running" : /failed|degraded|rate-limit/i.test(l.message ?? "") && /[1-9]\d* failed/.test(l.message ?? "") ? "Degraded" : "OK",
    tone: l.status === "error" ? "bad" : /[1-9]\d* failed/.test(l.message ?? "") ? "warn" : "ok",
  }));

  void people;
  return { summary, stale, sources: rows, runs };
}
