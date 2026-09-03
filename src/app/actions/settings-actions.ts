"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/team/require-team";
import { NOTIFICATION_EVENT_TYPES } from "@/lib/team/queries";
import type { NotificationEventType } from "@/lib/team/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function updateProfileAction(input: {
  fullName: string;
  title: string;
  department: string;
}): Promise<Result> {
  const parsed = z
    .object({
      fullName: z.string().trim().min(1, "Name is required.").max(200),
      title: z.string().trim().max(200),
      department: z.string().trim().max(200),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      title: parsed.data.title || null,
      department: parsed.data.department || null,
    })
    .eq("id", guard.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  return { ok: true };
}

export async function setNotificationPreferenceAction(input: {
  eventType: NotificationEventType;
  channel: "immediate" | "digest";
  enabled: boolean;
}): Promise<Result> {
  const parsed = z
    .object({
      eventType: z.enum(NOTIFICATION_EVENT_TYPES as [NotificationEventType, ...NotificationEventType[]]),
      channel: z.enum(["immediate", "digest"]),
      enabled: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const guard = await requireUser();
  if (!guard.ok) return guard;

  const { data: existing } = await guard.admin
    .from("notification_preferences")
    .select("immediate, digest")
    .eq("user_id", guard.userId)
    .eq("event_type", parsed.data.eventType)
    .maybeSingle();
  const row = (existing ?? { immediate: false, digest: false }) as { immediate: boolean; digest: boolean };

  const { error } = await guard.admin.from("notification_preferences").upsert(
    {
      user_id: guard.userId,
      event_type: parsed.data.eventType,
      immediate: parsed.data.channel === "immediate" ? parsed.data.enabled : row.immediate,
      digest: parsed.data.channel === "digest" ? parsed.data.enabled : row.digest,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,event_type" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateDigestSettingsAction(input: {
  digestTime: "07:30" | "12:00" | "17:00";
  weekdaysOnly: boolean;
}): Promise<Result> {
  const parsed = z
    .object({ digestTime: z.enum(["07:30", "12:00", "17:00"]), weekdaysOnly: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("profiles")
    .update({ digest_time: parsed.data.digestTime, digest_weekdays_only: parsed.data.weekdaysOnly })
    .eq("id", guard.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/** External collaborators (password sign-in) can change their password here. */
export async function updatePasswordAction(input: { password: string }): Promise<Result> {
  const parsed = z
    .object({ password: z.string().min(10, "Use at least 10 characters.").max(200) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password." };

  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { error } = await guard.session.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** First password for an account created from an invitation; clears the middleware gate. */
export async function setInitialPasswordAction(input: { password: string }): Promise<Result> {
  const parsed = z
    .object({ password: z.string().min(10, "Use at least 10 characters.").max(200) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password." };

  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { error } = await guard.session.auth.updateUser({
    password: parsed.data.password,
    data: { password_pending: false },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
