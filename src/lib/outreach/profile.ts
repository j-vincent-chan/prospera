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

/** How many terms the one-line strip names before it starts counting the rest. */
export const SUMMARY_TERMS = 5;

/**
 * Pure. The opportunity profile as one line of prose (fit-UX PR 3; README
 * §"Screens / views" 3): "Assessed against 5 facets read from the notice —
 * human participants required, clinical trials excluded, …".
 *
 * The editable facet grid it replaces was nine labelled rows of removable
 * chips, open by default — §2.2's complaint applied to the header rather than
 * to a row. The grid is unchanged behind "Edit what counts as a match"; what
 * changes is that a strategist scanning the tab reads one sentence instead of
 * a form. An **excluded** facet keeps its polarity in words ("clinical trials
 * excluded"), because the chip colour that used to carry it is gone.
 *
 * **Where the facets came from is a fact, not a phrase.** The first draft said
 * "read from the notice" on every profile, including one a colleague had hand
 * edited — the hand editor is still there behind "Edit what counts as a
 * match", and `updateProfileAction` records the edit on the profile
 * (`editedBy`, and a bumped `version`). The line the strip replaced carried
 * both ("Extracted from PAR-26-118 · v3, edited by you · 5 facets"), so losing
 * them was a behaviour change smuggled in with the clutter. An edited profile
 * says so, and says which version, in the same voice as the rest of the
 * sentence.
 */
export function profileSummaryLine(p: OpportunityProfile, max: number = SUMMARY_TERMS): string {
  const filled = FACETS.filter((f) => p.facets[f.key].length > 0);
  if (!filled.length) return "Nothing has been read from this notice yet — generate suggestions to extract the profile, or edit it by hand.";
  const terms = distinctTerms(filled.flatMap((f) => p.facets[f.key].map((t) => (f.excluded ? `${t} excluded` : t))));
  const shown = terms.slice(0, Math.max(1, max));
  const rest = terms.length - shown.length;
  return `Assessed against ${filled.length} facet${filled.length === 1 ? "" : "s"} ${profileOrigin(p)} — ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}.`;
}

/**
 * The terms a notice profile names, without the repeats (fit-UX follow-up,
 * L6).
 *
 * The nine facets are separate lists and the extractor writes the same term
 * into more than one of them — a disease that is also a topic, a population
 * that is also a setting — so the flattened list repeats. Live, the ADRN
 * notice read "atopic dermatitis, chronic skin inflammation, defense
 * mechanisms of the skin, **atopic dermatitis**, clinical, and 5 more": one
 * term twice inside a five-term window, and the count of the rest inflated by
 * every repeat behind it.
 *
 * **Deduped before the slice, and the remainder counted after it**, which is
 * the order that makes both halves of the sentence true: dedupe after slicing
 * would still show four terms where five were promised, and counting before
 * it would still say "5 more" when four are left. The comparison is
 * case-insensitive because the facets are hand-editable and "Atopic
 * dermatitis" and "atopic dermatitis" are one term; the first spelling is the
 * one kept, so a hand edit's capitalisation survives.
 *
 * The **facet count is not deduped** — `filled.length` counts facets, not
 * terms, and two facets that happen to name the same thing are still two
 * facets the notice was assessed against.
 */
function distinctTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/**
 * Pure. Where the facets in front of you came from: the notice, a hand edit on
 * top of it, or a hand-built profile the extractor never wrote (`source:
 * "empty"` with facets in it — what "edit it by hand" produces from the empty
 * state).
 */
export function profileOrigin(p: OpportunityProfile): string {
  const edited = Boolean(p.editedBy);
  const extracted = p.source !== "empty";
  if (!extracted) return edited ? `entered by hand · v${p.version}` : "on file for this notice";
  return edited ? `read from the notice and edited by hand · v${p.version}` : "read from the notice";
}

/**
 * Pure. The recipients tab's **one** provenance line (fit-UX PR 5; §3j —
 * "provenance once, in the card footer, not three times per screen").
 *
 * It had two. The Suggested heading carried "129 profiles · eligibility rules
 * first, then ranked against the profile · refreshed nightly" and the footer
 * carried "Suggestions describe fit, not merit, and come only from people
 * already in your directory. Reasons cite verified items only …" — the corpus,
 * where it comes from and how often it refreshes, said twice, forty lines
 * apart, on the surface §2.7 counts "refreshed nightly" three times on. The
 * two are merged here, in the footer, in the order the other cards state
 * theirs: what was assessed, how, how fresh, then what the list does and does
 * not claim.
 *
 * The count is a count and stays in the heading as one ("Suggested · 129
 * profiles"); what moved is every sentence about the assessment.
 */
export function recipientsProvenanceLine(directoryCount: number): string {
  const n = new Intl.NumberFormat("en-US").format(Math.max(0, directoryCount));
  return `${n} directory ${directoryCount === 1 ? "profile" : "profiles"} assessed · eligibility rules first, then ranked against the profile · refreshed nightly. Suggestions describe fit, not merit. Reasons cite verified items only (affiliation, ORCID or profile ID matched); name-only matches are shown in evidence but never used in reasons or messages. You decide who hears from the office.`;
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
