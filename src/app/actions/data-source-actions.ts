"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sendTransactionalTextEmail } from "@/lib/email/send-transactional-text";
import { refreshInvestigatorSources } from "@/lib/investigators/refresh-sources";
import { runSimplerGrantsSyncJob } from "@/lib/services/run-simpler-grants-sync-job";
import { requireTeamRole } from "@/lib/team/require-team";
import { runWorkerPool } from "@/lib/utils/async-rate-limiter";

type Result<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

const BUDGET_MS = 50_000;

/** Run the Simpler.Grants.gov sync now (owners and admins). */
export async function syncSimplerNowAction(): Promise<Result<{ summary: string }>> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  try {
    const r = await runSimplerGrantsSyncJob(guard.admin, { source: "manual_ui", enrichWithDetailFetch: false });
    revalidatePath("/team/data-sources");
    revalidatePath("/opportunities");
    revalidatePath("/home");
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, summary: `${r.upserted} notice${r.upserted === 1 ? "" : "s"} upserted · ${r.pagesFetched} page${r.pagesFetched === 1 ? "" : "s"}${r.errors.length ? ` · ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}` : ""}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-run PubMed for the profiles whose last refresh failed, within the action's time budget. */
export async function retryFailedPubmedAction(): Promise<Result<{ retried: number; remaining: number }>> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  const { data } = await guard.admin.from("investigator_sources").select("investigator_id").eq("source", "pubmed").eq("state", "error").limit(40);
  const ids = ((data ?? []) as Array<{ investigator_id: string }>).map((r) => r.investigator_id);
  const started = Date.now();
  let retried = 0;
  await runWorkerPool(ids, 3, async (id) => {
    if (Date.now() - started > BUDGET_MS) return;
    await refreshInvestigatorSources(guard.admin, id, ["pubmed"]);
    retried += 1;
  });
  revalidatePath("/team/data-sources");
  return { ok: true, retried, remaining: ids.length - retried };
}

/** Look up UCSF Profiles and ORCID for people never tried, within the time budget; the nightly job finishes the rest. */
export async function refreshConnectorsAction(): Promise<Result<{ refreshed: number; remaining: number }>> {
  const guard = await requireTeamRole("admin");
  if (!guard.ok) return guard;
  const { data } = await guard.admin.from("investigator_sources").select("investigator_id").eq("source", "profiles").is("last_attempted_at", null).limit(60);
  const ids = ((data ?? []) as Array<{ investigator_id: string }>).map((r) => r.investigator_id);
  const started = Date.now();
  let refreshed = 0;
  await runWorkerPool(ids, 3, async (id) => {
    if (Date.now() - started > BUDGET_MS) return;
    await refreshInvestigatorSources(guard.admin, id, ["profiles", "orcid"]);
    refreshed += 1;
  });
  revalidatePath("/team/data-sources");
  revalidatePath("/investigators");
  return { ok: true, refreshed, remaining: ids.length - refreshed };
}

/** A test message to the signed-in person, from the outreach sender identity. */
export async function sendTestEmailAction(): Promise<Result<{ to: string }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const to = guard.actor.email;
  if (!to) return { ok: false, error: "Your profile has no email address." };
  const res = await sendTransactionalTextEmail({ to, subject: "Prospera test message", text: "This is a test from Prospera's email delivery. If you can read this, outreach messages will arrive the same way.", fromName: `${guard.actor.fullName ?? "Prospera"} via Prospera` });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, to };
}

/** Stamp the Home visit so "since your last visit" counts move forward. */
export async function markHomeVisitAction(): Promise<Result> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  await guard.admin.from("profiles").update({ last_home_visit_at: new Date().toISOString() }).eq("id", guard.actor.userId);
  return { ok: true };
}

export const _schema = z.object({});
