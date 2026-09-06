/**
 * Fit engine · PR 2.2 · notice MeSH coverage, read-only.
 *
 *   npm run fit:notice-mesh-report                 # every stored opportunity_fit_profiles row
 *   npm run fit:notice-mesh-report -- --limit 50   # the first N rows (opportunity_id order)
 *   npm run fit:notice-mesh-report -- --json       # the summary as JSON on stdout
 *
 * Maps each stored profile's topic terms and RCDC names to MeSH descriptors
 * by folded name (src/lib/fit/topic/notice-mesh.ts — exact, singular /
 * plural, possessive dropped; no fuzzy matching, no model; a descriptor
 * above compose.topic.min_specific_depth_for_strong is dropped as shallow)
 * and prints the coverage: notices with ≥ 1 mapped code, the median codes
 * per notice, the match forms, and the most frequent unmapped terms, the
 * shallow ones tallied apart. Reads opportunity_fit_profiles and
 * mesh_descriptors; writes nothing.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadMeshIndex } from "../src/lib/fit/classify/mesh-db";
import { topicWeights } from "../src/lib/fit/taxonomy";
import { buildMeshNameIndex, mapNoticeMesh, type NoticeMeshResult } from "../src/lib/fit/topic/notice-mesh";
import { computeIdf } from "../src/lib/fit/topic/idf";
import type { OpportunityFitProfile } from "../src/lib/fit/types";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const LIMIT = opt("--limit") ? Number(opt("--limit")) : null;
const JSON_OUT = flag("--json");
const PAGE = 200;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

type Row = { opportunity_id: string; profile: OpportunityFitProfile };

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

async function main(): Promise<void> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("opportunity_fit_profiles").select("opportunity_id, profile").order("opportunity_id").range(from, from + PAGE - 1);
    if (error) throw new Error(`opportunity_fit_profiles read failed: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (LIMIT != null && rows.length >= LIMIT) {
      rows.splice(LIMIT);
      break;
    }
    if (!data || data.length < PAGE) break;
  }
  const started = Date.now();
  const names = buildMeshNameIndex(await loadMeshIndex(supabase));
  console.error(`mesh_descriptors: ${names.size} folded names (${Date.now() - started} ms); ${rows.length} stored profile(s)`);

  const results: Array<{ number: string; terms: number; rcdc: number; r: NoticeMeshResult }> = rows.map((row) => ({ number: row.profile.number, terms: row.profile.topic.terms.length, rcdc: row.profile.topic.rcdc.length, r: mapNoticeMesh(row.profile.topic, names) }));
  const withTerms = results.filter((x) => x.terms + x.rcdc > 0).length;
  const mapped = results.filter((x) => x.r.mesh.length > 0);
  const codes = mapped.map((x) => x.r.mesh.length);
  const via: Record<string, number> = {};
  const source: Record<string, number> = {};
  const depths: Record<string, number> = {};
  const unmapped = new Map<string, number>();
  const shallow = new Map<string, number>();
  let termsTotal = 0;
  let matchesTotal = 0;
  let shallowTotal = 0;
  for (const x of results) {
    termsTotal += x.terms + x.rcdc;
    for (const m of x.r.matches) {
      matchesTotal += 1;
      via[m.via] = (via[m.via] ?? 0) + 1;
      source[m.source] = (source[m.source] ?? 0) + 1;
      for (const t of m.tree_numbers) {
        const d = String(t.split(".").length);
        depths[d] = (depths[d] ?? 0) + 1;
      }
    }
    for (const u of x.r.unmapped) {
      const into = u.reason === "shallow" ? shallow : unmapped;
      into.set(u.term.toLowerCase(), (into.get(u.term.toLowerCase()) ?? 0) + 1);
      if (u.reason === "shallow") shallowTotal += 1;
    }
  }
  const specific = mapped.filter((x) => x.r.mesh.some((t) => t.split(".").length >= 3)).length;
  const idf = computeIdf(results.map((x) => ({ id: x.number, mesh: x.r.mesh, rcdc: [] })));
  const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
  const topUnmapped = Array.from(unmapped.entries()).sort(byCount).slice(0, 40);
  const topShallow = Array.from(shallow.entries()).sort(byCount).slice(0, 20);
  const summary = {
    profiles: rows.length,
    with_terms_or_rcdc: withTerms,
    notices_with_mapped_code: mapped.length,
    share_mapped: rows.length ? Number((mapped.length / rows.length).toFixed(3)) : 0,
    notices_with_depth3_code: specific,
    median_codes_per_mapped_notice: median(codes),
    max_codes: codes.length ? Math.max(...codes) : 0,
    terms_total: termsTotal,
    terms_mapped: matchesTotal,
    terms_shallow: shallowTotal,
    share_terms_mapped: termsTotal ? Number((matchesTotal / termsTotal).toFixed(3)) : 0,
    via,
    source,
    code_depths: depths,
    idf_codes: idf.rows.length,
    top_unmapped: topUnmapped,
    top_shallow: topShallow,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), summary }, null, 2));
    return;
  }
  console.log(`# fit:notice-mesh-report — ${new Date().toISOString()}\n`);
  console.log(`profiles ${summary.profiles} · with terms or RCDC ${summary.with_terms_or_rcdc} · with ≥ 1 mapped MeSH code ${summary.notices_with_mapped_code} (${(summary.share_mapped * 100).toFixed(1)}%) · with a depth ≥ 3 code ${summary.notices_with_depth3_code}`);
  console.log(`codes per mapped notice: median ${summary.median_codes_per_mapped_notice}, max ${summary.max_codes} · terms ${summary.terms_total}, mapped ${summary.terms_mapped} (${(summary.share_terms_mapped * 100).toFixed(1)}%), shallow ${summary.terms_shallow} (a descriptor above depth ${topicWeights().min_specific_depth_for_strong}, dropped)`);
  console.log(`match forms: ${Object.entries(via).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} · by source: ${Object.entries(source).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}`);
  console.log(`tree-number depths: ${Object.entries(depths).sort().map(([k, v]) => `depth ${k}: ${v}`).join(", ") || "—"} · IDF prefixes over the mapped corpus: ${summary.idf_codes}`);
  console.log(`\n## Top unmapped terms (notices)`);
  for (const [term, n] of topUnmapped) console.log(`  ${String(n).padStart(4)}  ${term}`);
  console.log(`\n## Top shallow terms, dropped (notices)`);
  for (const [term, n] of topShallow) console.log(`  ${String(n).padStart(4)}  ${term}`);
  console.log(`\n## Sample of mapped notices`);
  for (const x of mapped.slice(0, 12)) console.log(`  ${x.number}: ${x.r.matches.map((m) => `${m.term} → ${m.name} [${m.tree_numbers.join(", ")}] (${m.via})`).join("; ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
