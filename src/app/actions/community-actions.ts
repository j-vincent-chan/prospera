"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateCommunityBrief } from "@/lib/communities/brief";
import { refreshCommunityFits } from "@/lib/communities/fits";
import { loadCommunityOptions, searchDirectoryForRoster } from "@/lib/communities/queries";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { requireTeamRole } from "@/lib/team/require-team";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };
type Result<T = Record<never, never>> = Ok<T> | Fail;

function revalidate() {
  revalidatePath("/communities");
  revalidatePath("/investigators");
  revalidatePath("/outreach");
  revalidatePath("/reports");
}

const list = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v : (v ?? "").split(/[,\n]/)).map((s) => s.trim()).filter(Boolean).slice(0, 30);

const communityInput = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(2, "Give the community a name.").max(120),
  mission: z.string().trim().max(2000).nullable().optional(),
  focus: z.string().trim().max(2000).nullable().optional(),
  keywords: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  populations: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  active: z.boolean().default(true),
  strategist_id: z.string().uuid().nullable().optional(),
  listserv: z.string().trim().max(200).nullable().optional(),
  lead_ids: z.array(z.string().uuid()).max(20).optional(),
});
export type CommunityInput = z.input<typeof communityInput>;

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "community";
}

/** Owners and admins manage communities (README: "Admins manage members, communities and settings"). */
export async function saveCommunityAction(raw: CommunityInput): Promise<Result<{ id: string }>> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  const parsed = communityInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const { admin, actor } = guard;
  const now = new Date().toISOString();
  const patch = { label: v.label, mission: v.mission || null, focus: v.focus || null, keywords: list(v.keywords), populations: list(v.populations), active: v.active, strategist_id: v.strategist_id ?? null, listserv: v.listserv || null, updated_at: now };
  let id = v.id ?? null;
  if (id) {
    const { error } = await admin.from("pipeline_communities").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data: existing } = await admin.from("pipeline_communities").select("slug");
    const taken = new Set(((existing ?? []) as Array<{ slug: string }>).map((r) => r.slug));
    let slug = slugify(v.label);
    for (let i = 2; taken.has(slug); i += 1) slug = `${slugify(v.label)}_${i}`;
    const { data: maxRow } = await admin.from("pipeline_communities").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await admin.from("pipeline_communities").insert({ ...patch, slug, monitored: true, sort_order: ((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 1, created_by: actor.userId }).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not create the community." };
    id = (data as { id: string }).id;
  }
  if (v.lead_ids) {
    await admin.from("community_members").update({ role: "member" }).eq("community_id", id).eq("role", "lead");
    if (v.lead_ids.length) await admin.from("community_members").update({ role: "lead" }).eq("community_id", id).in("investigator_id", v.lead_ids);
  }
  revalidate();
  return { ok: true, id };
}

export async function addCommunityMembersAction(input: { communityId: string; investigatorIds: string[] }): Promise<Result<{ added: number }>> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  const ids = Array.from(new Set(input.investigatorIds)).filter((x) => z.string().uuid().safeParse(x).success).slice(0, 200);
  if (!ids.length) return { ok: false, error: "Pick at least one investigator." };
  const { error } = await guard.admin.from("community_members").upsert(ids.map((investigator_id) => ({ community_id: input.communityId, investigator_id, role: "member", added_by: guard.actor.userId })), { onConflict: "community_id,investigator_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  void refreshCommunityFits(guard.admin, input.communityId);
  revalidate();
  return { ok: true, added: ids.length };
}

export async function removeCommunityMemberAction(input: { communityId: string; investigatorId: string }): Promise<Result<{ role: "lead" | "member" }>> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  const { data: row } = await guard.admin.from("community_members").select("role").eq("community_id", input.communityId).eq("investigator_id", input.investigatorId).maybeSingle();
  const { error } = await guard.admin.from("community_members").delete().eq("community_id", input.communityId).eq("investigator_id", input.investigatorId);
  if (error) return { ok: false, error: error.message };
  void refreshCommunityFits(guard.admin, input.communityId);
  revalidate();
  return { ok: true, role: ((row as { role?: "lead" | "member" } | null)?.role ?? "member") };
}

export async function restoreCommunityMemberAction(input: { communityId: string; investigatorId: string; role: "lead" | "member" }): Promise<Result> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("community_members").upsert({ community_id: input.communityId, investigator_id: input.investigatorId, role: input.role, added_by: guard.actor.userId }, { onConflict: "community_id,investigator_id" });
  if (error) return { ok: false, error: error.message };
  void refreshCommunityFits(guard.admin, input.communityId);
  revalidate();
  return { ok: true };
}

export async function setCommunityMemberRoleAction(input: { communityId: string; investigatorId: string; role: "lead" | "member" }): Promise<Result> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("community_members").update({ role: input.role }).eq("community_id", input.communityId).eq("investigator_id", input.investigatorId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function generateCommunityBriefAction(input: { communityId: string }): Promise<Result<{ text: string }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const r = await generateCommunityBrief(guard.admin, input.communityId, { teamId: guard.actor.teamId, today: isoToday(), actorId: guard.actor.userId });
  if (!r.ok) return r;
  revalidate();
  return { ok: true, text: r.text };
}

export async function refreshCommunityFitsAction(input: { communityId: string }): Promise<Result<{ notices: number; embedded: number; members: number }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const r = await refreshCommunityFits(guard.admin, input.communityId);
  if (!r.ok) return r;
  revalidate();
  return { ok: true, notices: r.notices, embedded: r.embedded, members: r.members };
}

export async function linkSavedSearchToCommunityAction(input: { savedSearchId: string; communityId: string | null }): Promise<Result<{ previous: string | null }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { data: row } = await guard.admin.from("saved_funding_searches").select("community_id, team_id").eq("id", input.savedSearchId).maybeSingle();
  const r = row as { community_id: string | null; team_id: string } | null;
  if (!r || r.team_id !== guard.actor.teamId) return { ok: false, error: "That saved search isn't in your team." };
  const { error } = await guard.admin.from("saved_funding_searches").update({ community_id: input.communityId }).eq("id", input.savedSearchId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  revalidatePath("/opportunities");
  return { ok: true, previous: r.community_id };
}

export async function searchDirectoryForRosterAction(input: { q: string; excludeIds: string[] }): Promise<Result<{ people: Array<{ id: string; name: string; dept: string; community: string | null }> }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const people = await searchDirectoryForRoster(guard.session, input.q, input.excludeIds);
  return { ok: true, people };
}

export async function listCommunitiesAction(): Promise<Result<{ communities: Array<{ id: string; label: string; active: boolean }> }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const options = await loadCommunityOptions(guard.session);
  return { ok: true, communities: options.map((o) => ({ id: o.id, label: o.label, active: o.active })) };
}
