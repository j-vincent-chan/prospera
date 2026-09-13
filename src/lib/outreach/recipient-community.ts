/**
 * Which research community the outreach email names in its footer — "…is
 * the research development strategist for ImmunoX". A person can sit on
 * several rosters (`community_members`), so the pick is: the community whose
 * strategist is the sender, else the investigator's primary community
 * (`investigators.research_community_id`), else the first roster entry by
 * label, else nothing — and the footer then says "your research development
 * strategist" without naming one. A community-kind recipient (a listserv) is
 * its own community.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type CommunityRef = { id: string; label: string; strategistId: string | null };

/** Pure. The community to name for one investigator, from their roster entries. */
export function pickCommunity(input: { memberships: CommunityRef[]; primaryId: string | null; senderId: string | null }): string | null {
  const { memberships, primaryId, senderId } = input;
  if (!memberships.length) return null;
  const mine = senderId ? memberships.find((m) => m.strategistId === senderId) : null;
  const primary = primaryId ? memberships.find((m) => m.id === primaryId) : null;
  const first = [...memberships].sort((a, b) => a.label.localeCompare(b.label))[0] ?? null;
  return (mine ?? primary ?? first)?.label?.trim() || null;
}

type MemberRow = { investigator_id: string; pipeline_communities: CommunityRow | CommunityRow[] | null };
type CommunityRow = { id: string; label: string | null; strategist_id: string | null };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Community labels for a send: `people` keyed by investigator id, `communities` keyed by
 * `pipeline_communities.id`. A missing table or an errored read yields empty maps — the
 * email still goes, its footer just names no community.
 */
export async function loadRecipientCommunities(
  db: SupabaseClient,
  input: { investigators: Array<{ id: string; primaryCommunityId: string | null }>; communityIds: string[]; senderId: string | null },
): Promise<{ people: Map<string, string>; communities: Map<string, string> }> {
  const people = new Map<string, string>();
  const communities = new Map<string, string>();
  const invIds = Array.from(new Set(input.investigators.map((i) => i.id)));
  const comIds = Array.from(new Set(input.communityIds));
  const [members, direct] = await Promise.all([
    invIds.length ? db.from("community_members").select("investigator_id, pipeline_communities(id, label, strategist_id)").in("investigator_id", invIds) : Promise.resolve({ data: null }),
    comIds.length ? db.from("pipeline_communities").select("id, label").in("id", comIds) : Promise.resolve({ data: null }),
  ]);
  const byInv = new Map<string, CommunityRef[]>();
  for (const r of ((members.data ?? []) as MemberRow[])) {
    const c = one(r.pipeline_communities);
    if (!c?.label) continue;
    const list = byInv.get(r.investigator_id) ?? [];
    list.push({ id: c.id, label: c.label, strategistId: c.strategist_id });
    byInv.set(r.investigator_id, list);
  }
  for (const inv of input.investigators) {
    const label = pickCommunity({ memberships: byInv.get(inv.id) ?? [], primaryId: inv.primaryCommunityId, senderId: input.senderId });
    if (label) people.set(inv.id, label);
  }
  for (const c of ((direct.data ?? []) as Array<{ id: string; label: string | null }>)) if (c.label?.trim()) communities.set(c.id, c.label.trim());
  return { people, communities };
}
