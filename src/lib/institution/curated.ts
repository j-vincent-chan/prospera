/**
 * Curated Internal (UCSF) records and limited-submission overlays — read
 * models for the Opportunities scopes, the Curator form, Home, Calendar and
 * Opportunity Detail. RLS already hides drafts from non-curators; the
 * loaders additionally derive Published / Needs review / Draft / Closed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { agencyShortName } from "@/lib/opportunities/list-model";
import { cycleFactsFromRow, daysBetween, dueDisplay, fmtMonD, fmtMonDY, fmtMonY, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";
import { DERIVED_STATUS_LABEL, SOURCE_KIND_SHORT, derivedStatus, nominationClosed, overlayNominationLine, type CuratedKind, type CuratedStatus, type DerivedStatus, type ReviewProcess, type SourceKind } from "@/lib/institution/types";

export type CuratedRecord = {
  id: string;
  kind: CuratedKind;
  title: string;
  funder: string | null;
  award_summary: string | null;
  application_due: string | null;
  loi_due: string | null;
  eligibility: string | null;
  review_process: ReviewProcess | null;
  contact_name: string | null;
  contact_email: string | null;
  program_url: string | null;
  sponsor_notice_number: string | null;
  source_kind: SourceKind | null;
  source_url: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  review_by: string | null;
  status: CuratedStatus;
  published_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type OverlayRecord = {
  id: string;
  opportunity_id: string | null;
  curated_opportunity_id: string | null;
  internal_due: string | null;
  cap: number | null;
  nominated_count: number;
  interest_count: number;
  process: string | null;
  infoready_url: string | null;
  source_kind: SourceKind | null;
  source_url: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  review_by: string | null;
  status: CuratedStatus;
  published_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export const CURATED_COLUMNS = "id, kind, title, funder, award_summary, application_due, loi_due, eligibility, review_process, contact_name, contact_email, program_url, sponsor_notice_number, source_kind, source_url, verified_by, verified_by_name, verified_at, review_by, status, published_at, created_by, created_by_name, created_at, updated_at";
export const OVERLAY_COLUMNS = "id, opportunity_id, curated_opportunity_id, internal_due, cap, nominated_count, interest_count, process, infoready_url, source_kind, source_url, verified_by, verified_by_name, verified_at, review_by, status, published_at, created_by, created_by_name, created_at, updated_at";
const NOTICE_COLUMNS = "id, title, agency, agency_code, opportunity_number, activity_code, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, source_url, raw_payload_json";

export type NoticeSummary = { id: string; title: string; agencyShort: string; number: string | null; dueLabel: string; dueIso: string | null; dueTone: string; source: "simpler" | "nih_guide" | "other"; href: string };

export function noticeSummary(fo: Record<string, unknown>, today: string): NoticeSummary {
  const due = dueDisplay(cycleFactsFromRow(fo as unknown as CycleColumns), today);
  const src = String(fo.source_url ?? "");
  return {
    id: String(fo.id),
    title: String(fo.title ?? "Untitled notice"),
    agencyShort: agencyShortName((fo.agency as string | null) ?? null, (fo.agency_code as string | null) ?? null),
    number: (fo.opportunity_number as string | null) ?? null,
    dueLabel: due.date ? fmtMonDY(due.date) : due.primary,
    dueIso: due.date ?? null,
    dueTone: due.tone,
    source: /grants\.nih\.gov/i.test(src) ? "nih_guide" : /grants\.gov/i.test(src) ? "simpler" : "other",
    href: `/opportunities/${String(fo.id)}`,
  };
}

// ---------------------------------------------------------------------------
// Internal scope
// ---------------------------------------------------------------------------

export type InternalRow = {
  id: string;
  title: string;
  meta: string;
  prov: string;
  prov2: string;
  due: string;
  dueIso: string | null;
  status: DerivedStatus;
  statusLabel: string;
  action: { label: string; kind: "view" | "edit" | "reverify" };
  editHref: string;
  loi: string | null;
  record: CuratedRecord;
};

export function provenanceLines(rec: CuratedRecord | OverlayRecord, status: DerivedStatus, today: string): { prov: string; prov2: string } {
  if (status === "draft") return { prov: `Draft · ${rec.created_by_name ?? "a curator"}`, prov2: "Not visible to members until published" };
  const who = rec.source_kind === "rap" ? "RAP feed" : rec.verified_by_name ?? "a curator";
  const verified = rec.verified_at ? ` · verified ${fmtMonD(rec.verified_at.slice(0, 10), today)}` : "";
  const prov = `${who}${verified}`;
  if (status === "needs_review" && rec.review_by) return { prov, prov2: `Review date passed ${fmtMonD(rec.review_by, today)} · hidden from suggestions` };
  const src = rec.source_kind ? SOURCE_KIND_SHORT[rec.source_kind] : "Manual";
  const review = rec.review_by ? ` · review ${fmtMonY(rec.review_by)}` : "";
  return { prov, prov2: `${src}${review}` };
}

export function internalMeta(rec: CuratedRecord): string {
  return [rec.funder, rec.award_summary].filter(Boolean).join(" · ") || "Internal (UCSF) funding";
}

export function internalRow(rec: CuratedRecord, today: string, viewerIsCurator: boolean): InternalRow {
  const status = derivedStatus(rec, today);
  const { prov, prov2 } = provenanceLines(rec, status, today);
  const action: InternalRow["action"] = status === "draft" ? { label: "Edit", kind: "edit" } : status === "needs_review" && viewerIsCurator ? { label: "Re-verify", kind: "reverify" } : { label: "View", kind: "view" };
  return {
    id: rec.id,
    title: rec.title,
    meta: internalMeta(rec),
    prov,
    prov2,
    due: rec.application_due ? fmtMonDY(rec.application_due) : "—",
    dueIso: rec.application_due,
    status,
    statusLabel: DERIVED_STATUS_LABEL[status],
    action,
    editHref: `/curate?id=${rec.id}`,
    loi: rec.loi_due ? fmtMonDY(rec.loi_due) : null,
    record: rec,
  };
}

export type InternalScope = { rows: InternalRow[]; published: number; needsReview: number; drafts: number; closedHidden: number; lastVerifiedAt: string | null; rapCount: number; manualCount: number };

export async function loadInternalScope(db: SupabaseClient, opts: { today: string; viewerIsCurator: boolean }): Promise<InternalScope> {
  const { data } = await db.from("curated_opportunities").select(CURATED_COLUMNS).eq("kind", "internal").is("deleted_at", null).order("application_due", { ascending: true, nullsFirst: false });
  const recs = (data ?? []) as CuratedRecord[];
  const rows: InternalRow[] = [];
  let closedHidden = 0;
  for (const rec of recs) {
    const st = derivedStatus(rec, opts.today);
    if (st === "closed") {
      closedHidden += 1;
      continue;
    }
    if (st === "draft" && !opts.viewerIsCurator) continue;
    rows.push(internalRow(rec, opts.today, opts.viewerIsCurator));
  }
  const order: Record<DerivedStatus, number> = { published: 0, needs_review: 1, draft: 2, closed: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999") || a.title.localeCompare(b.title));
  const live = recs.filter((r) => derivedStatus(r, opts.today) !== "draft");
  return {
    rows,
    published: rows.filter((r) => r.status === "published").length,
    needsReview: rows.filter((r) => r.status === "needs_review").length,
    drafts: rows.filter((r) => r.status === "draft").length,
    closedHidden,
    lastVerifiedAt: live.map((r) => r.verified_at).filter((x): x is string => Boolean(x)).sort().slice(-1)[0] ?? null,
    rapCount: live.filter((r) => r.source_kind === "rap").length,
    manualCount: live.filter((r) => r.source_kind !== "rap").length,
  };
}

// ---------------------------------------------------------------------------
// Limited scope
// ---------------------------------------------------------------------------

export type LimitedRow = {
  id: string;
  title: string;
  meta: string;
  mark: "synced" | "curated";
  internal: { label: string; tone: "urgent" | "normal" | "muted" };
  internalIso: string | null;
  sponsorDue: string;
  sponsorDueIso: string | null;
  capLine: string;
  closed: boolean;
  passed: boolean;
  status: DerivedStatus;
  statusLabel: string;
  interested: boolean;
  canExpress: boolean;
  noticeHref: string | null;
  editHref: string;
  overlay: OverlayRecord;
  notice: NoticeSummary | null;
  curated: CuratedRecord | null;
};

export function internalDueLabel(iso: string | null, today: string): { label: string; tone: "urgent" | "normal" | "muted" } {
  if (!iso) return { label: "Not set", tone: "muted" };
  const d = daysBetween(today, iso);
  if (d < 0) return { label: `${fmtMonD(iso, today)} · passed`, tone: "muted" };
  if (d === 0) return { label: `${fmtMonD(iso, today)} · today`, tone: "urgent" };
  return { label: `${fmtMonD(iso, today)} · ${d} day${d === 1 ? "" : "s"}`, tone: d <= 30 ? "urgent" : "normal" };
}

export function limitedRow(o: OverlayRecord, notice: NoticeSummary | null, curated: CuratedRecord | null, opts: { today: string; interested: boolean; viewerIsCurator: boolean }): LimitedRow {
  const status = derivedStatus({ status: o.status, review_by: o.review_by }, opts.today);
  const internal = internalDueLabel(o.internal_due, opts.today);
  const passed = Boolean(o.internal_due && o.internal_due < opts.today);
  const closed = nominationClosed(o);
  const sponsorDueIso = notice?.dueIso ?? curated?.application_due ?? null;
  const title = notice?.title ?? curated?.title ?? "Sponsor notice";
  const meta = notice
    ? `${notice.agencyShort}${notice.number ? ` · ${notice.number}` : ""} · from ${notice.source === "nih_guide" ? "the NIH Guide" : "Simpler.Grants.gov"}`
    : `${curated?.funder ?? "Sponsor"}${curated?.sponsor_notice_number ? ` · ${curated.sponsor_notice_number}` : ""} · not in federal catalog`;
  return {
    id: o.id,
    title,
    meta,
    mark: notice ? "synced" : "curated",
    internal,
    internalIso: o.internal_due,
    sponsorDue: sponsorDueIso ? fmtMonDY(sponsorDueIso) : notice?.dueLabel ?? "—",
    sponsorDueIso,
    capLine: overlayNominationLine(o),
    closed,
    passed,
    status,
    statusLabel: DERIVED_STATUS_LABEL[status],
    interested: opts.interested,
    canExpress: status === "published" && !closed && !passed,
    noticeHref: notice?.href ?? null,
    editHref: `/curate?kind=limited&id=${o.id}`,
    overlay: o,
    notice,
    curated,
  };
}

export type LimitedScope = { rows: LimitedRow[]; count: number; drafts: number; needsReview: number; lastVerifiedAt: string | null };

export async function loadLimitedScope(db: SupabaseClient, opts: { today: string; viewerId: string | null; viewerIsCurator: boolean }): Promise<LimitedScope> {
  const { data } = await db.from("limited_submission_overlays").select(`${OVERLAY_COLUMNS}, funding_opportunities(${NOTICE_COLUMNS}), curated_opportunities(${CURATED_COLUMNS})`).is("deleted_at", null).order("internal_due", { ascending: true, nullsFirst: false });
  const raw = (data ?? []) as Array<Record<string, unknown>>;
  const ids = raw.map((r) => String(r.id));
  const { data: mine } = opts.viewerId && ids.length ? await db.from("limited_submission_interests").select("overlay_id").eq("user_id", opts.viewerId).is("withdrawn_at", null).in("overlay_id", ids) : { data: [] };
  const interested = new Set(((mine ?? []) as Array<{ overlay_id: string }>).map((m) => m.overlay_id));
  const rows: LimitedRow[] = [];
  for (const r of raw) {
    const o = r as unknown as OverlayRecord;
    const status = derivedStatus({ status: o.status, review_by: o.review_by }, opts.today);
    if (status === "draft" && !opts.viewerIsCurator) continue;
    const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
    const cu = (Array.isArray(r.curated_opportunities) ? r.curated_opportunities[0] : r.curated_opportunities) as CuratedRecord | null;
    rows.push(limitedRow(o, fo ? noticeSummary(fo, opts.today) : null, cu ?? null, { today: opts.today, interested: interested.has(o.id), viewerIsCurator: opts.viewerIsCurator }));
  }
  rows.sort((a, b) => Number(a.passed) - Number(b.passed) || Number(a.status === "draft") - Number(b.status === "draft") || (a.internalIso ?? "9999").localeCompare(b.internalIso ?? "9999"));
  return {
    rows,
    count: rows.filter((r) => r.status !== "draft").length,
    drafts: rows.filter((r) => r.status === "draft").length,
    needsReview: rows.filter((r) => r.status === "needs_review").length,
    lastVerifiedAt: rows.map((r) => r.overlay.verified_at).filter((x): x is string => Boolean(x)).sort().slice(-1)[0] ?? null,
  };
}

/** Opportunity ids that carry a published overlay — the "Limited submission" badge in Federal. */
export async function limitedOpportunityIds(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from("limited_submission_overlays").select("opportunity_id").eq("status", "published").is("deleted_at", null).not("opportunity_id", "is", null);
  return new Set(((data ?? []) as Array<{ opportunity_id: string }>).map((r) => r.opportunity_id));
}

export async function overlayForOpportunity(db: SupabaseClient, opportunityId: string, opts: { today: string; viewerId: string | null; viewerIsCurator: boolean }): Promise<LimitedRow | null> {
  const { data } = await db.from("limited_submission_overlays").select(`${OVERLAY_COLUMNS}, funding_opportunities(${NOTICE_COLUMNS})`).eq("opportunity_id", opportunityId).is("deleted_at", null).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const o = r as unknown as OverlayRecord;
  const status = derivedStatus({ status: o.status, review_by: o.review_by }, opts.today);
  if (status === "draft" && !opts.viewerIsCurator) return null;
  const { data: mine } = opts.viewerId ? await db.from("limited_submission_interests").select("id").eq("user_id", opts.viewerId).eq("overlay_id", o.id).is("withdrawn_at", null).maybeSingle() : { data: null };
  const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
  return limitedRow(o, fo ? noticeSummary(fo, opts.today) : null, null, { today: opts.today, interested: Boolean(mine), viewerIsCurator: opts.viewerIsCurator });
}

// ---------------------------------------------------------------------------
// Curator form loaders
// ---------------------------------------------------------------------------

export async function loadCuratedRecord(db: SupabaseClient, id: string): Promise<CuratedRecord | null> {
  const { data } = await db.from("curated_opportunities").select(CURATED_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as CuratedRecord | null) ?? null;
}

export async function loadOverlay(db: SupabaseClient, id: string, today: string): Promise<{ overlay: OverlayRecord; notice: NoticeSummary | null; curated: CuratedRecord | null } | null> {
  const { data } = await db.from("limited_submission_overlays").select(`${OVERLAY_COLUMNS}, funding_opportunities(${NOTICE_COLUMNS}), curated_opportunities(${CURATED_COLUMNS})`).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
  const cu = (Array.isArray(r.curated_opportunities) ? r.curated_opportunities[0] : r.curated_opportunities) as CuratedRecord | null;
  return { overlay: r as unknown as OverlayRecord, notice: fo ? noticeSummary(fo, today) : null, curated: cu ?? null };
}

/** Synced catalog search for the overlay picker: title or number, open/forecasted first. */
export async function searchCatalogNotices(db: SupabaseClient, q: string, today: string, limit = 8): Promise<NoticeSummary[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const pattern = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const { data } = await db.from("funding_opportunities").select(NOTICE_COLUMNS).or(`title.ilike.${pattern},opportunity_number.ilike.${pattern}`).order("close_date", { ascending: false, nullsFirst: true }).limit(limit * 3);
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((fo) => noticeSummary(fo, today));
  const rank = (t: string) => (t === "closed" ? 2 : t === "muted" ? 1 : 0);
  return rows.sort((a, b) => rank(a.dueTone) - rank(b.dueTone) || (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999")).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Live deadlines for Home and Calendar (published, current, not closed)
// ---------------------------------------------------------------------------

export type LiveDeadline = { key: string; kind: "internal_program" | "internal_loi" | "limited_nomination"; date: string; title: string; detail: string; href: string };

export async function liveInstitutionDeadlines(db: SupabaseClient, today: string, range: { from: string; to: string }): Promise<LiveDeadline[]> {
  const [{ data: internal }, { data: overlays }] = await Promise.all([
    db.from("curated_opportunities").select(CURATED_COLUMNS).eq("kind", "internal").eq("status", "published").is("deleted_at", null).gte("application_due", today),
    db.from("limited_submission_overlays").select(`${OVERLAY_COLUMNS}, funding_opportunities(id, title, agency, agency_code, opportunity_number), curated_opportunities(id, title, funder)`).eq("status", "published").is("deleted_at", null).gte("internal_due", range.from).lte("internal_due", range.to),
  ]);
  const out: LiveDeadline[] = [];
  const inRange = (d: string | null): d is string => Boolean(d && d >= range.from && d <= range.to);
  for (const rec of (internal ?? []) as CuratedRecord[]) {
    if (derivedStatus(rec, today) !== "published") continue;
    if (inRange(rec.application_due)) out.push({ key: `internal-${rec.id}`, kind: "internal_program", date: rec.application_due, title: rec.title, detail: `Internal (UCSF) program · ${rec.funder ?? "UCSF"}`, href: "/opportunities?scope=internal" });
    if (inRange(rec.loi_due)) out.push({ key: `internal-loi-${rec.id}`, kind: "internal_loi", date: rec.loi_due, title: rec.title, detail: `Letter of intent · ${rec.funder ?? "UCSF"}`, href: "/opportunities?scope=internal" });
  }
  for (const r of (overlays ?? []) as Array<Record<string, unknown>>) {
    const o = r as unknown as OverlayRecord;
    if (derivedStatus({ status: o.status, review_by: o.review_by }, today) !== "published" || !o.internal_due) continue;
    const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
    const cu = (Array.isArray(r.curated_opportunities) ? r.curated_opportunities[0] : r.curated_opportunities) as Record<string, unknown> | null;
    const title = String(fo?.title ?? cu?.title ?? "Limited submission");
    const sponsor = fo ? agencyShortName((fo.agency as string | null) ?? null, (fo.agency_code as string | null) ?? null) : String(cu?.funder ?? "Sponsor");
    out.push({ key: `limited-${o.id}`, kind: "limited_nomination", date: o.internal_due, title, detail: `Internal nomination due · ${sponsor} · ${overlayNominationLine(o)}`, href: fo ? `/opportunities/${String(fo.id)}` : "/opportunities?scope=limited" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
