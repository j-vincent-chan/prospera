import type { SupabaseClient } from "@supabase/supabase-js";

const SAVED_SEARCH_SELECT_FULL =
  "id, name, state, created_at, updated_at, email_notifications_enabled, alert_frequency, alert_forecasted_notices, alert_rdsg_owner_ids, last_viewed_at, last_matched_at";

const SAVED_SEARCH_SELECT_LEGACY =
  "id, name, state, created_at, updated_at, email_notifications_enabled";

export type SavedFundingSearchRow = {
  id: string;
  name: string;
  state: unknown;
  created_at?: string | null;
  updated_at?: string | null;
  email_notifications_enabled?: boolean | null;
  alert_frequency?: string | null;
  alert_forecasted_notices?: boolean | null;
  alert_rdsg_owner_ids?: string[] | null;
  last_viewed_at?: string | null;
  last_matched_at?: string | null;
};

/** Load the team's saved searches; falls back if alert-settings columns are not migrated yet. */
export async function fetchSavedFundingSearchesForTeam(
  supabase: SupabaseClient,
  teamId: string,
  limit = 25
): Promise<{ rows: SavedFundingSearchRow[]; error: string | null }> {
  const full = await supabase
    .from("saved_funding_searches")
    .select(SAVED_SEARCH_SELECT_FULL)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!full.error) {
    return { rows: (full.data ?? []) as SavedFundingSearchRow[], error: null };
  }

  if (!/alert_frequency|alert_forecasted_notices|alert_rdsg_owner_ids|last_viewed_at|last_matched_at/i.test(full.error.message)) {
    return { rows: [], error: full.error.message };
  }

  const legacy = await supabase
    .from("saved_funding_searches")
    .select(SAVED_SEARCH_SELECT_LEGACY)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (legacy.error) {
    return { rows: [], error: legacy.error.message };
  }

  return { rows: (legacy.data ?? []) as SavedFundingSearchRow[], error: null };
}

const SAVED_SEARCH_EMAIL_SELECT_FULL =
  "id, name, state, email_notifications_enabled, alert_forecasted_notices, alert_rdsg_owner_ids";

const SAVED_SEARCH_EMAIL_SELECT_LEGACY = "id, name, state, email_notifications_enabled";

export type SavedFundingSearchEmailRow = {
  id: string;
  name: string;
  state: unknown;
  email_notifications_enabled?: boolean | null;
  alert_forecasted_notices?: boolean | null;
  alert_rdsg_owner_ids?: string[] | null;
};

/** Load one of the team's saved searches for digest/test email; falls back if alert columns are not migrated yet. */
export async function fetchSavedFundingSearchForEmail(
  supabase: SupabaseClient,
  teamId: string,
  savedSearchId: string
): Promise<{ row: SavedFundingSearchEmailRow | null; error: string | null }> {
  const full = await supabase
    .from("saved_funding_searches")
    .select(SAVED_SEARCH_EMAIL_SELECT_FULL)
    .eq("id", savedSearchId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (!full.error) {
    return { row: (full.data ?? null) as SavedFundingSearchEmailRow | null, error: null };
  }

  if (!/alert_frequency|alert_forecasted_notices|alert_rdsg_owner_ids/i.test(full.error.message)) {
    return { row: null, error: full.error.message };
  }

  const legacy = await supabase
    .from("saved_funding_searches")
    .select(SAVED_SEARCH_EMAIL_SELECT_LEGACY)
    .eq("id", savedSearchId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (legacy.error) {
    return { row: null, error: legacy.error.message };
  }

  return { row: (legacy.data ?? null) as SavedFundingSearchEmailRow | null, error: null };
}
