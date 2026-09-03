"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTeamRole } from "@/lib/team/require-team";

type Result<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

const entrySchema = z.object({
  title: z.string().trim().min(1, "Give the deadline a name").max(200),
  kind: z.enum(["sponsor", "internal", "loi", "limited"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  notes: z.string().trim().max(500).optional().default(""),
  itemId: z.string().uuid().nullable().optional(),
});

export async function addCalendarEntryAction(input: z.input<typeof entrySchema>): Promise<Result<{ id: string }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  const { data, error } = await guard.admin.from("calendar_entries").insert({ team_id: guard.actor.teamId, title: d.title, kind: d.kind, date: d.date, notes: d.notes || null, item_id: d.itemId ?? null, created_by: guard.actor.userId }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not add the deadline." };
  revalidatePath("/calendar");
  revalidatePath("/home");
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteCalendarEntryAction(id: string): Promise<Result> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid entry." };
  const { error } = await guard.admin.from("calendar_entries").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("team_id", guard.actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/calendar");
  return { ok: true };
}

export async function restoreCalendarEntryAction(id: string): Promise<Result> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid entry." };
  const { error } = await guard.admin.from("calendar_entries").update({ deleted_at: null }).eq("id", id).eq("team_id", guard.actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/calendar");
  return { ok: true };
}

/** Owners and admins can rotate the ICS token when a feed URL leaks. */
export async function rotateCalendarTokenAction(): Promise<Result<{ token: string }>> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await guard.admin.from("teams").update({ calendar_token: token }).eq("id", guard.actor.teamId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/calendar");
  return { ok: true, token };
}
