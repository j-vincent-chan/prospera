/**
 * Opportunity profile: the nine facets a notice is matched on. Extracted by
 * the model from the notice text (every facet names the section it came
 * from), editable by a strategist, versioned so suggestions can say which
 * profile they were ranked against.
 */

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FACETS, type FacetKey, type OpportunityProfile } from "@/lib/outreach/types";

const MODEL = "gpt-4o-mini";

export type NoticeForProfile = {
  id: string;
  title: string | null;
  opportunity_number: string | null;
  agency: string | null;
  description: string | null;
  raw_payload_json: unknown;
  activity_code: string | null;
  activity_title: string | null;
  award_ceiling: number | null;
  clinical_trial_note: string | null;
  applicant_types: unknown;
  funding_instrument: string | null;
};

export function emptyFacets(): Record<FacetKey, string[]> {
  return { topics: [], disease: [], methods: [], disciplines: [], stage: [], mechanism: [], eligibility: [], team: [], excluded: [] };
}

export function emptyProfile(): OpportunityProfile {
  return { version: 0, extractedAt: null, source: "empty", facets: emptyFacets() };
}

export function parseProfile(raw: unknown): OpportunityProfile {
  if (!raw || typeof raw !== "object") return emptyProfile();
  const r = raw as Partial<OpportunityProfile>;
  const facets = emptyFacets();
  for (const f of FACETS) {
    const v = (r.facets as Record<string, unknown> | undefined)?.[f.key];
    if (Array.isArray(v)) facets[f.key] = v.map((x) => String(x).trim()).filter(Boolean);
  }
  return { version: typeof r.version === "number" ? r.version : 0, extractedAt: r.extractedAt ?? null, source: r.source ?? "empty", facets, sections: r.sections ?? {}, editedBy: r.editedBy ?? null, editedAt: r.editedAt ?? null };
}

export function profileIsEmpty(p: OpportunityProfile): boolean {
  return FACETS.every((f) => p.facets[f.key].length === 0);
}

export function facetCount(p: OpportunityProfile): number {
  return FACETS.reduce((n, f) => n + p.facets[f.key].length, 0);
}

/** The text the ranking embeds: what the notice wants, minus what it excludes. */
export function profileQueryText(p: OpportunityProfile, notice: { title: string | null }): string {
  const parts = [notice.title ?? ""];
  for (const f of FACETS) {
    if (f.excluded) continue;
    if (p.facets[f.key].length) parts.push(`${f.label}: ${p.facets[f.key].join(", ")}`);
  }
  return parts.filter(Boolean).join(". ");
}

function noticeText(n: NoticeForProfile): { body: string; eligibility: string } {
  const summary = (n.raw_payload_json as { summary?: Record<string, unknown> } | null)?.summary ?? {};
  const desc = typeof summary.summary_description === "string" && summary.summary_description.length > (n.description?.length ?? 0) ? summary.summary_description : n.description ?? "";
  const elig = typeof summary.applicant_eligibility_description === "string" ? summary.applicant_eligibility_description : "";
  return { body: desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 9_000), eligibility: elig.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2_500) };
}

/** Deterministic fallback from the pipeline's controlled-vocabulary tags. */
async function profileFromTags(db: SupabaseClient, n: NoticeForProfile): Promise<OpportunityProfile> {
  const { data } = await db.from("opportunity_features").select("science_tags, disease_tags, method_tags, translational_tags, collaboration_complexity").eq("opportunity_id", n.id).maybeSingle();
  const f = (data ?? {}) as { science_tags?: string[]; disease_tags?: string[]; method_tags?: string[]; translational_tags?: string[]; collaboration_complexity?: string };
  const facets = emptyFacets();
  facets.topics = [...(f.science_tags ?? []), ...(f.translational_tags ?? [])].map((t) => t.replaceAll("_", " ")).slice(0, 8);
  facets.disease = (f.disease_tags ?? []).map((t) => t.replaceAll("_", " ")).slice(0, 6);
  facets.methods = (f.method_tags ?? []).map((t) => t.replaceAll("_", " ")).slice(0, 6);
  if (n.activity_code) facets.mechanism.push(n.activity_code);
  if (n.award_ceiling) facets.mechanism.push(`$${Math.round(n.award_ceiling / 1000)}K ceiling`);
  if (f.collaboration_complexity === "multi_pi") facets.team.push("multi-PI allowed");
  if (n.clinical_trial_note) facets.excluded.push(n.clinical_trial_note.toLowerCase().includes("not allowed") ? "clinical trials" : "");
  facets.excluded = facets.excluded.filter(Boolean);
  return { version: 1, extractedAt: new Date().toISOString(), source: "tags", facets, sections: {} };
}

const SCHEMA_HINT = `Return JSON with this exact shape:
{"topics": string[], "disease": string[], "methods": string[], "disciplines": string[], "stage": string[], "mechanism": string[], "eligibility": string[], "team": string[], "excluded": string[], "sections": {"topics": string, "disease": string, "methods": string, "disciplines": string, "stage": string, "mechanism": string, "eligibility": string, "team": string, "excluded": string}}
Rules: 2–6 short lower-case phrases per facet (proper nouns keep their case), each phrase 1–4 words, no sentences. Be concrete and specific to this notice; never use generic filler such as "disease mechanisms", "translational research", "novel therapeutic strategies", "biomedical research" or "customized technologies".
- "topics": the scientific questions, biological systems, molecules, pathways or problems the notice funds (e.g. "tau aggregation", "microglial activation", "insulin resistance").
- "disease": diseases, conditions or populations; "any" if unrestricted.
- "methods": specific technologies or approaches named or clearly implied (e.g. "iPSC-derived neurons", "CRISPR screens", "PET imaging").
- "disciplines": fields of the intended investigators (e.g. "neuroscience", "immunology", "biostatistics").
- "stage": basic / preclinical / translational / clinical / implementation, as applicable.
- "mechanism": activity code(s), budget cap, project period, e.g. "R01", "$500K direct / yr", "5 years".
- "eligibility": rules about the investigator only — career stage, appointment, degree, prior funding (e.g. "independent faculty appointment", "early-stage investigators only", "clinician-scientists", "must hold an active R01"). Ignore the list of eligible organization types (universities, tribal governments, nonprofits, foreign entities); leave empty if the notice sets no investigator-level rule.
- "team": multi-PI / consortium / partnership expectations.
- "excluded": scientific aims, study designs or applicants the notice calls nonresponsive or not allowed (e.g. "clinical trials", "cancer-primary aims", "drug discovery screens"). Ignore foreign-organization boilerplate.
Leave a facet empty if the notice is silent. "sections" names the notice section each facet came from (e.g. "Part 2 · Section I", "Section III · Eligibility", "Summary").`;

/** Extract the nine facets with the model; fall back to tags when the model is unavailable. */
export async function extractOpportunityProfile(db: SupabaseClient, n: NoticeForProfile, previousVersion = 0): Promise<OpportunityProfile> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const { body, eligibility } = noticeText(n);
  if (!apiKey || body.length < 80) {
    const p = await profileFromTags(db, n);
    return { ...p, version: previousVersion + 1 };
  }
  const openai = new OpenAI({ apiKey });
  const mechanismHints = [n.activity_code ? `Activity code: ${n.activity_code}${n.activity_title ? ` (${n.activity_title})` : ""}` : null, n.award_ceiling ? `Award ceiling: $${n.award_ceiling.toLocaleString("en-US")}` : null, n.clinical_trial_note ? `Clinical trial: ${n.clinical_trial_note}` : null, n.funding_instrument ? `Instrument: ${n.funding_instrument}` : null].filter(Boolean).join("\n");
  const user = `Notice ${n.opportunity_number ?? ""} from ${n.agency ?? "the sponsor"}: ${n.title ?? ""}\n${mechanismHints}\n\nDescription:\n${body}\n\nEligibility text:\n${eligibility || "(none provided)"}\n\n${SCHEMA_HINT}`;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You extract a structured matching profile from a funding notice for a university research-development office. Be literal: only what the text supports. Output JSON only." },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const facets = emptyFacets();
    for (const f of FACETS) {
      const v = parsed[f.key];
      if (Array.isArray(v)) facets[f.key] = Array.from(new Set(v.map((x) => String(x).trim()).filter((x) => x && x.length <= 60))).slice(0, 8);
    }
    if (n.activity_code && !facets.mechanism.some((m) => m.toUpperCase().includes(n.activity_code!))) facets.mechanism.unshift(n.activity_code);
    const sections = (parsed.sections && typeof parsed.sections === "object" ? parsed.sections : {}) as Partial<Record<FacetKey, string>>;
    return { version: previousVersion + 1, extractedAt: new Date().toISOString(), source: "llm", facets, sections };
  } catch {
    const p = await profileFromTags(db, n);
    return { ...p, version: previousVersion + 1 };
  }
}
