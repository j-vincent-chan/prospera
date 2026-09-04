/**
 * Investigator sources model (Investigators v2).
 *
 * One row per (investigator, source). The row stores what was written at
 * refresh time; everything that depends on "now" — stale, updated this week,
 * the relative refresh phrase — is derived here so it never goes out of date.
 * Copy follows Investigators v2 exactly; add a state here, not in a component.
 */

export type SourceKey = "reporter" | "pubmed" | "biosketch" | "orcid" | "profiles";

export const SOURCE_KEYS: SourceKey[] = ["reporter", "pubmed", "biosketch", "orcid", "profiles"];

/** The three sources shown as chips in the directory table. */
export const CHIP_SOURCES: Array<"reporter" | "pubmed" | "biosketch"> = ["reporter", "pubmed", "biosketch"];

export type SourceState =
  | "available"
  | "unavailable"
  | "error"
  | "not_requested"
  | "requested"
  | "on_file"
  | "declined"
  | "revoked";

/**
 * How a source was tied to the person. `initials` and `reporter_link` are the
 * PubMed identity-ladder rungs added in PR 0.1b (migration
 * 20260911100000_pubmed_identity_ladder.sql extends the CHECKs).
 */
export type IdentityMethod =
  | "profile_id"
  | "orcid"
  | "affiliation"
  | "profiles"
  | "name_only"
  | "manual"
  | "self"
  | "initials"
  | "reporter_link";

export type IdentityStatus = "verified" | "unverified" | "rejected";

export type BiosketchContribution = { title: string; summary: string };

export type InvestigatorSourceRow = {
  investigator_id: string;
  source: SourceKey;
  state: SourceState;
  item_count: number;
  unverified_count: number;
  identity_method: IdentityMethod | null;
  external_id: string | null;
  external_url: string | null;
  last_refreshed_at: string | null;
  last_attempted_at: string | null;
  last_error: string | null;
  document_date: string | null;
  written_for: string | null;
  authorized_at: string | null;
  authorized_by: string | null;
  revoked_at: string | null;
  requested_at: string | null;
  reminder_sent_at: string | null;
  declined_at: string | null;
  storage_path: string | null;
  personal_statement: string | null;
  contributions: BiosketchContribution[] | null;
  meta: Record<string, unknown> | null;
};

export const SOURCE_LABEL: Record<SourceKey, string> = {
  reporter: "RePORTER",
  pubmed: "PubMed",
  biosketch: "Biosketch",
  orcid: "ORCID",
  profiles: "UCSF Profiles",
};

export const SOURCE_POP_TITLE: Record<SourceKey, string> = {
  reporter: "NIH RePORTER · funded research",
  pubmed: "PubMed · publications",
  biosketch: "NIH Biosketch · self-described expertise",
  orcid: "ORCID · works and affiliations",
  profiles: "UCSF Profiles · institutional profile",
};

/** Older than this and a fetched source reads as stale. */
export const STALE_AFTER_DAYS = 365;
/** Refreshed within this window earns the teal dot. */
export const RECENT_WITHIN_DAYS = 7;
/** A biosketch document older than this may not reflect current directions. */
export const BIOSKETCH_STALE_AFTER_MONTHS = 24;

export const IDENTITY_METHOD_LABEL: Record<IdentityMethod, string> = {
  profile_id: "profile ID",
  orcid: "ORCID",
  affiliation: "affiliation",
  profiles: "UCSF Profiles",
  name_only: "name-only",
  manual: "confirmed by you",
  self: "self-reported",
  initials: "initials + affiliation",
  reporter_link: "RePORTER-linked",
};

/** Methods the README treats as verified identity evidence. */
export function isVerifiedMethod(method: IdentityMethod | null | undefined): boolean {
  return (
    method === "profile_id" ||
    method === "orcid" ||
    method === "affiliation" ||
    method === "profiles" ||
    method === "manual" ||
    method === "initials" ||
    method === "reporter_link"
  );
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MON_D = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MON_D_Y = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MON_Y = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function parse(iso: string): Date {
  // Date-only values are read as UTC midnight so they never shift a day.
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
}

export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - parse(iso).getTime()) / 86_400_000);
}

export function monthsSince(iso: string, now: Date): number {
  const d = parse(iso);
  return (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
}

export function fmtMonD(iso: string): string {
  return MON_D.format(parse(iso));
}
export function fmtMonDYear(iso: string): string {
  return MON_D_Y.format(parse(iso));
}
export function fmtMonYear(iso: string): string {
  return MON_Y.format(parse(iso));
}

/** "2 days ago" inside the recent window, "Aug 20" this year, "Aug 20, 2025" otherwise. */
export function refreshedPhrase(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < RECENT_WITHIN_DAYS) return `${days} days ago`;
  return parse(iso).getUTCFullYear() === now.getUTCFullYear() ? fmtMonD(iso) : fmtMonDYear(iso);
}

/** "Jun 2025 (14 months ago)" — the stale form. */
export function staleRefreshedPhrase(iso: string, now: Date): string {
  const months = monthsSince(iso, now);
  return `${fmtMonYear(iso)} (${months} month${months === 1 ? "" : "s"} ago)`;
}

// ---------------------------------------------------------------------------
// Display model
// ---------------------------------------------------------------------------

/** Chip colour family. Colour never carries the state alone: `stateLabel` is always rendered. */
export type SourceVisual = "ok" | "stale" | "none";

export type SourceActionKind =
  | "refresh"
  | "retry"
  | "fetch_pubmed"
  | "add_profile_id"
  | "add_email"
  | "add_orcid"
  | "connect_profiles"
  | "request_biosketch"
  | "send_reminder"
  | "request_update"
  | "review_identity"
  | "open_profile";

export type SourceAction = { kind: SourceActionKind; label: string };

export type SourceEvidenceItem = { heading: string; sub: string };

export type SourceChipModel = {
  key: SourceKey;
  label: string;
  /** "(3)", "(2025)" or "(—)". */
  count: string;
  visual: SourceVisual;
  /** Refreshed within the last week — teal dot. */
  recent: boolean;
  /** Available · Updated this week · Stale · Unavailable. */
  stateLabel: "Available" | "Updated this week" | "Stale" | "Unavailable";
  /** Tooltip on the chip. */
  title: string;
  popTitle: string;
  meta: string;
  /** Set when part of the evidence is name-only and unverified. */
  flag: string | null;
  items: SourceEvidenceItem[];
  /** Shown instead of items when there is nothing to list. */
  empty: string | null;
  action: SourceAction;
};

export type GrantEvidence = {
  project_num: string;
  project_title: string | null;
  ic_name: string | null;
  fiscal_year: number | null;
  is_active: boolean | null;
  start: string | null;
  end: string | null;
  role: string | null;
  identity_status: IdentityStatus;
};

export type PublicationEvidence = {
  pmid: string;
  title: string | null;
  journal: string | null;
  publication_date: string | null;
  identity_method: IdentityMethod;
  identity_status: IdentityStatus;
};

export type SourceContext = {
  now: Date;
  fullName: string;
  lastName: string;
  email: string | null;
  nihProfileId: string | null;
  orcid: string | null;
  /** How the person entered the directory, e.g. "CSV import" — used in the never-fetched copy. */
  addedVia: string | null;
  addedAt: string | null;
  grants: GrantEvidence[];
  publications: PublicationEvidence[];
  /** Replied Interested to a notice recently (Outreach, step 5). */
  repliedInterestedAt: string | null;
};

const honorific = (lastName: string) => `Dr. ${lastName}`;

/** "NIAID — National Institute…" → "NIAID". */
export function shortIc(ic: string | null): string | null {
  if (!ic) return null;
  return ic.split(/\s+[—–-]\s+/)[0]?.trim() || ic;
}

function yearOf(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})/);
  return m ? m[1]! : null;
}

export function grantItem(g: GrantEvidence): SourceEvidenceItem {
  const heading = [g.project_num, g.project_title?.trim() || null].filter(Boolean).join(" · ");
  const years = [yearOf(g.start), yearOf(g.end)].filter(Boolean).join("–") || (g.fiscal_year ? `FY ${g.fiscal_year}` : null);
  const status = g.is_active === false ? "completed" : g.role;
  const sub = [shortIc(g.ic_name), years, status].filter(Boolean).join(" · ");
  return { heading, sub };
}

export function publicationItem(p: PublicationEvidence, mixed: boolean): SourceEvidenceItem {
  const when = p.publication_date ? (daysSinceIsRecent(p.publication_date) ? fmtMonYear(p.publication_date) : yearOf(p.publication_date)) : null;
  const identity =
    p.identity_status === "unverified"
      ? "name-only · confirm or reject on the profile"
      : mixed
        ? "verified"
        : null;
  return {
    heading: p.title?.trim() || `PMID ${p.pmid}`,
    sub: [p.journal, when, identity].filter(Boolean).join(" · "),
  };
}

function daysSinceIsRecent(iso: string): boolean {
  const d = parse(iso);
  const months = (new Date().getUTCFullYear() - d.getUTCFullYear()) * 12 + (new Date().getUTCMonth() - d.getUTCMonth());
  return months <= 18;
}

type Freshness = { visual: SourceVisual; recent: boolean; stateLabel: SourceChipModel["stateLabel"]; refreshed: string | null; stale: boolean };

function freshness(row: InvestigatorSourceRow, now: Date): Freshness {
  const iso = row.last_refreshed_at;
  if (!iso) return { visual: "none", recent: false, stateLabel: "Unavailable", refreshed: null, stale: false };
  const days = daysSince(iso, now);
  if (days > STALE_AFTER_DAYS) return { visual: "stale", recent: false, stateLabel: "Stale", refreshed: staleRefreshedPhrase(iso, now), stale: true };
  const recent = days < RECENT_WITHIN_DAYS;
  return { visual: "ok", recent, stateLabel: recent ? "Updated this week" : "Available", refreshed: refreshedPhrase(iso, now), stale: false };
}

const failing = "the nightly refresh is failing for this profile";

function reporterChip(row: InvestigatorSourceRow, ctx: SourceContext): SourceChipModel {
  const base = { key: "reporter" as const, label: SOURCE_LABEL.reporter, popTitle: SOURCE_POP_TITLE.reporter, flag: null };
  const profileId = ctx.nihProfileId?.trim() || null;

  if (!profileId) {
    const added = ctx.addedVia && ctx.addedAt ? ` Added ${fmtMonYear(ctx.addedAt)} by ${ctx.addedVia}.` : "";
    return {
      ...base,
      count: "(—)",
      visual: "none",
      recent: false,
      stateLabel: "Unavailable",
      meta: "No profile ID on file",
      title: `${SOURCE_LABEL.reporter} · Unavailable · No profile ID on file`,
      items: [],
      empty: row.last_refreshed_at || ctx.grants.length
        ? "Awards can’t be matched without a RePORTER profile ID. Add it from the profile page; the nightly refresh does the rest."
        : `Nothing fetched yet.${added || " Awards can’t be matched without a RePORTER profile ID."}`,
      action: { kind: "add_profile_id", label: "Add profile ID" },
    };
  }

  const f = freshness(row, ctx.now);
  const grants = ctx.grants.filter((g) => g.identity_status !== "rejected");
  const n = grants.length;

  if (!row.last_refreshed_at) {
    return {
      ...base,
      count: "(—)",
      visual: "none",
      recent: false,
      stateLabel: "Unavailable",
      meta: row.state === "error" && row.last_error ? `Profile ID ${profileId} · ${failing}` : `Profile ID ${profileId} · never fetched`,
      title: `${SOURCE_LABEL.reporter} · Unavailable · Profile ID ${profileId} · never fetched`,
      items: [],
      empty: row.state === "error"
        ? `RePORTER could not be reached for profile ID ${profileId}. ${row.last_error ?? ""}`.trim()
        : "RePORTER hasn’t been queried for this profile ID yet. Fetching takes a few seconds and runs nightly afterwards.",
      action: row.state === "error" ? { kind: "retry", label: "Retry refresh" } : { kind: "refresh", label: "Fetch RePORTER" },
    };
  }

  const refreshedPart = f.stale ? `last refreshed ${f.refreshed}` : `refreshed ${f.refreshed}`;
  const errorPart = row.state === "error" ? ` · ${failing}` : "";
  const meta = n === 0
    ? `Matched by profile ID · no projects found · ${refreshedPart}${errorPart}`
    : `Matched by profile ID · ${refreshedPart}${errorPart}`;
  return {
    ...base,
    count: n === 0 ? "(0)" : `(${n})`,
    visual: n === 0 && !f.stale ? "ok" : f.visual,
    recent: f.recent,
    stateLabel: f.stateLabel,
    meta,
    title: `${SOURCE_LABEL.reporter} · ${f.stateLabel} · ${meta}`,
    items: grants.slice(0, 3).map(grantItem),
    empty: n === 0 ? `RePORTER lists no projects for profile ID ${profileId}. Check the ID on the profile page.` : null,
    action: row.state === "error" ? { kind: "retry", label: "Retry refresh" } : { kind: "refresh", label: "Refresh now" },
  };
}

function pubmedChip(row: InvestigatorSourceRow, ctx: SourceContext): SourceChipModel {
  const base = { key: "pubmed" as const, label: SOURCE_LABEL.pubmed, popTitle: SOURCE_POP_TITLE.pubmed };
  const pubs = ctx.publications.filter((p) => p.identity_status !== "rejected");
  const verified = pubs.filter((p) => p.identity_status === "verified");
  const unverified = pubs.filter((p) => p.identity_status === "unverified");

  if (!row.last_refreshed_at) {
    const errored = row.state === "error";
    return {
      ...base,
      flag: null,
      count: "(—)",
      visual: "none",
      recent: false,
      stateLabel: "Unavailable",
      meta: errored ? `Never fetched · ${failing}` : "Never fetched",
      title: `${SOURCE_LABEL.pubmed} · Unavailable · Never fetched`,
      items: [],
      empty: errored
        ? `PubMed could not be queried for this profile. ${row.last_error ?? ""}`.trim()
        : "PubMed hasn’t been queried for this profile. Fetching takes about a minute and runs nightly afterwards.",
      action: errored ? { kind: "retry", label: "Retry refresh" } : { kind: "fetch_pubmed", label: "Fetch PubMed" },
    };
  }

  const f = freshness(row, ctx.now);
  const n = verified.length;
  const refreshedPart = f.stale ? `last refreshed ${f.refreshed}` : `refreshed ${f.refreshed}`;
  const errorPart = row.state === "error" ? ` · ${failing}` : "";

  // Composition of the evidence, e.g. "40 affiliation-matched, 2 name-only".
  const byMethod = new Map<IdentityMethod, number>();
  for (const p of verified) byMethod.set(p.identity_method, (byMethod.get(p.identity_method) ?? 0) + 1);
  const methodParts: string[] = [];
  for (const m of ["affiliation", "orcid", "profiles", "manual"] as IdentityMethod[]) {
    const c = byMethod.get(m);
    if (c) methodParts.push(`${c} ${m === "manual" ? "confirmed by you" : `${IDENTITY_METHOD_LABEL[m]}-matched`}`);
  }
  if (unverified.length) methodParts.push(`${unverified.length} name-only`);
  const composition =
    n === 0 && unverified.length === 0
      ? "No affiliation-matched publications"
      : methodParts.length === 1 && unverified.length === 0
        ? n === 1 ? "1 publication · affiliation-matched" : `${n} publications · all ${methodParts[0]!.replace(/^\d+\s+/, "")}`
        : `${n + unverified.length} matched · ${methodParts.join(", ")}`;

  const flag = unverified.length
    ? `${unverified.length} of ${n + unverified.length} match${n + unverified.length === 1 ? " is" : "es are"} name-only and unverified`
    : null;
  const meta = `${composition} · ${refreshedPart}${errorPart}`;
  const mixed = unverified.length > 0;
  const items = [...verified.slice(0, mixed ? 1 : 2), ...unverified.slice(0, 1)].map((p) => publicationItem(p, mixed));

  return {
    ...base,
    flag,
    count: n === 0 && unverified.length === 0 ? "(0)" : `(${n})`,
    visual: f.visual === "none" ? "ok" : f.visual,
    recent: f.recent,
    stateLabel: f.stateLabel,
    meta,
    title: `${SOURCE_LABEL.pubmed} · ${f.stateLabel}${flag ? ` · ${flag}` : ""} · ${meta}`,
    items,
    empty: n === 0 && unverified.length === 0
      ? `PubMed returned no publications matching ${ctx.fullName} with a UCSF affiliation on the same author entry.`
      : null,
    action:
      row.state === "error"
        ? { kind: "retry", label: "Retry refresh" }
        : unverified.length
          ? { kind: "review_identity", label: "Review identity" }
          : { kind: "refresh", label: "Refresh now" },
  };
}

function biosketchChip(row: InvestigatorSourceRow, ctx: SourceContext): SourceChipModel {
  const base = { key: "biosketch" as const, label: SOURCE_LABEL.biosketch, popTitle: SOURCE_POP_TITLE.biosketch, flag: null, recent: false };
  const who = honorific(ctx.lastName);
  const none = (meta: string, empty: string, action: SourceAction): SourceChipModel => ({
    ...base,
    count: "(—)",
    visual: "none",
    stateLabel: "Unavailable",
    meta,
    title: `${SOURCE_LABEL.biosketch} · Unavailable · ${meta}`,
    items: [],
    empty,
    action,
  });

  switch (row.state) {
    case "on_file": {
      const docYear = row.document_date ? yearOf(row.document_date) : null;
      const stale = row.document_date ? monthsSince(row.document_date, ctx.now) > BIOSKETCH_STALE_AFTER_MONTHS : false;
      const authorized = row.authorized_at
        ? `authorized${row.authorized_by ? ` by ${row.authorized_by}` : ""} ${stale ? fmtMonYear(row.authorized_at) : fmtMonDYear(row.authorized_at)}`
        : null;
      const meta = [
        row.document_date ? `Document dated ${fmtMonYear(row.document_date)}` : "Document on file",
        authorized,
        row.written_for ? `written for ${row.written_for}${stale ? "; may not reflect current directions" : ""}` : stale ? "may not reflect current directions" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const items: SourceEvidenceItem[] = [];
      if (row.personal_statement) items.push({ heading: "Personal statement", sub: `“${row.personal_statement.trim()}”` });
      const contributions = row.contributions ?? [];
      if (contributions.length) {
        items.push({ heading: `Contributions to science · ${contributions.length}`, sub: contributions.map((c) => c.title).filter(Boolean).join(" · ") });
      }
      const stateLabel = stale ? "Stale" : "Available";
      return {
        ...base,
        count: docYear ? `(${docYear})` : "(on file)",
        visual: stale ? "stale" : "ok",
        stateLabel,
        meta,
        title: `${SOURCE_LABEL.biosketch} · ${stateLabel} · ${meta}`,
        items,
        empty: items.length ? null : "Document on file; the personal statement could not be extracted. Open the profile to read it.",
        action: { kind: "request_update", label: "Request update" },
      };
    }
    case "requested": {
      const sent = row.reminder_sent_at ?? row.requested_at;
      return none(
        "Not on file",
        `${who} hasn’t authorized a biosketch.${sent ? ` A request was sent ${fmtMonDYear(sent)}; no reply yet.` : ""} Missing biosketches never lower a match tier.`,
        ctx.email ? { kind: "send_reminder", label: "Send reminder" } : { kind: "add_email", label: "Add email" },
      );
    }
    case "declined":
      return none(
        "Not authorized",
        `${who} declined to share a biosketch${row.declined_at ? ` (${fmtMonYear(row.declined_at)})` : ""}. Prospera won’t ask again unless you do so directly.`,
        { kind: "open_profile", label: "Open profile" },
      );
    case "revoked":
      return none(
        `Authorization withdrawn${row.revoked_at ? ` ${fmtMonDYear(row.revoked_at)}` : ""}`,
        `${who} withdrew authorization; the document is no longer used for matching.`,
        ctx.email ? { kind: "request_biosketch", label: "Request biosketch" } : { kind: "add_email", label: "Add email" },
      );
    default: {
      if (!ctx.email) {
        return none("Not requested · no email on file", "A biosketch request needs an email address.", { kind: "add_email", label: "Add email" });
      }
      const interested = ctx.repliedInterestedAt
        ? ` ${who} replied Interested to a notice in ${fmtMonYear(ctx.repliedInterestedAt).split(" ")[0]}, so a request is likely to be answered.`
        : "";
      return none("Not requested", `No biosketch on file and no request sent.${interested}`, { kind: "request_biosketch", label: "Request biosketch" });
    }
  }
}

function orcidChip(row: InvestigatorSourceRow, ctx: SourceContext): SourceChipModel {
  const base = { key: "orcid" as const, label: SOURCE_LABEL.orcid, popTitle: SOURCE_POP_TITLE.orcid, flag: null };
  const id = ctx.orcid?.trim() || row.external_id;
  if (!id) {
    return {
      ...base,
      count: "(—)",
      visual: "none",
      recent: false,
      stateLabel: "Unavailable",
      meta: row.last_attempted_at ? "No ORCID iD on file · no confident match by name" : "No ORCID iD on file",
      title: `${SOURCE_LABEL.orcid} · Unavailable · No ORCID iD on file`,
      items: [],
      empty: "Add the ORCID iD from the profile page, or refresh sources to look it up by name and UCSF affiliation.",
      action: { kind: "add_orcid", label: "Add ORCID iD" },
    };
  }
  const f = freshness(row, ctx.now);
  const n = row.item_count;
  const meta = row.last_refreshed_at
    ? `${id} · ${n} work${n === 1 ? "" : "s"} · ${IDENTITY_METHOD_LABEL[row.identity_method ?? "self"]} · ${f.stale ? "last refreshed" : "refreshed"} ${f.refreshed}${row.state === "error" ? ` · ${failing}` : ""}`
    : `${id} · never fetched`;
  return {
    ...base,
    count: row.last_refreshed_at ? `(${n})` : "(—)",
    visual: row.last_refreshed_at ? f.visual : "none",
    recent: f.recent,
    stateLabel: row.last_refreshed_at ? f.stateLabel : "Unavailable",
    meta,
    title: `${SOURCE_LABEL.orcid} · ${meta}`,
    items: [],
    empty: row.last_refreshed_at ? null : "Works haven’t been fetched from ORCID yet.",
    action: row.state === "error" ? { kind: "retry", label: "Retry refresh" } : { kind: "refresh", label: "Refresh now" },
  };
}

function profilesChip(row: InvestigatorSourceRow, ctx: SourceContext): SourceChipModel {
  const base = { key: "profiles" as const, label: SOURCE_LABEL.profiles, popTitle: SOURCE_POP_TITLE.profiles, flag: null };
  const f = freshness(row, ctx.now);
  if (!row.last_refreshed_at) {
    const errored = row.state === "error";
    return {
      ...base,
      count: "(—)",
      visual: "none",
      recent: false,
      stateLabel: "Unavailable",
      meta: errored ? `Not connected · ${row.last_error ?? "lookup failed"}` : "Not connected",
      title: `${SOURCE_LABEL.profiles} · Unavailable · Not connected`,
      items: [],
      empty: "UCSF Profiles hasn’t been matched for this person. Refresh sources to look up profiles.ucsf.edu by name.",
      action: { kind: "connect_profiles", label: "Connect Profiles" },
    };
  }
  const n = row.item_count;
  const meta = `${row.external_url ?? row.external_id ?? "profiles.ucsf.edu"} · ${n} publication${n === 1 ? "" : "s"} listed · ${f.stale ? "last refreshed" : "refreshed"} ${f.refreshed}`;
  return {
    ...base,
    count: `(${n})`,
    visual: f.visual,
    recent: f.recent,
    stateLabel: f.stateLabel,
    meta,
    title: `${SOURCE_LABEL.profiles} · ${f.stateLabel} · ${meta}`,
    items: [],
    empty: null,
    action: { kind: "refresh", label: "Refresh now" },
  };
}

export function emptySourceRow(investigatorId: string, source: SourceKey): InvestigatorSourceRow {
  return {
    investigator_id: investigatorId,
    source,
    state: source === "biosketch" ? "not_requested" : "unavailable",
    item_count: 0,
    unverified_count: 0,
    identity_method: null,
    external_id: null,
    external_url: null,
    last_refreshed_at: null,
    last_attempted_at: null,
    last_error: null,
    document_date: null,
    written_for: null,
    authorized_at: null,
    authorized_by: null,
    revoked_at: null,
    requested_at: null,
    reminder_sent_at: null,
    declined_at: null,
    storage_path: null,
    personal_statement: null,
    contributions: null,
    meta: null,
  };
}

export function sourceChip(row: InvestigatorSourceRow, ctx: SourceContext): SourceChipModel {
  switch (row.source) {
    case "reporter":
      return reporterChip(row, ctx);
    case "pubmed":
      return pubmedChip(row, ctx);
    case "biosketch":
      return biosketchChip(row, ctx);
    case "orcid":
      return orcidChip(row, ctx);
    case "profiles":
      return profilesChip(row, ctx);
  }
}

// ---------------------------------------------------------------------------
// Directory-level summaries and filters
// ---------------------------------------------------------------------------

export type SourcesFilter =
  | "any"
  | "missing_any"
  | "missing_reporter"
  | "missing_pubmed"
  | "no_biosketch"
  | "stale"
  | "recent"
  | "unverified";

export const SOURCES_FILTER_OPTIONS: Array<{ value: SourcesFilter; label: string }> = [
  { value: "any", label: "Sources: any" },
  { value: "missing_any", label: "Missing any source" },
  { value: "missing_reporter", label: "Missing RePORTER" },
  { value: "missing_pubmed", label: "Missing PubMed" },
  { value: "no_biosketch", label: "No biosketch" },
  { value: "stale", label: "Stale (older than 12 months)" },
  { value: "recent", label: "Updated this week" },
  { value: "unverified", label: "Identity unverified" },
];

export function parseSourcesFilter(value: string | null | undefined): SourcesFilter {
  const found = SOURCES_FILTER_OPTIONS.find((o) => o.value === value);
  return found ? found.value : "any";
}

/** The three table chips for one person. */
export type PersonChips = Record<"reporter" | "pubmed" | "biosketch", SourceChipModel>;

export function matchesSourcesFilter(filter: SourcesFilter, chips: PersonChips): boolean {
  const all = [chips.reporter, chips.pubmed, chips.biosketch];
  switch (filter) {
    case "any":
      return true;
    case "missing_any":
      return all.some((c) => c.visual === "none");
    case "missing_reporter":
      return chips.reporter.visual === "none";
    case "missing_pubmed":
      return chips.pubmed.visual === "none";
    case "no_biosketch":
      return chips.biosketch.visual === "none";
    case "stale":
      return all.some((c) => c.visual === "stale");
    case "recent":
      return all.some((c) => c.recent);
    case "unverified":
      return chips.pubmed.flag != null;
  }
}

export type DirectoryCounts = {
  total: number;
  withEmail: number;
  reporter: number;
  pubmed: number;
  biosketch: number;
  noSources: number;
};

/** "148 in directory · 131 with email · RePORTER 62 · PubMed 121 · Biosketch 34 · 19 with no sources yet" */
export function headerSummary(c: DirectoryCounts): string {
  return [
    `${c.total} in directory`,
    `${c.withEmail} with email`,
    `RePORTER ${c.reporter}`,
    `PubMed ${c.pubmed}`,
    `Biosketch ${c.biosketch}`,
    `${c.noSources} with no sources yet`,
  ].join(" · ");
}

export function countDirectory(people: Array<{ email: string | null; chips: PersonChips }>): DirectoryCounts {
  const c: DirectoryCounts = { total: people.length, withEmail: 0, reporter: 0, pubmed: 0, biosketch: 0, noSources: 0 };
  for (const p of people) {
    if (p.email?.trim()) c.withEmail += 1;
    const has = { reporter: p.chips.reporter.visual !== "none", pubmed: p.chips.pubmed.visual !== "none", biosketch: p.chips.biosketch.visual !== "none" };
    if (has.reporter) c.reporter += 1;
    if (has.pubmed) c.pubmed += 1;
    if (has.biosketch) c.biosketch += 1;
    if (!has.reporter && !has.pubmed && !has.biosketch) c.noSources += 1;
  }
  return c;
}

/** Initials for the avatar tile: first + last word. */
export function personInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/** Today's date in UTC as YYYY-MM-DD (query boundaries). */
export function isoTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
