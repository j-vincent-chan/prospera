"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  confirmUrl,
  sendAccessRequestEmail,
  sendInvitationEmail,
  sendInvitationSignInEmail,
  sendRequestApprovedEmail,
  sendRequestDeniedEmail,
  sendTeamArchivedEmail,
} from "@/lib/email/send-team-emails";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";
import { requireTeamRole, requireUser } from "@/lib/team/require-team";
import { ROLE_RANK, slugify, type InviteRole, type TeamRole } from "@/lib/team/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const roleSchema = z.enum(["owner", "admin", "member"]);
const inviteRoleSchema = z.enum(["admin", "member"]);
const uuid = z.string().uuid();
const emailSchema = z.string().trim().toLowerCase().email();

function revalidateTeamSurfaces() {
  revalidatePath("/", "layout");
  revalidatePath("/team");
  revalidatePath("/onboarding");
  revalidatePath("/settings");
}

async function teamAdminsEmails(admin: SupabaseClient, teamId: string): Promise<string[]> {
  const { data } = await admin
    .from("team_memberships")
    .select("profiles:user_id (email)")
    .eq("team_id", teamId)
    .in("role", ["owner", "admin"]);
  const rows = (data ?? []) as unknown as Array<{ profiles: { email: string | null } | null }>;
  return rows.map((r) => r.profiles?.email?.trim()).filter((e): e is string => Boolean(e));
}

async function uniqueSlug(admin: SupabaseClient, base: string): Promise<string> {
  const root = base || "team";
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? root : `${root.slice(0, 36)}-${n + 1}`;
    const { data } = await admin.from("teams").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${root.slice(0, 30)}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Onboarding: create, request, invitations from the user's side
// ---------------------------------------------------------------------------

export async function createTeamAction(input: {
  name: string;
  description?: string;
  discoverability: "invite_only" | "domain";
}): Promise<Result<{ teamId: string; slug: string; inviteToken: string | null }>> {
  const parsed = z
    .object({
      name: z.string().trim().min(3, "Team name needs at least 3 characters.").max(80, "Team name is too long."),
      description: z.string().trim().max(500).optional(),
      discoverability: z.enum(["invite_only", "domain"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { admin, userId, email } = guard;

  const domain = email?.split("@")[1]?.toLowerCase() ?? "ucsf.edu";
  const slug = await uniqueSlug(admin, slugify(parsed.data.name));

  const { data: team, error } = await admin
    .from("teams")
    .insert({
      name: parsed.data.name,
      slug,
      description: parsed.data.description || null,
      discoverability: parsed.data.discoverability,
      domain,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !team) return { ok: false, error: error?.message ?? "Could not create the team." };
  const teamId = (team as { id: string }).id;

  const { error: memberErr } = await admin
    .from("team_memberships")
    .insert({ team_id: teamId, user_id: userId, role: "owner" });
  if (memberErr) return { ok: false, error: memberErr.message };

  const { data: link } = await admin
    .from("team_invite_links")
    .insert({ team_id: teamId, created_by: userId })
    .select("token")
    .single();
  await admin.from("profiles").update({ current_team_id: teamId }).eq("id", userId);

  revalidateTeamSurfaces();
  return { ok: true, teamId, slug, inviteToken: (link as { token?: string } | null)?.token ?? null };
}

export async function requestToJoinAction(input: { teamId: string; note?: string }): Promise<Result> {
  const parsed = z.object({ teamId: uuid, note: z.string().trim().max(500).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { admin, userId, email, fullName } = guard;

  const { data: team } = await admin
    .from("teams")
    .select("id, name, domain, discoverability, archived_at")
    .eq("id", parsed.data.teamId)
    .maybeSingle();
  const t = team as { id: string; name: string; domain: string; discoverability: string; archived_at: string | null } | null;
  if (!t || t.archived_at) return { ok: false, error: "That team isn't accepting requests." };
  if (t.discoverability !== "domain" || t.domain !== (email?.split("@")[1] ?? "")) {
    return { ok: false, error: "This team is invite-only. Ask an owner to invite you." };
  }

  const { data: existing } = await admin
    .from("team_memberships")
    .select("user_id")
    .eq("team_id", t.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return { ok: false, error: "You're already a member of this team." };

  const { data: recent } = await admin
    .from("team_access_requests")
    .select("status, resolved_at")
    .eq("team_id", t.id)
    .eq("user_id", userId)
    .eq("status", "denied")
    .order("resolved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const denied = recent as { resolved_at: string | null } | null;
  if (denied?.resolved_at && Date.now() - new Date(denied.resolved_at).getTime() < 14 * 86400_000) {
    return { ok: false, error: "This team declined a recent request. You can ask again after 14 days." };
  }

  const { error } = await admin.from("team_access_requests").insert({
    team_id: t.id,
    user_id: userId,
    note: parsed.data.note || null,
    source: "chooser",
  });
  if (error) {
    if (/one_pending/i.test(error.message) || /duplicate/i.test(error.message)) {
      return { ok: false, error: "You already have an open request for this team." };
    }
    return { ok: false, error: error.message };
  }

  const recipients = await teamAdminsEmails(admin, t.id);
  await Promise.all(
    recipients.map((to) =>
      sendAccessRequestEmail({
        to,
        teamName: t.name,
        requesterName: fullName ?? email ?? "Someone",
        requesterEmail: email,
        note: parsed.data.note || null,
      }),
    ),
  );

  revalidateTeamSurfaces();
  return { ok: true };
}

export async function cancelAccessRequestAction(input: { requestId: string }): Promise<Result> {
  if (!uuid.safeParse(input.requestId).success) return { ok: false, error: "Invalid request." };
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("team_access_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString(), resolved_by: guard.userId })
    .eq("id", input.requestId)
    .eq("user_id", guard.userId)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

/** Invite link: people in the team's domain who open it become a pending request. */
export async function joinViaLinkAction(input: { slug: string; token: string }): Promise<Result<{ teamName: string; alreadyMember: boolean }>> {
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { admin, userId, email, fullName } = guard;

  const { data: team } = await admin
    .from("teams")
    .select("id, name, domain, archived_at, team_invite_links (token, expires_at)")
    .eq("slug", input.slug)
    .maybeSingle();
  const t = team as
    | { id: string; name: string; domain: string; archived_at: string | null; team_invite_links: { token: string; expires_at: string } | Array<{ token: string; expires_at: string }> | null }
    | null;
  if (!t || t.archived_at) return { ok: false, error: "This invite link isn't valid." };
  const link = Array.isArray(t.team_invite_links) ? t.team_invite_links[0] : t.team_invite_links;
  if (!link || link.token !== input.token) return { ok: false, error: "This invite link isn't valid." };
  if (new Date(link.expires_at).getTime() < Date.now()) return { ok: false, error: "This invite link has expired. Ask the team for a new one." };
  if (t.domain !== (email?.split("@")[1] ?? "")) {
    return { ok: false, error: `This link is for people at ${t.domain}.` };
  }

  const { data: existing } = await admin
    .from("team_memberships")
    .select("user_id")
    .eq("team_id", t.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return { ok: true, teamName: t.name, alreadyMember: true };

  const { error } = await admin
    .from("team_access_requests")
    .insert({ team_id: t.id, user_id: userId, source: "link" });
  if (error && !/one_pending|duplicate/i.test(error.message)) return { ok: false, error: error.message };

  if (!error) {
    const recipients = await teamAdminsEmails(admin, t.id);
    await Promise.all(
      recipients.map((to) =>
        sendAccessRequestEmail({ to, teamName: t.name, requesterName: fullName ?? email ?? "Someone", requesterEmail: email, note: null }),
      ),
    );
  }

  revalidateTeamSurfaces();
  return { ok: true, teamName: t.name, alreadyMember: false };
}

export async function acceptInvitationAction(
  input: { token: string; invitationId?: undefined } | { invitationId: string; token?: undefined },
): Promise<Result<{ teamId: string; teamName: string }>> {
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { admin, userId, email } = guard;

  let query = admin
    .from("team_invitations")
    .select("id, team_id, email, role, expires_at, accepted_at, revoked_at, declined_at, teams:team_id (name, archived_at)");
  query = input.invitationId ? query.eq("id", input.invitationId) : query.eq("token", input.token ?? "");
  const { data } = await query.maybeSingle();
  const inv = data as
    | { id: string; team_id: string; email: string; role: InviteRole; expires_at: string; accepted_at: string | null; revoked_at: string | null; declined_at: string | null; teams: { name: string; archived_at: string | null } | null }
    | null;
  if (!inv || inv.revoked_at || inv.teams?.archived_at) return { ok: false, error: "This invitation is no longer valid." };
  if (inv.accepted_at) return { ok: false, error: "This invitation was already used." };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, error: "This invitation has expired. Ask the team to send a new one." };
  if (!email || inv.email !== email.toLowerCase()) {
    return { ok: false, error: `This invitation was sent to ${inv.email}. Sign in with that address to accept it.` };
  }

  const { error: memberErr } = await admin
    .from("team_memberships")
    .upsert({ team_id: inv.team_id, user_id: userId, role: inv.role }, { onConflict: "team_id,user_id", ignoreDuplicates: true });
  if (memberErr) return { ok: false, error: memberErr.message };

  await admin
    .from("team_invitations")
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq("id", inv.id);
  await admin.from("profiles").update({ current_team_id: inv.team_id }).eq("id", userId);

  revalidateTeamSurfaces();
  return { ok: true, teamId: inv.team_id, teamName: inv.teams?.name ?? "" };
}

export async function declineInvitationAction(input: { invitationId: string }): Promise<Result> {
  if (!uuid.safeParse(input.invitationId).success) return { ok: false, error: "Invalid invitation." };
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("team_invitations")
    .update({ declined_at: new Date().toISOString() })
    .eq("id", input.invitationId)
    .eq("email", guard.email ?? "")
    .is("accepted_at", null);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function switchTeamAction(input: { teamId: string }): Promise<Result> {
  const guard = await requireTeamRole("member", input.teamId);
  if (!guard.ok) return guard;
  await guard.admin.from("profiles").update({ current_team_id: input.teamId }).eq("id", guard.actor.userId);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Team settings: requests, invitations, members
// ---------------------------------------------------------------------------

export async function approveAccessRequestAction(input: { requestId: string; role: InviteRole }): Promise<Result> {
  const parsed = z.object({ requestId: uuid, role: inviteRoleSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const pre = await requireUser();
  if (!pre.ok) return pre;
  const { data } = await pre.admin
    .from("team_access_requests")
    .select("id, team_id, user_id, status, teams:team_id (name), profiles:user_id (email)")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  const req = data as { id: string; team_id: string; user_id: string; status: string; teams: { name: string } | null; profiles: { email: string | null } | null } | null;
  if (!req || req.status !== "pending") return { ok: false, error: "This request is no longer pending." };

  const guard = await requireTeamRole("admin", req.team_id);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  const { error: memberErr } = await admin
    .from("team_memberships")
    .upsert({ team_id: req.team_id, user_id: req.user_id, role: parsed.data.role, invited_by: actor.userId }, { onConflict: "team_id,user_id", ignoreDuplicates: true });
  if (memberErr) return { ok: false, error: memberErr.message };

  await admin
    .from("team_access_requests")
    .update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: actor.userId, approved_role: parsed.data.role })
    .eq("id", req.id);
  await admin.from("profiles").update({ current_team_id: req.team_id }).eq("id", req.user_id).is("current_team_id", null);

  if (req.profiles?.email) {
    await sendRequestApprovedEmail({ to: req.profiles.email, teamName: req.teams?.name ?? "the team", role: parsed.data.role });
  }
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function denyAccessRequestAction(input: { requestId: string; note?: string }): Promise<Result> {
  const parsed = z.object({ requestId: uuid, note: z.string().trim().max(500).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const pre = await requireUser();
  if (!pre.ok) return pre;
  const { data } = await pre.admin
    .from("team_access_requests")
    .select("id, team_id, status, teams:team_id (name), profiles:user_id (email)")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  const req = data as { id: string; team_id: string; status: string; teams: { name: string } | null; profiles: { email: string | null } | null } | null;
  if (!req || req.status !== "pending") return { ok: false, error: "This request is no longer pending." };

  const guard = await requireTeamRole("admin", req.team_id);
  if (!guard.ok) return guard;

  const { error } = await guard.admin
    .from("team_access_requests")
    .update({ status: "denied", resolved_at: new Date().toISOString(), resolved_by: guard.actor.userId, deny_note: parsed.data.note || null })
    .eq("id", req.id);
  if (error) return { ok: false, error: error.message };

  if (req.profiles?.email) {
    await sendRequestDeniedEmail({ to: req.profiles.email, teamName: req.teams?.name ?? "the team", note: parsed.data.note || null });
  }
  revalidateTeamSurfaces();
  return { ok: true };
}

/** Undo for deny: back to pending. */
export async function reopenAccessRequestAction(input: { requestId: string }): Promise<Result> {
  const pre = await requireUser();
  if (!pre.ok) return pre;
  const { data } = await pre.admin.from("team_access_requests").select("team_id").eq("id", input.requestId).maybeSingle();
  const teamId = (data as { team_id?: string } | null)?.team_id;
  if (!teamId) return { ok: false, error: "Request not found." };
  const guard = await requireTeamRole("admin", teamId);
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("team_access_requests")
    .update({ status: "pending", resolved_at: null, resolved_by: null, deny_note: null })
    .eq("id", input.requestId)
    .eq("status", "denied");
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function sendInvitationsAction(input: {
  teamId?: string;
  emails: string[];
  role: InviteRole;
}): Promise<Result<{ sent: number; skipped: string[]; warnings: string[] }>> {
  const parsed = z
    .object({ teamId: uuid.optional(), emails: z.array(z.string()).min(1, "Add at least one email address."), role: inviteRoleSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const guard = await requireTeamRole("admin", parsed.data.teamId);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  const { data: teamRow } = await admin.from("teams").select("name, description").eq("id", actor.teamId).maybeSingle();
  const teamName = (teamRow as { name?: string } | null)?.name ?? "the team";
  const teamDescription = (teamRow as { description?: string | null } | null)?.description ?? null;
  const { data: actorRow } = await admin.from("profiles").select("title").eq("id", actor.userId).maybeSingle();
  const inviterTitle = (actorRow as { title?: string | null } | null)?.title ?? null;

  const emails = Array.from(new Set(parsed.data.emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
  const skipped: string[] = [];
  const warnings: string[] = [];
  let sent = 0;

  for (const raw of emails) {
    const check = emailSchema.safeParse(raw);
    if (!check.success) {
      skipped.push(`${raw} (not an email address)`);
      continue;
    }
    const email = check.data;

    const { data: member } = await admin
      .from("team_memberships")
      .select("user_id, profiles:user_id!inner (email)")
      .eq("team_id", actor.teamId)
      .eq("profiles.email", email)
      .maybeSingle();
    if (member) {
      skipped.push(`${email} (already a member)`);
      continue;
    }

    const { data: open } = await admin
      .from("team_invitations")
      .select("id, token, expires_at, send_count")
      .eq("team_id", actor.teamId)
      .eq("email", email)
      .is("accepted_at", null)
      .is("declined_at", null)
      .is("revoked_at", null)
      .maybeSingle();

    let token: string;
    let expiresAt: string;
    let invitationId: string;
    let priorSends = 0;
    if (open) {
      const o = open as { id: string; token: string; expires_at: string; send_count: number };
      expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
      await admin.from("team_invitations").update({ role: parsed.data.role, expires_at: expiresAt, bounced: false }).eq("id", o.id);
      token = o.token;
      invitationId = o.id;
      priorSends = o.send_count;
    } else {
      const { data: created, error } = await admin
        .from("team_invitations")
        .insert({ team_id: actor.teamId, email, role: parsed.data.role, invited_by: actor.userId })
        .select("id, token, expires_at")
        .single();
      if (error || !created) {
        warnings.push(`${email}: ${error?.message ?? "could not create invitation"}`);
        continue;
      }
      const c = created as { id: string; token: string; expires_at: string };
      token = c.token;
      expiresAt = c.expires_at;
      invitationId = c.id;
    }

    const mail = await sendInvitationEmail({ to: email, teamName, teamDescription, inviterName: actor.fullName, inviterTitle, role: parsed.data.role, token, expiresAt });
    if (mail.ok) {
      await admin
        .from("team_invitations")
        .update({ last_sent_at: new Date().toISOString(), send_count: priorSends + 1 })
        .eq("id", invitationId);
      sent += 1;
    } else {
      warnings.push(`${email}: invitation saved but email not sent (${mail.error})`);
      sent += 1;
    }
  }

  revalidateTeamSurfaces();
  return { ok: true, sent, skipped, warnings };
}

export async function resendInvitationAction(input: { invitationId: string }): Promise<Result<{ warning?: string }>> {
  const pre = await requireUser();
  if (!pre.ok) return pre;
  const { data } = await pre.admin
    .from("team_invitations")
    .select("id, team_id, email, role, token, send_count, teams:team_id (name, description)")
    .eq("id", input.invitationId)
    .maybeSingle();
  const inv = data as { id: string; team_id: string; email: string; role: InviteRole; token: string; send_count: number; teams: { name: string; description: string | null } | null } | null;
  if (!inv) return { ok: false, error: "Invitation not found." };
  const guard = await requireTeamRole("admin", inv.team_id);
  if (!guard.ok) return guard;

  const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
  await guard.admin
    .from("team_invitations")
    .update({ expires_at: expiresAt, bounced: false, last_sent_at: new Date().toISOString(), send_count: inv.send_count + 1 })
    .eq("id", inv.id);
  const { data: actorRow } = await guard.admin.from("profiles").select("title").eq("id", guard.actor.userId).maybeSingle();
  const mail = await sendInvitationEmail({
    to: inv.email,
    teamName: inv.teams?.name ?? "the team",
    teamDescription: inv.teams?.description ?? null,
    inviterName: guard.actor.fullName,
    inviterTitle: (actorRow as { title?: string | null } | null)?.title ?? null,
    role: inv.role,
    token: inv.token,
    expiresAt,
  });
  revalidateTeamSurfaces();
  return mail.ok ? { ok: true } : { ok: true, warning: `Invitation renewed but email not sent (${mail.error}).` };
}

export async function revokeInvitationAction(input: { invitationId: string }): Promise<Result> {
  const pre = await requireUser();
  if (!pre.ok) return pre;
  const { data } = await pre.admin.from("team_invitations").select("team_id").eq("id", input.invitationId).maybeSingle();
  const teamId = (data as { team_id?: string } | null)?.team_id;
  if (!teamId) return { ok: false, error: "Invitation not found." };
  const guard = await requireTeamRole("admin", teamId);
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("team_invitations")
    .update({ revoked_at: new Date().toISOString(), revoked_by: guard.actor.userId })
    .eq("id", input.invitationId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

/** Undo for revoke. */
export async function restoreInvitationAction(input: { invitationId: string }): Promise<Result> {
  const pre = await requireUser();
  if (!pre.ok) return pre;
  const { data } = await pre.admin.from("team_invitations").select("team_id").eq("id", input.invitationId).maybeSingle();
  const teamId = (data as { team_id?: string } | null)?.team_id;
  if (!teamId) return { ok: false, error: "Invitation not found." };
  const guard = await requireTeamRole("admin", teamId);
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("team_invitations")
    .update({ revoked_at: null, revoked_by: null })
    .eq("id", input.invitationId);
  if (error) return { ok: false, error: /one_open/i.test(error.message) ? "A newer invitation to this address already exists." : error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function resetInviteLinkAction(input: { teamId?: string }): Promise<Result> {
  const guard = await requireTeamRole("admin", input.teamId);
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("team_invite_links")
    .upsert(
      {
        team_id: guard.actor.teamId,
        token: Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join(""),
        created_by: guard.actor.userId,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      },
      { onConflict: "team_id" },
    );
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

async function ownerCount(admin: SupabaseClient, teamId: string): Promise<number> {
  const { count } = await admin
    .from("team_memberships")
    .select("*", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("role", "owner");
  return count ?? 0;
}

export async function setMemberRoleAction(input: { teamId?: string; userId: string; role: TeamRole }): Promise<Result<{ previousRole: TeamRole }>> {
  const parsed = z.object({ teamId: uuid.optional(), userId: uuid, role: roleSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const guard = await requireTeamRole("admin", parsed.data.teamId);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  const { data: target } = await admin
    .from("team_memberships")
    .select("role")
    .eq("team_id", actor.teamId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  const previousRole = (target as { role?: TeamRole } | null)?.role;
  if (!previousRole) return { ok: false, error: "That person isn't a member." };
  if (previousRole === parsed.data.role) return { ok: true, previousRole };

  // Only owners touch the owner role in either direction.
  if ((previousRole === "owner" || parsed.data.role === "owner") && actor.role !== "owner") {
    return { ok: false, error: "Only an Owner can change who owns the team." };
  }
  if (previousRole === "owner" && (await ownerCount(admin, actor.teamId)) <= 1) {
    return { ok: false, error: "The only owner. Make someone else an Owner first." };
  }
  if (actor.role === "admin" && ROLE_RANK[parsed.data.role] > ROLE_RANK.admin) {
    return { ok: false, error: "Admins can't grant a role above Admin." };
  }

  const { error } = await admin
    .from("team_memberships")
    .update({ role: parsed.data.role })
    .eq("team_id", actor.teamId)
    .eq("user_id", parsed.data.userId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true, previousRole };
}

async function recordDeparture(
  admin: SupabaseClient,
  teamId: string,
  userId: string,
  reason: "left" | "removed",
  removedBy: string | null,
): Promise<Result<{ affectedAssignments: number }>> {
  const { data: m } = await admin
    .from("team_memberships")
    .select("role, profiles:user_id (full_name, email)")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = m as { role: TeamRole; profiles: { full_name: string | null; email: string | null } | null } | null;
  if (!row) return { ok: false, error: "That person isn't a member." };

  await admin.from("team_former_members").insert({
    team_id: teamId,
    user_id: userId,
    full_name: row.profiles?.full_name?.trim() || row.profiles?.email || "Former member",
    email: row.profiles?.email ?? null,
    former_role: row.role,
    reason,
    removed_by: removedBy,
  });
  const { error } = await admin.from("team_memberships").delete().eq("team_id", teamId).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };

  // Point them at another workspace if this was current.
  const { data: other } = await admin
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  await admin
    .from("profiles")
    .update({ current_team_id: (other as { team_id?: string } | null)?.team_id ?? null })
    .eq("id", userId)
    .eq("current_team_id", teamId);

  // Assignments live on outreach items (step 5); nothing to reassign yet.
  return { ok: true, affectedAssignments: 0 };
}

export async function removeMemberAction(input: { teamId?: string; userId: string }): Promise<Result<{ affectedAssignments: number }>> {
  if (!uuid.safeParse(input.userId).success) return { ok: false, error: "Invalid input." };
  const guard = await requireTeamRole("admin", input.teamId);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  if (input.userId === actor.userId) return { ok: false, error: "Use Leave team to remove yourself." };

  const { data: target } = await admin
    .from("team_memberships")
    .select("role")
    .eq("team_id", actor.teamId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const targetRole = (target as { role?: TeamRole } | null)?.role;
  if (!targetRole) return { ok: false, error: "That person isn't a member." };
  if (targetRole === "owner" && actor.role !== "owner") return { ok: false, error: "Only an Owner can remove an Owner." };
  if (targetRole === "owner" && (await ownerCount(admin, actor.teamId)) <= 1) {
    return { ok: false, error: "The only owner. Make someone else an Owner first." };
  }

  const result = await recordDeparture(admin, actor.teamId, input.userId, "removed", actor.userId);
  revalidateTeamSurfaces();
  return result;
}

export async function leaveTeamAction(input: { teamId?: string }): Promise<Result> {
  const guard = await requireTeamRole("member", input.teamId);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  if (actor.role === "owner" && (await ownerCount(admin, actor.teamId)) <= 1) {
    return { ok: false, error: "You're the only Owner. Make someone else an Owner before leaving." };
  }
  const result = await recordDeparture(admin, actor.teamId, actor.userId, "left", null);
  revalidateTeamSurfaces();
  return result.ok ? { ok: true } : result;
}

// ---------------------------------------------------------------------------
// Team settings: general, outreach, logo, lifecycle
// ---------------------------------------------------------------------------

export async function updateTeamGeneralAction(input: {
  teamId?: string;
  name: string;
  slug: string;
  description: string;
  discoverability: "invite_only" | "domain";
  routingDays: number;
  routingDayType: "business" | "calendar";
  routingHolidayCalendar: "ucsf" | "us_federal" | "none";
}): Promise<Result> {
  const parsed = z
    .object({
      teamId: uuid.optional(),
      name: z.string().trim().min(3, "Team name needs at least 3 characters.").max(80),
      slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Address: lowercase letters, numbers and hyphens.").min(2).max(40),
      description: z.string().trim().max(500),
      discoverability: z.enum(["invite_only", "domain"]),
      routingDays: z.number().int().min(0).max(60),
      routingDayType: z.enum(["business", "calendar"]),
      routingHolidayCalendar: z.enum(["ucsf", "us_federal", "none"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const guard = await requireTeamRole("admin", parsed.data.teamId);
  if (!guard.ok) return guard;

  const { error } = await guard.admin
    .from("teams")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      discoverability: parsed.data.discoverability,
      routing_days: parsed.data.routingDays,
      routing_day_type: parsed.data.routingDayType,
      routing_holiday_calendar: parsed.data.routingHolidayCalendar,
    })
    .eq("id", guard.actor.teamId);
  if (error) return { ok: false, error: /teams_slug_key|duplicate/i.test(error.message) ? "That workspace address is taken." : error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function updateTeamOutreachAction(input: {
  teamId?: string;
  sendingIdentity: "strategist_via_prospera" | "team_address";
  sendingAddress: string;
  replyToEmail: string;
  perInvestigatorLimit: number;
  signature: string;
}): Promise<Result> {
  const optionalEmail = z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address.");
  const parsed = z
    .object({
      teamId: uuid.optional(),
      sendingIdentity: z.enum(["strategist_via_prospera", "team_address"]),
      sendingAddress: optionalEmail,
      replyToEmail: optionalEmail,
      perInvestigatorLimit: z.number().int().min(0).max(20),
      signature: z.string().max(2000),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const guard = await requireTeamRole("admin", parsed.data.teamId);
  if (!guard.ok) return guard;

  const { error } = await guard.admin
    .from("teams")
    .update({
      sending_identity: parsed.data.sendingIdentity,
      sending_address: parsed.data.sendingAddress || null,
      reply_to_email: parsed.data.replyToEmail || null,
      per_investigator_limit: parsed.data.perInvestigatorLimit,
      signature: parsed.data.signature || null,
    })
    .eq("id", guard.actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function uploadTeamLogoAction(formData: FormData): Promise<Result<{ logoPath: string }>> {
  const teamId = formData.get("teamId");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a PNG or SVG file." };
  if (!["image/png", "image/svg+xml"].includes(file.type)) return { ok: false, error: "Square PNG or SVG only." };
  if (file.size > 1_048_576) return { ok: false, error: "Keep the logo under 1 MB." };

  const guard = await requireTeamRole("admin", typeof teamId === "string" && teamId ? teamId : undefined);
  if (!guard.ok) return guard;

  const ext = file.type === "image/png" ? "png" : "svg";
  const path = `${guard.actor.teamId}/logo-${Date.now()}.${ext}`;
  const { error } = await guard.admin.storage
    .from("team-logos")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (error) return { ok: false, error: error.message };

  const { data: prev } = await guard.admin.from("teams").select("logo_path").eq("id", guard.actor.teamId).maybeSingle();
  await guard.admin.from("teams").update({ logo_path: path }).eq("id", guard.actor.teamId);
  const old = (prev as { logo_path?: string | null } | null)?.logo_path;
  if (old && old !== path) await guard.admin.storage.from("team-logos").remove([old]);

  revalidateTeamSurfaces();
  return { ok: true, logoPath: path };
}

export async function removeTeamLogoAction(input: { teamId?: string }): Promise<Result<{ previousPath: string | null }>> {
  const guard = await requireTeamRole("admin", input.teamId);
  if (!guard.ok) return guard;
  const { data: prev } = await guard.admin.from("teams").select("logo_path").eq("id", guard.actor.teamId).maybeSingle();
  const previousPath = (prev as { logo_path?: string | null } | null)?.logo_path ?? null;
  const { error } = await guard.admin.from("teams").update({ logo_path: null }).eq("id", guard.actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  // The object stays in storage so Undo can restore it; a later upload removes it.
  return { ok: true, previousPath };
}

export async function restoreTeamLogoAction(input: { teamId?: string; logoPath: string }): Promise<Result> {
  const guard = await requireTeamRole("admin", input.teamId);
  if (!guard.ok) return guard;
  if (!input.logoPath.startsWith(`${guard.actor.teamId}/`)) return { ok: false, error: "Invalid logo." };
  const { error } = await guard.admin.from("teams").update({ logo_path: input.logoPath }).eq("id", guard.actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function setLogoOnBriefsAction(input: { teamId?: string; enabled: boolean }): Promise<Result> {
  const guard = await requireTeamRole("admin", input.teamId);
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("teams").update({ logo_on_briefs: input.enabled }).eq("id", guard.actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function archiveTeamAction(input: { teamId?: string; confirmName: string }): Promise<Result> {
  const guard = await requireTeamRole("owner", input.teamId);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data: team } = await admin.from("teams").select("name, archived_at").eq("id", actor.teamId).maybeSingle();
  const t = team as { name: string; archived_at: string | null } | null;
  if (!t) return { ok: false, error: "Team not found." };
  if (t.archived_at) return { ok: false, error: "This team is already archived." };
  if (input.confirmName.trim() !== t.name) return { ok: false, error: "Type the team name exactly to confirm." };

  const { error } = await admin
    .from("teams")
    .update({ archived_at: new Date().toISOString(), archived_by: actor.userId })
    .eq("id", actor.teamId);
  if (error) return { ok: false, error: error.message };

  const { data: members } = await admin
    .from("team_memberships")
    .select("profiles:user_id (email)")
    .eq("team_id", actor.teamId);
  const emails = ((members ?? []) as unknown as Array<{ profiles: { email: string | null } | null }>)
    .map((r) => r.profiles?.email)
    .filter((e): e is string => Boolean(e));
  await Promise.all(emails.map((to) => sendTeamArchivedEmail({ to, teamName: t.name, byName: actor.fullName })));

  revalidateTeamSurfaces();
  return { ok: true };
}

export async function restoreTeamAction(input: { teamId?: string }): Promise<Result> {
  const guard = await requireTeamRole("owner", input.teamId);
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("teams")
    .update({ archived_at: null, archived_by: null })
    .eq("id", guard.actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

export async function deleteTeamAction(input: { teamId?: string; confirmName: string }): Promise<Result> {
  const guard = await requireTeamRole("owner", input.teamId);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data: team } = await admin.from("teams").select("name").eq("id", actor.teamId).maybeSingle();
  const name = (team as { name?: string } | null)?.name;
  if (!name) return { ok: false, error: "Team not found." };
  if (input.confirmName.trim() !== name) return { ok: false, error: "Type the team name exactly to confirm." };

  const { error } = await admin.from("teams").delete().eq("id", actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Undo helpers for the toasts on the Members / Requests tabs
// ---------------------------------------------------------------------------

/** Undo for Remove: put the membership back and drop the former-member row. */
export async function reinstateMemberAction(input: { teamId?: string; userId: string; role: TeamRole }): Promise<Result> {
  const parsed = z.object({ teamId: uuid.optional(), userId: uuid, role: roleSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const guard = await requireTeamRole("admin", parsed.data.teamId);
  if (!guard.ok) return guard;
  if (parsed.data.role === "owner" && guard.actor.role !== "owner") return { ok: false, error: "Only an Owner can reinstate an Owner." };
  const { admin, actor } = guard;
  const { error } = await admin
    .from("team_memberships")
    .upsert({ team_id: actor.teamId, user_id: parsed.data.userId, role: parsed.data.role }, { onConflict: "team_id,user_id" });
  if (error) return { ok: false, error: error.message };
  await admin.from("team_former_members").delete().eq("team_id", actor.teamId).eq("user_id", parsed.data.userId);
  await admin.from("profiles").update({ current_team_id: actor.teamId }).eq("id", parsed.data.userId).is("current_team_id", null);
  revalidateTeamSurfaces();
  return { ok: true };
}

/** Undo for Approve: remove the membership again and reopen the request. */
export async function undoApproveAccessRequestAction(input: { requestId: string }): Promise<Result> {
  const pre = await requireUser();
  if (!pre.ok) return pre;
  const { data } = await pre.admin
    .from("team_access_requests")
    .select("team_id, user_id, status")
    .eq("id", input.requestId)
    .maybeSingle();
  const req = data as { team_id: string; user_id: string; status: string } | null;
  if (!req || req.status !== "approved") return { ok: false, error: "Nothing to undo." };
  const guard = await requireTeamRole("admin", req.team_id);
  if (!guard.ok) return guard;
  const { admin } = guard;
  const { data: m } = await admin.from("team_memberships").select("role").eq("team_id", req.team_id).eq("user_id", req.user_id).maybeSingle();
  if ((m as { role?: TeamRole } | null)?.role === "owner") return { ok: false, error: "That person is now an Owner; change their role instead." };
  await admin.from("team_memberships").delete().eq("team_id", req.team_id).eq("user_id", req.user_id);
  await admin.from("profiles").update({ current_team_id: null }).eq("id", req.user_id).eq("current_team_id", req.team_id);
  const { error } = await admin
    .from("team_access_requests")
    .update({ status: "pending", resolved_at: null, resolved_by: null, approved_role: null })
    .eq("id", input.requestId);
  if (error) return { ok: false, error: error.message };
  revalidateTeamSurfaces();
  return { ok: true };
}

/** Duplicate-team warning while typing a new team name. */
export async function findSimilarTeamsAction(input: { name: string }): Promise<Result<{ teams: Array<{ id: string; name: string; memberCount: number; discoverable: boolean }> }>> {
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const name = input.name.trim();
  if (name.length < 4) return { ok: true, teams: [] };
  const { data, error } = await guard.session.rpc("similar_teams", { p_name: name });
  if (error) return { ok: true, teams: [] };
  const teams = ((data ?? []) as Array<{ id: string; name: string; member_count: number; discoverable: boolean }>).map((r) => ({
    id: r.id,
    name: r.name,
    memberCount: Number(r.member_count),
    discoverable: r.discoverable,
  }));
  return { ok: true, teams };
}

/**
 * Public: email the invitee a one-time sign-in link for an open invitation.
 * Creates the auth account for new people (Supabase "invite" link) or signs
 * existing people in ("magiclink"); either way they land on /invite/<token>.
 */
export async function requestInvitationSignInLinkAction(input: { token: string }): Promise<Result<{ email: string }>> {
  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: "Service role client is not configured." };

  const { data } = await admin
    .from("team_invitations")
    .select("id, email, role, expires_at, accepted_at, revoked_at, declined_at, teams:team_id (name, archived_at)")
    .eq("token", input.token)
    .maybeSingle();
  const inv = data as
    | { id: string; email: string; role: InviteRole; expires_at: string; accepted_at: string | null; revoked_at: string | null; declined_at: string | null; teams: { name: string; archived_at: string | null } | null }
    | null;
  if (!inv || inv.revoked_at || inv.declined_at || inv.accepted_at || inv.teams?.archived_at) {
    return { ok: false, error: "This invitation is no longer open." };
  }
  if (new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, error: "This invitation has expired. Ask the team to send a new one." };

  let linkType: "invite" | "magiclink" = "invite";
  // New accounts must set a password before doing anything else (middleware enforces it).
  let generated = await admin.auth.admin.generateLink({ type: "invite", email: inv.email, options: { data: { password_pending: true } } });
  if (generated.error && /already|exists|registered/i.test(generated.error.message)) {
    linkType = "magiclink";
    generated = await admin.auth.admin.generateLink({ type: "magiclink", email: inv.email });
  }
  if (generated.error || !generated.data?.properties?.hashed_token) {
    return { ok: false, error: generated.error?.message ?? "Could not create a sign-in link." };
  }

  const url = confirmUrl(generated.data.properties.hashed_token, linkType, `/invite/${input.token}`);
  const mail = await sendInvitationSignInEmail({ to: inv.email, teamName: inv.teams?.name ?? "the team", url });
  if (!mail.ok) return { ok: false, error: `Could not send the email: ${mail.error}` };
  return { ok: true, email: inv.email };
}
