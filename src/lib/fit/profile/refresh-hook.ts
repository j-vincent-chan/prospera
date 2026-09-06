/**
 * The fit-profile step at the end of `refreshInvestigatorSources` (plan
 * § PR 1.4: "also called from refreshInvestigatorSources completion").
 * Rules and the item cache only — `modelBudget: 0`, so the request path
 * never pays for the classifier; items the model has not seen stay pending
 * and the nightly cron finishes them.
 *
 * A hook must never fail a source refresh, and before the fit migrations are
 * applied it must not even complain: when `investigator_fit_profiles` or
 * `fit_item_profiles` is not on the database, or the descriptor index is
 * empty, the outcome is `ok: true, skipped: true` with a neutral message.
 * Any other failure is `ok: false` on this outcome alone (`source: "fit"`),
 * never thrown, and never counted against PubMed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MESH_EMPTY } from "@/lib/fit/classify/mesh-db";
import { buildInvestigatorFitProfile, MISSING_TABLE } from "@/lib/fit/profile/investigator";
import { profilesTableExists } from "@/lib/fit/profile/sync";

export type FitProfileRefreshOutcome = {
  ok: boolean;
  /** Nothing was built for a benign reason (the migrations or the descriptor table are not there yet). */
  skipped?: boolean;
  message: string;
  /** Items awaiting the nightly classifier, when a profile was written. */
  pending_items?: number;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Rebuild one investigator's fit profile from the rules and the item cache. Never throws. */
export async function rebuildFitProfileAfterRefresh(db: SupabaseClient, investigatorId: string): Promise<FitProfileRefreshOutcome> {
  try {
    if (!(await profilesTableExists(db))) {
      return { ok: true, skipped: true, message: "Fit profile: not built (the fit-profile tables are not on this database yet)." };
    }
    const r = await buildInvestigatorFitProfile(db, investigatorId, { modelBudget: 0 });
    const n = r.item_count;
    const pending = r.pending_items;
    return {
      ok: true,
      pending_items: pending,
      message: `Fit profile: rebuilt from ${n} item${n === 1 ? "" : "s"}${pending ? `; ${pending === 1 ? "1 item awaits" : `${pending} items await`} the nightly classifier` : ""}.`,
    };
  } catch (e) {
    const message = errMsg(e);
    if (MISSING_TABLE.test(message)) return { ok: true, skipped: true, message: "Fit profile: not built (the fit-profile tables are not on this database yet)." };
    if (MESH_EMPTY.test(message)) return { ok: true, skipped: true, message: "Fit profile: not built (the MeSH descriptor table is empty)." };
    return { ok: false, message: `Fit profile: ${message}` };
  }
}
