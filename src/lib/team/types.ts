export type TeamRole = "owner" | "admin" | "member";
export type InviteRole = Exclude<TeamRole, "owner">;

export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const ROLE_RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 };

export type Discoverability = "invite_only" | "domain";
export type RoutingDayType = "business" | "calendar";
export type HolidayCalendar = "ucsf" | "us_federal" | "none";
export type SendingIdentity = "strategist_via_prospera" | "team_address";

export type Team = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  discoverability: Discoverability;
  domain: string;
  logoPath: string | null;
  logoOnBriefs: boolean;
  routingDays: number;
  routingDayType: RoutingDayType;
  routingHolidayCalendar: HolidayCalendar;
  sendingIdentity: SendingIdentity;
  sendingAddress: string | null;
  replyToEmail: string | null;
  perInvestigatorLimit: number;
  signature: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type Membership = {
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: string;
};

export type MemberRow = {
  userId: string;
  fullName: string;
  email: string | null;
  department: string | null;
  role: TeamRole;
  joinedAt: string;
  isYou: boolean;
};

export type FormerMemberRow = {
  id: string;
  fullName: string;
  email: string | null;
  formerRole: TeamRole;
  reason: "left" | "removed";
  leftAt: string;
};

export type AccessRequestRow = {
  id: string;
  teamId: string;
  teamName: string;
  userId: string;
  fullName: string;
  email: string | null;
  title: string | null;
  note: string | null;
  source: "chooser" | "link";
  status: "pending" | "approved" | "denied" | "cancelled" | "expired";
  requestedAt: string;
  expiresAt: string;
};

export type InvitationRow = {
  id: string;
  teamId: string;
  teamName: string;
  email: string;
  role: InviteRole;
  invitedById: string | null;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  lastSentAt: string | null;
  bounced: boolean;
  accepted: boolean;
  declined: boolean;
  revoked: boolean;
};

export type InviteLink = {
  token: string;
  expiresAt: string;
  createdAt: string;
};

export type DiscoverableTeam = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  memberCount: number;
  ownerName: string | null;
};

export type SimilarTeam = {
  id: string;
  name: string;
  memberCount: number;
  discoverable: boolean;
};

export type NotificationEventType =
  | "pi_reply"
  | "access_requests"
  | "saved_search_matches"
  | "watched_forecasts"
  | "next_actions_due"
  | "data_source_failing";

export type NotificationPreference = {
  eventType: NotificationEventType;
  immediate: boolean;
  digest: boolean;
};

export type DigestTime = "07:30" | "12:00" | "17:00";

export type Profile = {
  id: string;
  email: string | null;
  fullName: string | null;
  title: string | null;
  department: string | null;
  /** Legacy app-wide flag; institution roles live in `institutionRoles`. */
  legacyRole: "admin" | "staff";
  institutionRoles: string[];
  currentTeamId: string | null;
  digestTime: DigestTime;
  digestWeekdaysOnly: boolean;
};

/** Initials for a team tile: "OCR" → OCR, "ImmunoX Program Office" → IX, "CVRI Grants Team" → CV. */
export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const caps = words[0].replace(/[^A-Z]/g, "");
  if (caps.length >= 2 && caps.length <= 3) return caps;
  if (caps.length > 3) return caps.slice(0, 2);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Public URL for a team logo stored in the `team-logos` bucket. */
export function teamLogoUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/team-logos/${logoPath}`;
}
