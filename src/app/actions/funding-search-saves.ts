"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendFundingSearchDigestEmail } from "@/lib/email/send-funding-search-digest";
import {
  loadFundingOpportunityPeek,
  type FundingOpportunityPeekData,
} from "@/lib/funding-opportunities/funding-opportunity-peek";
import { fetchRecentMatchingOpportunitiesForSavedSearch } from "@/lib/funding-opportunities/funding-search-notification-query";
import { fetchSavedFundingSearchForEmail } from "@/lib/funding-opportunities/saved-funding-search-query";
import {
  fundingListStateForBookmark,
  parseSavedFundingListState,
} from "@/lib/funding-opportunities/saved-funding-list-state";
import { resolveSavedSearchAlertRecipientEmails } from "@/lib/funding-opportunities/saved-search-alert-recipients";

const nameSchema = z.string().trim().min(1, "Name is required").max(120, "Name is too long");
const alertFrequencySchema = z.enum(["instant", "daily", "weekly"]);
const savedSearchIdSchema = z.string().uuid();
const rdsgOwnerIdsSchema = z.array(z.string().uuid()).max(20);

async function validateAlertRecipients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  emailEnabled: boolean,
  alertRdsgOwnerIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!emailEnabled) return { ok: true };

  const { emails, warnings } = await resolveSavedSearchAlertRecipientEmails(supabase, {
    userId,
    alertRdsgOwnerIds,
  });

  if (emails.length === 0) {
    const hint =
      alertRdsgOwnerIds.length > 0
        ? "Selected RDSG owners need email addresses on file."
        : "Select at least one RDSG recipient, or add your email to your profile.";
    const detail = warnings[0] ? ` ${warnings[0]}` : "";
    return { ok: false, error: `${hint}${detail}` };
  }

  return { ok: true };
}

/** Shared work always belongs to a team; users in the waiting room can only browse. */
async function currentTeamIdForWrite(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ ok: true; teamId: string } | { ok: false; error: string }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_team_id")
    .eq("id", userId)
    .maybeSingle();
  let teamId = (profile as { current_team_id?: string | null } | null)?.current_team_id ?? null;
  if (!teamId) {
    const { data: membership } = await supabase
      .from("team_memberships")
      .select("team_id")
      .eq("user_id", userId)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    teamId = (membership as { team_id?: string } | null)?.team_id ?? null;
  }
  if (!teamId) return { ok: false, error: "Join a team to save, tag or dismiss opportunities. The catalog stays open to browse." };
  return { ok: true, teamId };
}

export async function saveFundingSearchAction(input: {
  name: string;
  state: unknown;
  emailNotificationsEnabled?: boolean;
  alertFrequency?: "instant" | "daily" | "weekly";
  alertForecastedNotices?: boolean;
  alertRdsgOwnerIds?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in to save a search." };

  const nameParsed = nameSchema.safeParse(input.name);
  if (!nameParsed.success) {
    return { ok: false, error: nameParsed.error.issues[0]?.message ?? "Invalid name" };
  }

  const state = parseSavedFundingListState(input.state);
  if (!state) return { ok: false, error: "Invalid search state." };

  const notify = Boolean(input.emailNotificationsEnabled);
  const frequencyParsed = alertFrequencySchema.safeParse(input.alertFrequency ?? "weekly");
  const alertFrequency = frequencyParsed.success ? frequencyParsed.data : "weekly";
  const rdsgIdsParsed = rdsgOwnerIdsSchema.safeParse(input.alertRdsgOwnerIds ?? []);
  const alertRdsgOwnerIds = rdsgIdsParsed.success ? rdsgIdsParsed.data : [];

  const recipientCheck = await validateAlertRecipients(supabase, user.id, notify, alertRdsgOwnerIds);
  if (!recipientCheck.ok) return recipientCheck;

  const team = await currentTeamIdForWrite(supabase, user.id);
  if (!team.ok) return team;

  const bookmarkState = fundingListStateForBookmark(state);
  const fullRow = {
    user_id: user.id,
    team_id: team.teamId,
    name: nameParsed.data,
    state: bookmarkState,
    email_notifications_enabled: notify,
    alert_frequency: alertFrequency,
    alert_forecasted_notices: input.alertForecastedNotices !== false,
    alert_rdsg_owner_ids: alertRdsgOwnerIds,
  };

  let data: { id: string } | null = null;
  let error: { message: string } | null = null;

  const fullRes = await supabase.from("saved_funding_searches").insert(fullRow).select("id").single();
  data = fullRes.data as { id: string } | null;
  error = fullRes.error;

  if (error && /alert_frequency|alert_forecasted_notices|alert_rdsg_owner_ids|last_viewed_at/i.test(error.message)) {
    const legacyRes = await supabase
      .from("saved_funding_searches")
      .insert({
        user_id: user.id,
        team_id: team.teamId,
        name: nameParsed.data,
        state: bookmarkState,
        email_notifications_enabled: notify,
      })
      .select("id")
      .single();
    data = legacyRes.data as { id: string } | null;
    error = legacyRes.error;
  }

  if (error || !data) return { ok: false, error: error?.message ?? "Could not save search." };
  revalidatePath("/funding-opportunities");
  return { ok: true, id: data.id as string };
}

export async function deleteSavedFundingSearchAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const { error } = await supabase.from("saved_funding_searches").delete().eq("id", id).eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/funding-opportunities");
  return { ok: true };
}

export async function loadFundingOpportunityPeekAction(
  opportunityId: string
): Promise<{ ok: true; data: FundingOpportunityPeekData } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(opportunityId).success) {
    return { ok: false, error: "Invalid opportunity id." };
  }

  const supabase = createClient();

  const data = await loadFundingOpportunityPeek(supabase, opportunityId);
  if (!data) return { ok: false, error: "Opportunity not found." };
  return { ok: true, data };
}

export async function dismissFundingOpportunityAction(
  opportunityId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(opportunityId).success) {
    return { ok: false, error: "Invalid opportunity id." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in to dismiss opportunities." };

  const team = await currentTeamIdForWrite(supabase, user.id);
  if (!team.ok) return team;

  const { data: existing } = await supabase
    .from("dismissed_funding_opportunities")
    .select("opportunity_id")
    .eq("user_id", user.id)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase.from("dismissed_funding_opportunities").insert({
      user_id: user.id,
      team_id: team.teamId,
      opportunity_id: opportunityId,
    });
    if (error) return { ok: false, error: error.message };
  }

  await supabase
    .from("saved_funding_opportunities")
    .delete()
    .eq("user_id", user.id)
    .eq("opportunity_id", opportunityId);

  revalidatePath("/funding-opportunities");
  revalidatePath(`/funding-opportunities/${opportunityId}`);
  return { ok: true };
}

export async function toggleSavedFundingOpportunityAction(
  opportunityId: string
): Promise<{ ok: true; saved: boolean } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(opportunityId).success) {
    return { ok: false, error: "Invalid opportunity id." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in to save opportunities." };

  const team = await currentTeamIdForWrite(supabase, user.id);
  if (!team.ok) return team;

  const { data: existing, error: selErr } = await supabase
    .from("saved_funding_opportunities")
    .select("opportunity_id")
    .eq("user_id", user.id)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr.message };

  if (existing) {
    const { error } = await supabase
      .from("saved_funding_opportunities")
      .delete()
      .eq("user_id", user.id)
      .eq("opportunity_id", opportunityId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/funding-opportunities");
    revalidatePath(`/funding-opportunities/${opportunityId}`);
    return { ok: true, saved: false };
  }

  const { error } = await supabase.from("saved_funding_opportunities").insert({
    user_id: user.id,
    team_id: team.teamId,
    opportunity_id: opportunityId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/funding-opportunities");
  revalidatePath(`/funding-opportunities/${opportunityId}`);
  return { ok: true, saved: true };
}

export async function setSavedFundingSearchEmailNotificationsAction(input: {
  savedSearchId: string;
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateSavedFundingSearchSettingsAction({
    savedSearchId: input.savedSearchId,
    emailNotificationsEnabled: input.enabled,
  });
}

export async function updateSavedFundingSearchSettingsAction(input: {
  savedSearchId: string;
  name?: string;
  state?: unknown;
  emailNotificationsEnabled?: boolean;
  alertFrequency?: "instant" | "daily" | "weekly";
  alertForecastedNotices?: boolean;
  alertRdsgOwnerIds?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const idParsed = savedSearchIdSchema.safeParse(input.savedSearchId);
  if (!idParsed.success) return { ok: false, error: "Invalid saved search id." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const { data: existing } = await supabase
    .from("saved_funding_searches")
    .select("email_notifications_enabled, alert_rdsg_owner_ids")
    .eq("id", idParsed.data)
    .eq("user_id", user.id)
    .maybeSingle();

  const patch: Record<string, unknown> = {};
  const nextEmailEnabled =
    typeof input.emailNotificationsEnabled === "boolean"
      ? input.emailNotificationsEnabled
      : Boolean((existing as { email_notifications_enabled?: boolean } | null)?.email_notifications_enabled);

  if (input.name !== undefined) {
    const nameParsed = nameSchema.safeParse(input.name);
    if (!nameParsed.success) {
      return { ok: false, error: nameParsed.error.issues[0]?.message ?? "Invalid name" };
    }
    patch.name = nameParsed.data;
  }

  if (input.state !== undefined) {
    const state = parseSavedFundingListState(input.state);
    if (!state) return { ok: false, error: "Invalid search state." };
    patch.state = fundingListStateForBookmark(state);
  }

  if (typeof input.emailNotificationsEnabled === "boolean") {
    patch.email_notifications_enabled = input.emailNotificationsEnabled;
  }
  if (input.alertFrequency !== undefined) {
    const frequencyParsed = alertFrequencySchema.safeParse(input.alertFrequency);
    if (!frequencyParsed.success) return { ok: false, error: "Invalid alert frequency." };
    patch.alert_frequency = frequencyParsed.data;
  }
  if (typeof input.alertForecastedNotices === "boolean") {
    patch.alert_forecasted_notices = input.alertForecastedNotices;
  }
  if (input.alertRdsgOwnerIds !== undefined) {
    const rdsgIdsParsed = rdsgOwnerIdsSchema.safeParse(input.alertRdsgOwnerIds);
    if (!rdsgIdsParsed.success) return { ok: false, error: "Invalid RDSG recipient selection." };
    patch.alert_rdsg_owner_ids = rdsgIdsParsed.data;
  }

  const nextRdsgIds =
    input.alertRdsgOwnerIds !== undefined
      ? (patch.alert_rdsg_owner_ids as string[])
      : ((existing as { alert_rdsg_owner_ids?: string[] | null } | null)?.alert_rdsg_owner_ids ?? []);

  const recipientCheck = await validateAlertRecipients(supabase, user.id, nextEmailEnabled, nextRdsgIds);
  if (!recipientCheck.ok) return recipientCheck;

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No settings to update." };
  }

  let { error } = await supabase
    .from("saved_funding_searches")
    .update(patch)
    .eq("id", idParsed.data)
    .eq("user_id", user.id);

  if (error && /alert_rdsg_owner_ids/i.test(error.message) && patch.alert_rdsg_owner_ids !== undefined) {
    const legacyPatch = { ...patch };
    delete legacyPatch.alert_rdsg_owner_ids;
    if (Object.keys(legacyPatch).length === 0) {
      return { ok: false, error: "Alert recipients are not available until the database migration is applied." };
    }
    ({ error } = await supabase
      .from("saved_funding_searches")
      .update(legacyPatch)
      .eq("id", idParsed.data)
      .eq("user_id", user.id));
  }

  if (error) return { ok: false, error: error.message };
  revalidatePath("/funding-opportunities");
  return { ok: true };
}

export async function sendSavedFundingSearchTestEmailAction(
  savedSearchId: string
): Promise<{ ok: true; recipientCount: number; matchCount: number } | { ok: false; error: string }> {
  const idParsed = savedSearchIdSchema.safeParse(savedSearchId);
  if (!idParsed.success) return { ok: false, error: "Invalid saved search id." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const team = await currentTeamIdForWrite(supabase, user.id);
  if (!team.ok) return team;

  const { row, error: loadErr } = await fetchSavedFundingSearchForEmail(
    supabase,
    team.teamId,
    idParsed.data
  );

  if (loadErr || !row) return { ok: false, error: loadErr ?? "Saved search not found." };

  const saved = row;

  if (!saved.email_notifications_enabled) {
    return { ok: false, error: "Turn on email alerts and save before sending a test." };
  }

  const { emails, warnings } = await resolveSavedSearchAlertRecipientEmails(supabase, {
    userId: user.id,
    alertRdsgOwnerIds: saved.alert_rdsg_owner_ids ?? [],
  });
  if (emails.length === 0) {
    return { ok: false, error: warnings[0] ?? "No recipient emails configured." };
  }

  const state = parseSavedFundingListState(saved.state);
  if (!state) return { ok: false, error: "Invalid saved search filters." };

  const sinceIso = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  const { rows, warning } = await fetchRecentMatchingOpportunitiesForSavedSearch(supabase, state, sinceIso, {
    includeForecasted: saved.alert_forecasted_notices !== false,
  });
  if (warning) return { ok: false, error: warning };

  const lines = rows.slice(0, 10).map((r) => ({
    id: r.id,
    title: r.title,
    agency: r.agency,
    opportunityNumber: r.opportunity_number,
  }));

  const send = await sendFundingSearchDigestEmail({
    to: emails,
    searchName: saved.name,
    lines,
    isTest: true,
  });

  if (!send.ok) return { ok: false, error: send.error };
  return { ok: true, recipientCount: emails.length, matchCount: rows.length };
}

export async function markSavedFundingSearchViewedAction(
  savedSearchId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const idParsed = savedSearchIdSchema.safeParse(savedSearchId);
  if (!idParsed.success) return { ok: false, error: "Invalid saved search id." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("saved_funding_searches")
    .update({ last_viewed_at: now })
    .eq("id", idParsed.data)
    .eq("user_id", user.id);

  if (error && /last_viewed_at/i.test(error.message)) {
    return { ok: true };
  }
  if (error) return { ok: false, error: error.message };
  revalidatePath("/funding-opportunities");
  return { ok: true };
}

