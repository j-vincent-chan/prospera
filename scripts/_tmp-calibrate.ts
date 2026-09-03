import { createClient } from "@supabase/supabase-js";
import { embedText, toVector } from "../src/lib/outreach/embeddings";
import { parseProfile, profileQueryText, extractOpportunityProfile, profileIsEmpty } from "../src/lib/outreach/profile";
import { runSuggestions, SIM } from "../src/lib/outreach/suggest";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const itemId = process.argv[2];
(async () => {
  const { data: item } = await db.from("outreach_items").select("id, opportunity_id, profile, profile_version, funding_opportunities(*)").eq("id", itemId).single();
  const fo: any = (item as any).funding_opportunities;
  console.log("ITEM:", fo.opportunity_number, "·", fo.title);
  let profile = parseProfile((item as any).profile);
  if (profileIsEmpty(profile)) {
    profile = await extractOpportunityProfile(db, fo, 0);
    await db.from("outreach_items").update({ profile, profile_version: profile.version }).eq("id", itemId);
  }
  console.log("PROFILE:", JSON.stringify(profile.facets, null, 1));
  const q = await embedText(profileQueryText(profile, fo));
  const { data: rows, error } = await db.rpc("match_evidence", { query_embedding: toVector(q), match_count: 900, min_similarity: 0.15 });
  if (error) throw error;
  const by = new Map<string, any[]>();
  for (const r of rows as any[]) by.set(r.investigator_id, [...(by.get(r.investigator_id) ?? []), r]);
  const { data: people } = await db.from("investigators").select("id, full_name");
  const name = new Map((people ?? []).map((p: any) => [p.id, p.full_name]));
  const ranked = [...by.entries()].map(([id, items]) => ({ id, name: name.get(id), top: items[0].similarity, n: items.length, support: items.filter((i: any) => i.similarity >= SIM.support).length, kinds: [...new Set(items.filter((i: any) => i.similarity >= SIM.support).map((i: any) => i.kind))].join("/"), best: String(items[0].content).slice(0, 80) })).sort((a, b) => b.top - a.top);
  console.log(`\nRANKED (${ranked.length} people with any item ≥ 0.15); thresholds`, SIM);
  for (const r of ranked.slice(0, 25)) console.log(` ${r.top.toFixed(3)} sup=${r.support} kinds=${r.kinds || "-"} ${String(r.name).padEnd(26)} ${r.best}`);
  const sims = (rows as any[]).map((r) => r.similarity).sort((a, b) => b - a);
  const pct = (p: number) => sims[Math.floor(sims.length * p)]?.toFixed(3);
  console.log(`\nitem sims: n=${sims.length} max=${sims[0]?.toFixed(3)} p1=${pct(0.01)} p5=${pct(0.05)} p10=${pct(0.1)} p25=${pct(0.25)} p50=${pct(0.5)}`);
  if (process.argv.includes("--run")) {
    const r = await runSuggestions(db, itemId!);
    console.log("RUN:", JSON.stringify(r).slice(0, 300));
    const { data: sugg } = await db.from("outreach_suggestions").select("tier, status, score, flags, reasons, investigators(full_name)").eq("item_id", itemId).order("score", { ascending: false });
    for (const s of sugg ?? []) console.log(` ${String(s.tier).padEnd(11)} ${String(s.status).padEnd(9)} ${Number(s.score).toFixed(3)} ${String((s as any).investigators?.full_name).padEnd(26)} ${(s.flags as any[]).map((f) => f.kind).join(",").padEnd(12)} ${(s.reasons as any[])[0]?.text.slice(0, 90)}`);
  }
})();
