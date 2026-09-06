/**
 * The per-team feature flag `teams.fit_engine` (plan § PR 2.2; CLAUDE.md
 * "Feature flag"). The three surfaces — the investigator page's
 * "Opportunities that fit" (outreach/rank-opportunities.ts), Outreach
 * suggestions (outreach/suggest.ts `runSuggestions`) and the community fits
 * cache (communities/fits.ts) — read the acting team's value and serve
 * `fit_results` under `fit-v1`; under `legacy` the embedding engine runs
 * exactly as before. Anything that cannot name a team — no session, a cron
 * with no actor, the column not yet applied — is `legacy`, so a flip for
 * one test team changes nothing for anyone else.
 *
 * The opportunity page and peek's "Best fit in your directory"
 * (funding-opportunities/notice-fit.ts) joined the flagged surfaces in
 * PR 2.3, when the tag-overlap engine behind it was retired (D8).
 *
 * The community fits cache is not team-scoped (one row set per community
 * that every team reads), so every refresh — the nightly and the on-demand
 * one from a screen — takes `fit-v1` only when every team is on it
 * (`loadCronFitEngine`); see communities/fits.ts for why.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const FIT_ENGINES = ["legacy", "fit-v1"] as const;

export type FitEngine = (typeof FIT_ENGINES)[number];

export const DEFAULT_FIT_ENGINE: FitEngine = "legacy";

export const isFitEngine = (v: unknown): v is FitEngine => typeof v === "string" && (FIT_ENGINES as readonly string[]).includes(v);

/** PostgREST's messages for a column or table the schema cache does not know (the migration not applied yet). */
export const FLAG_UNAVAILABLE = /could not find the .*column|column .* does not exist|could not find the table|schema cache/i;

/** The flag value of one team; `legacy` for no team, an unknown team, a value outside the vocabulary, or a database without the column. Never throws. */
export async function loadTeamFitEngine(db: SupabaseClient, teamId: string | null | undefined): Promise<FitEngine> {
  if (!teamId) return DEFAULT_FIT_ENGINE;
  const { data, error } = await db.from("teams").select("fit_engine").eq("id", teamId).maybeSingle();
  if (error) {
    if (!FLAG_UNAVAILABLE.test(error.message)) console.warn(`[fit-flag] teams read failed: ${error.message}`);
    return DEFAULT_FIT_ENGINE;
  }
  const value = (data as { fit_engine?: unknown } | null)?.fit_engine;
  return isFitEngine(value) ? value : DEFAULT_FIT_ENGINE;
}

/** Pure: the engine a run that acts for no team should use — `fit-v1` only when every team is on it and at least one team exists. */
export function cronFitEngine(values: readonly unknown[]): FitEngine {
  if (!values.length) return DEFAULT_FIT_ENGINE;
  return values.every((v) => v === "fit-v1") ? "fit-v1" : DEFAULT_FIT_ENGINE;
}

/** The engine for a run with no acting team (the nightly community-fits refresh). Never throws. */
export async function loadCronFitEngine(db: SupabaseClient): Promise<FitEngine> {
  const { data, error } = await db.from("teams").select("fit_engine").limit(1000);
  if (error) {
    if (!FLAG_UNAVAILABLE.test(error.message)) console.warn(`[fit-flag] teams read failed: ${error.message}`);
    return DEFAULT_FIT_ENGINE;
  }
  return cronFitEngine(((data ?? []) as Array<{ fit_engine?: unknown }>).map((r) => r.fit_engine));
}
