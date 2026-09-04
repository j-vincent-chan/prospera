/**
 * Strategy brief: a short, generated paragraph for the community overview
 * (design: "Strategy brief · generated Aug 28"). Inputs are the curated
 * profile, roster size, 12-month signals, top themes and open fits; the
 * output is labeled generated and regenerated on demand.
 */
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCommunityOverview } from "@/lib/communities/queries";

const MODEL = "gpt-4o-mini";

export async function generateCommunityBrief(db: SupabaseClient, communityId: string, opts: { teamId: string | null; today: string; actorId: string | null }): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured, so a brief can't be generated." };
  const ov = await loadCommunityOverview(db, communityId, { teamId: opts.teamId, today: opts.today });
  if (!ov) return { ok: false, error: "Community not found." };
  const c = ov.community;
  const inputs = {
    label: c.label,
    mission: c.mission,
    focus: c.focus,
    keywords: c.keywords,
    populations: c.populations,
    members: ov.meta.members,
    leads: ov.leads.names,
    signals12mo: ov.meta.signals12mo,
    themes: ov.themes.map((t) => `${t.label} (${t.n})`),
    fits: ov.fits.rows.slice(0, 6).map((f) => ({ title: f.title, meta: f.meta, close: f.close.label, who: f.whoFull })),
    outreach: ov.outreach.stages.filter((s) => s.n).map((s) => `${s.name}: ${s.n}`),
  };
  const user = `Community: ${c.label}\nMission: ${c.mission ?? "(not curated)"}\nFocus: ${c.focus ?? "(not curated)"}\nKeywords: ${c.keywords.join(", ") || "(none)"}\nPopulations: ${c.populations.join(", ") || "(none)"}\nRoster: ${ov.meta.members} investigators; leads: ${ov.leads.names}\nSignals in the last 12 months (publications, competing grants, trials): ${ov.meta.signals12mo}\nTop themes (12 months): ${inputs.themes.join("; ") || "(none detected)"}\nOpen opportunities that fit (notice · who · deadline):\n${inputs.fits.map((f) => `- ${f.title} · ${f.meta} · ${f.close}${f.who ? ` · ${f.who}` : ""}`).join("\n") || "- none cached yet"}\nOutreach in progress: ${inputs.outreach.join(", ") || "none"}\n\nWrite one paragraph of 3–5 sentences for a research-development strategist: what the community's recent activity shows, which themes are rising, and which open opportunities deserve attention and why (name investigators only from the lists above). Plain prose, no bullet points, no headings, no invented numbers.`;
  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 320,
      messages: [
        { role: "system", content: "You write concise, factual strategy briefs for a university research-development office. Use only the facts provided. Never fabricate names, counts or deadlines." },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: "The model returned an empty brief." };
    await db.from("pipeline_communities").update({ brief_text: text, brief_generated_at: new Date().toISOString(), brief_generated_by: opts.actorId, brief_model: MODEL, brief_inputs: inputs, updated_at: new Date().toISOString() }).eq("id", communityId);
    return { ok: true, text, model: MODEL };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Brief generation failed." };
  }
}
