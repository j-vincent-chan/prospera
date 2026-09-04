/**
 * Fit engine · PR 0.1b · correct wrong RePORTER profile ids.
 *
 *   npm run fit:fix-profile-ids -- --set <investigator_id>=<profile_id|null> [--set …]   # dry run (default)
 *   npm run fit:fix-profile-ids -- --set <investigator_id>=null --apply                  # write
 *   npm run fit:fix-profile-ids -- --set-orcid <investigator_id>=<orcid>                 # also record an ORCID iD
 *   npm run fit:fix-profile-ids -- --swap-names <investigator_id>                        # first_name ⇄ last_name
 *
 * --set-orcid writes investigators.orcid and the investigator_sources 'orcid'
 * row (state available, identity self, meta.note with the provenance); when
 * the same person also has a --set, the grant provenance note mentions it.
 * --swap-names exchanges first_name and last_name (and full_name when it was
 * "first last"), recording the change in the pubmed source row's meta.
 *
 * For each investigator named with --set:
 *   a. investigators.nih_profile_id ← the confirmed value, or NULL;
 *   b. existing investigator_nih_grants rows → identity_status 'rejected' with a
 *      provenance_note naming the wrong profile id and the PI RePORTER resolves it
 *      to (rows are kept, never deleted);
 *   c. the investigator_sources 'reporter' row → state 'unavailable', identity
 *      cleared, last_error explaining why.
 *
 * Stale evidence_embeddings for the rejected grants need no separate delete:
 * syncInvestigatorEmbeddings (src/lib/outreach/embeddings.ts) builds its wanted
 * set from grants with identity_status <> 'rejected' and deletes every existing
 * evidence_embeddings row that is not in that set, so the next embeddings pass
 * (nightly cron or a source refresh) drops them.
 *
 * Requires migration 20260911110000_nih_grants_provenance_note.sql.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const values = (flag: string) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]!] : []));
const UUID = /^[0-9a-f-]{36}$/i;
const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i;
const BY = "fit-fix-profile-ids";

const plan = values("--set").map((s) => {
  const [id, raw] = s.split("=");
  const value = String(raw ?? "").trim().toLowerCase();
  if (!id || !UUID.test(id) || !(value === "null" || /^\d+$/.test(value))) {
    console.error(`Bad --set "${s}": expected <uuid>=<digits|null>.`);
    process.exit(1);
  }
  return { investigatorId: id, next: value === "null" ? null : value };
});
const orcidByInvestigator = new Map<string, string>();
for (const s of values("--set-orcid")) {
  const [id, raw] = s.split("=");
  const orcid = String(raw ?? "").trim().toUpperCase();
  if (!id || !UUID.test(id) || !ORCID.test(orcid)) {
    console.error(`Bad --set-orcid "${s}": expected <uuid>=0000-0000-0000-0000.`);
    process.exit(1);
  }
  orcidByInvestigator.set(id, orcid);
}
const swaps = values("--swap-names");
for (const id of swaps) {
  if (!UUID.test(id)) {
    console.error(`Bad --swap-names "${id}": expected <uuid>.`);
    process.exit(1);
  }
}
if (!plan.length && !orcidByInvestigator.size && !swaps.length) {
  console.error("Pass at least one --set <investigator_id>=<profile_id|null>, --set-orcid <id>=<orcid>, or --swap-names <id>.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** Who RePORTER says a profile id belongs to (first project's matching PI entry). */
async function resolveProfileId(profileId: string): Promise<string> {
  const res = await fetch("https://api.reporter.nih.gov/v2/projects/search", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ criteria: { pi_profile_ids: [Number(profileId)] }, include_fields: ["PrincipalInvestigators"], offset: 0, limit: 5 }),
    cache: "no-store",
  });
  if (!res.ok) return `(RePORTER HTTP ${res.status})`;
  const json = (await res.json()) as { results?: Array<{ principal_investigators?: Array<Record<string, unknown>> }> };
  for (const r of json.results ?? []) {
    const pi = (r.principal_investigators ?? []).find((p) => String(p.profile_id) === profileId);
    if (pi) return String(pi.full_name ?? `${pi.first_name ?? ""} ${pi.last_name ?? ""}`).replace(/\s+/g, " ").trim();
  }
  return "(no projects returned for this profile id)";
}

/** Refuse to write anything if the provenance_note column (migration 20260911110000) is missing. */
async function preflight(): Promise<void> {
  const { error } = await db.from("investigator_nih_grants").select("provenance_note").limit(1);
  if (!error) return;
  const msg = `investigator_nih_grants.provenance_note is missing (${error.message}). Apply supabase/migrations/20260911110000_nih_grants_provenance_note.sql first.`;
  if (APPLY) {
    console.error(msg);
    process.exit(1);
  }
  console.log(`WARNING: ${msg} --apply will refuse to run until it is applied.\n`);
}

async function setOrcid(investigatorId: string, orcid: string, fullName: string, previous: string | null): Promise<void> {
  const note = `orcid ${orcid} set ${new Date().toISOString().slice(0, 10)} by ${BY} from the ORCID link on the intake form${previous ? ` (was ${previous})` : ""}`;
  console.log(`- orcid: ${previous ?? "NULL"} → ${orcid}; investigator_sources.orcid → available (self); meta.note: ${note}`);
  if (!APPLY) return;
  const { error: e1 } = await db.from("investigators").update({ orcid }).eq("id", investigatorId);
  if (e1) throw new Error(`update investigators.orcid for ${fullName}: ${e1.message}`);
  const { data: cur } = await db.from("investigator_sources").select("meta").eq("investigator_id", investigatorId).eq("source", "orcid").maybeSingle();
  const meta = { ...((cur?.meta as Record<string, unknown> | null) ?? {}), note };
  const { error: e2 } = await db.from("investigator_sources").upsert(
    {
      investigator_id: investigatorId,
      source: "orcid",
      state: "available",
      identity_method: "self",
      external_id: orcid,
      external_url: `https://orcid.org/${orcid}`,
      last_error: null,
      meta,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "investigator_id,source" }
  );
  if (e2) throw new Error(`investigator_sources orcid for ${fullName}: ${e2.message}`);
}

async function swapNames(investigatorId: string): Promise<void> {
  const { data: inv, error } = await db
    .from("investigators")
    .select("id, first_name, last_name, full_name")
    .eq("id", investigatorId)
    .maybeSingle();
  if (error || !inv) throw new Error(`investigator ${investigatorId}: ${error?.message ?? "not found"}`);
  const first = String(inv.first_name ?? "").trim();
  const last = String(inv.last_name ?? "").trim();
  const full = String(inv.full_name ?? "").trim();
  const nextFull = full === `${first} ${last}` ? `${last} ${first}` : full;
  const note = { from: { first_name: first, last_name: last, full_name: full }, to: { first_name: last, last_name: first, full_name: nextFull }, at: new Date().toISOString(), by: BY, reason: "intake sheets stored the surname in the first-name column; PubMed indexes the surname" };
  console.log(`## ${full} (${inv.id}) — swap names`);
  console.log(`- first_name ${first} → ${last}; last_name ${last} → ${first}; full_name ${full} → ${nextFull}${nextFull === full ? " (left as is: not \"first last\")" : ""}`);
  console.log(`- investigator_sources.pubmed meta.name_swap: ${JSON.stringify(note)}`);
  if (!APPLY) {
    console.log("");
    return;
  }
  const { error: e1 } = await db.from("investigators").update({ first_name: last, last_name: first, full_name: nextFull }).eq("id", inv.id);
  if (e1) throw new Error(`swap names for ${full}: ${e1.message}`);
  const { data: cur } = await db.from("investigator_sources").select("meta").eq("investigator_id", inv.id).eq("source", "pubmed").maybeSingle();
  const meta = { ...((cur?.meta as Record<string, unknown> | null) ?? {}), name_swap: note };
  const { error: e2 } = await db.from("investigator_sources").upsert(
    { investigator_id: inv.id, source: "pubmed", meta, updated_at: new Date().toISOString() },
    { onConflict: "investigator_id,source" }
  );
  if (e2) throw new Error(`investigator_sources pubmed for ${full}: ${e2.message}`);
  console.log("  ✓ applied\n");
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(APPLY ? "APPLY mode — writing changes.\n" : "Dry run — nothing is written. Add --apply to write.\n");
  await preflight();
  const handledOrcid = new Set<string>();
  for (const item of plan) {
    const { data: inv, error } = await db
      .from("investigators")
      .select("id, full_name, nih_profile_id")
      .eq("id", item.investigatorId)
      .maybeSingle();
    if (error || !inv) throw new Error(`investigator ${item.investigatorId}: ${error?.message ?? "not found"}`);
    const oldId = String(inv.nih_profile_id ?? "").replace(/\D/g, "") || null;
    const resolvesTo = oldId ? await resolveProfileId(oldId) : "(no profile id set)";
    const { data: grants } = await db
      .from("investigator_nih_grants")
      .select("id, project_num, fiscal_year, identity_status")
      .eq("investigator_id", inv.id);
    const toReject = (grants ?? []).filter((g) => g.identity_status !== "rejected");
    const orcid = orcidByInvestigator.get(inv.id) ?? null;
    const orcidNote = orcid ? `; orcid ${orcid} recorded from the intake form for PubMed identity` : "";
    const note = `rejected ${today} by ${BY}: fetched with nih_profile_id ${oldId ?? "—"}, which RePORTER resolves to ${resolvesTo}, not ${inv.full_name}${orcidNote}`;
    const lastError = `nih_profile_id ${oldId ?? "—"} resolved to ${resolvesTo} (RePORTER); cleared ${today} by ${BY}. ${item.next ? `Set to ${item.next}; refresh RePORTER to load projects.` : "No confirmed profile id; set one, then refresh RePORTER."}${orcidNote}`;

    console.log(`## ${inv.full_name} (${inv.id})`);
    console.log(`- nih_profile_id: ${oldId ?? "NULL"} → ${item.next ?? "NULL"}   (RePORTER says ${oldId ?? "—"} is ${resolvesTo})`);
    console.log(`- grants: ${grants?.length ?? 0} rows, ${toReject.length} to mark rejected${toReject.length ? ": " + toReject.map((g) => `${g.project_num} FY${g.fiscal_year}`).join(", ") : ""}`);
    console.log(`- provenance_note: ${note}`);
    console.log(`- investigator_sources.reporter → ${item.next ? "available" : "unavailable"}; last_error: ${lastError}`);
    if (orcid) {
      const { data: cur } = await db.from("investigators").select("orcid").eq("id", inv.id).maybeSingle();
      await setOrcid(inv.id, orcid, String(inv.full_name), (cur?.orcid as string | null) ?? null);
      handledOrcid.add(inv.id);
    }

    if (!APPLY) {
      console.log("");
      continue;
    }
    const { error: e1 } = await db.from("investigators").update({ nih_profile_id: item.next }).eq("id", inv.id);
    if (e1) throw new Error(`update investigators: ${e1.message}`);
    if (toReject.length) {
      const { error: e2 } = await db
        .from("investigator_nih_grants")
        .update({ identity_status: "rejected", provenance_note: note, reviewed_at: new Date().toISOString() })
        .in("id", toReject.map((g) => g.id));
      if (e2) throw new Error(`reject grants: ${e2.message}`);
    }
    const { error: e3 } = await db.from("investigator_sources").upsert(
      {
        investigator_id: inv.id,
        source: "reporter",
        state: item.next ? "available" : "unavailable",
        identity_method: item.next ? "profile_id" : null,
        external_id: item.next,
        external_url: item.next ? `https://reporter.nih.gov/search/results?pi_profile_ids=${item.next}` : null,
        item_count: 0,
        last_error: lastError,
        last_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "investigator_id,source" }
    );
    if (e3) throw new Error(`investigator_sources: ${e3.message}`);
    console.log("  ✓ applied\n");
  }

  for (const [id, orcid] of orcidByInvestigator) {
    if (handledOrcid.has(id)) continue;
    const { data: inv, error } = await db.from("investigators").select("id, full_name, orcid").eq("id", id).maybeSingle();
    if (error || !inv) throw new Error(`investigator ${id}: ${error?.message ?? "not found"}`);
    console.log(`## ${inv.full_name} (${inv.id}) — ORCID only`);
    await setOrcid(inv.id, orcid, String(inv.full_name), (inv.orcid as string | null) ?? null);
    console.log(APPLY ? "  ✓ applied\n" : "");
  }

  for (const id of swaps) await swapNames(id);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
