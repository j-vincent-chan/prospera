/**
 * What the judge reads (blind-pass.md › Inputs; skeptic.md › Inputs;
 * reconciler.md › Inputs), assembled from what the service already loads.
 * Pure: the evidence selection, the short ids the model cites, the notice
 * texts cut from the stored Guide sections, the rendering the three prompts
 * share, and the profile-version hashes that key the adjudication cache.
 *
 * Evidence: "the top 8 items by w_item · similarity to the notice; text
 * ≤ 1,200 chars each" — w_item is the aggregation weight (reliability × role
 * × recency, aggregate.ts) and similarity the item's cosine against the
 * notice; an item without an embedding (a trial, a self-declared record)
 * ranks at the lower edge of the topic stage's rescale band (0.35), so an
 * embedded item the notice actually resembles outranks it and the selection
 * varies from notice to notice (F5). Guaranteed a place when they exist,
 * each displacing the lowest-scored selected item: the biosketch personal
 * statement (the person's own account of what they do), on a Clinical Trial
 * Required notice the best trial record (the design fact the notice turns
 * on), and the `EMBEDDED_RESERVED` embedded items with the highest cosine.
 *
 * Ids: the model cites short stable ids — PMID:<n>, <NCT id>, <project
 * number>, biosketch:statement — mapped back to the internal item ids on the
 * way out (`Adjudication.evidence`).
 */
import { itemWeight } from "@/lib/fit/profile/aggregate";
import { groupSections, NON_RESPONSIVE_HEADING, sectionLabel, TEAM_HEADING, type NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import { contentHash } from "@/lib/outreach/embeddings";
import type { NormalizedItem } from "@/lib/fit/classify/normalize";
import { maskIcInId, maskIcInText, maskText, type MaskTerm } from "@/lib/fit/judge/mask";
import { JUDGE_VERSION, type JudgeCollaborator, type JudgeEvidenceItem, type JudgeNotice, type ProfileVersions } from "@/lib/fit/judge/types";
import { TAXONOMY_VERSION, topicWeights } from "@/lib/fit/taxonomy";
import type { InvestigatorFitProfile, ItemKind, ItemProfile, OpportunityFitProfile } from "@/lib/fit/types";

/** blind-pass.md: "top 8 items". */
export const EVIDENCE_TOP = 8;
/** blind-pass.md: "text ≤ 1,200 chars each". */
export const EVIDENCE_TEXT_MAX = 1_200;
/** blind-pass.md: "section_I_text (≤ 6,000 chars)". */
export const SECTION_I_MAX = 6_000;
/** blind-pass.md: "collaborators … ≤ 6". */
export const COLLABORATORS_MAX = 6;
/** The other notice texts are cut here (the non-responsive paragraph, III.3 and the team language are short). */
export const NOTICE_TEXT_MAX = 3_000;
/** Slots among the `EVIDENCE_TOP` reserved for the embedded items with the highest cosine against the notice (F5). */
export const EMBEDDED_RESERVED = 2;

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** The short id the model cites for an item: PMID:<n>, the NCT id, the project number (else grant:<row id>), biosketch:statement, biosketch:contribution:<n>, profiles:narrative, self_declared, directory. */
export function judgeDisplayId(item: Pick<NormalizedItem, "id" | "kind">, grantProjectNumbers: ReadonlyMap<string, string> = new Map()): string {
  const parts = item.id.split(":");
  switch (item.kind) {
    case "publication":
      return `PMID:${parts[parts.length - 1]}`;
    case "grant": {
      const row = parts.slice(1).join(":");
      return grantProjectNumbers.get(row) ?? `grant:${row}`;
    }
    case "trial":
      return parts[parts.length - 1] ?? item.id;
    case "biosketch_statement":
      return "biosketch:statement";
    case "biosketch_contribution":
      return `biosketch:contribution:${parts[parts.length - 1] ?? "1"}`;
    case "profiles_narrative":
      return "profiles:narrative";
    case "self_declared":
      return parts[0] === "aspiration" ? `aspiration:${parts[parts.length - 1]}` : "self_declared";
    default:
      return item.kind;
  }
}

// ---------------------------------------------------------------------------
// Evidence selection
// ---------------------------------------------------------------------------

/** An item before selection: the judge facts the service loads, `text` possibly empty. */
export type EvidenceCandidate = Omit<JudgeEvidenceItem, "text"> & { text: string | null };

/** The judge facts of one item, computed once per investigator load (service.ts `loadInvestigator`). */
export function judgeFactsOf(item: NormalizedItem, profile: ItemProfile, grantProjectNumbers: ReadonlyMap<string, string>, now: Date): Omit<EvidenceCandidate, "similarity"> {
  return {
    id: judgeDisplayId(item, grantProjectNumbers),
    ref: item.id,
    kind: item.kind as ItemKind,
    year: item.year,
    role: item.role,
    title: item.title,
    text: item.text,
    mesh_names: item.mesh.map((m) => m.name),
    topic_terms: [...profile.topic.terms],
    weight: itemWeight(profile, now).weight,
  };
}

/** The similarity an item without an embedding is ranked at: the lower edge of `compose.topic.embedding_rescale` (0.35) — never above an embedded item the notice resembles (F5). */
export function neutralSimilarity(): number {
  return topicWeights().embedding_rescale[0];
}

/** Cut on a word boundary at `max` characters with an ellipsis. */
export function cutText(text: string, max: number): string {
  const s = text.replace(/\s+\n/g, "\n").trim();
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const at = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  return `${(at > max * 0.6 ? slice.slice(0, at) : slice).trimEnd()}…`;
}

type Scored = { item: EvidenceCandidate; score: number };

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byScoreThenId = (a: Scored, b: Scored) => b.score - a.score || byId(a.item.id, b.item.id);
const byCosineThenId = (a: Scored, b: Scored) => (b.item.similarity ?? 0) - (a.item.similarity ?? 0) || byId(a.item.id, b.item.id);

/**
 * Pure. The top `top` items by w_item · similarity among those with text;
 * guaranteed (each displacing the lowest-scored item not itself guaranteed,
 * never beyond `top`): the biosketch statement, (Clinical Trial Required)
 * the best trial, and the `EMBEDDED_RESERVED` embedded items with the
 * highest cosine (F5); texts cut to `EVIDENCE_TEXT_MAX`; ids deduplicated
 * (the first wins).
 */
export function selectEvidence(candidates: readonly EvidenceCandidate[], notice: { clinical_trial: string }, top = EVIDENCE_TOP): JudgeEvidenceItem[] {
  const neutral = neutralSimilarity();
  const seen = new Set<string>();
  const scored: Scored[] = candidates
    .filter((c) => c.text && c.text.trim().length > 0 && c.kind !== "directory")
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((item) => ({ item, score: item.weight * (item.similarity ?? neutral) }))
    .sort(byScoreThenId);
  const picked = scored.slice(0, top);
  const guaranteed = new Set<string>();
  const guarantee = (x: Scored | undefined) => {
    if (!x) return;
    if (picked.some((p) => p.item.id === x.item.id)) {
      guaranteed.add(x.item.id);
      return;
    }
    if (picked.length >= top) {
      // Displace the lowest-scored item that is not itself guaranteed; when every slot is guaranteed, nothing gives way.
      const at = picked.map((p) => p.item.id).reverse().findIndex((id) => !guaranteed.has(id));
      if (at < 0) return;
      picked.splice(picked.length - 1 - at, 1);
    }
    picked.push(x);
    guaranteed.add(x.item.id);
    picked.sort(byScoreThenId);
  };
  guarantee(scored.find((x) => x.item.kind === "biosketch_statement"));
  if (notice.clinical_trial === "required") guarantee(scored.find((x) => x.item.kind === "trial"));
  for (const x of scored.filter((x) => x.item.similarity !== null).sort(byCosineThenId).slice(0, EMBEDDED_RESERVED)) guarantee(x);
  return picked.map(({ item }) => ({ ...item, text: cutText(item.text!, EVIDENCE_TEXT_MAX) }));
}

/** Pure. The collaborator lines (≤ 6): the stored profile's collaborators with their dominant family and categories. */
export function collaboratorLines(profile: Pick<InvestigatorFitProfile, "collaborators">, max = COLLABORATORS_MAX): JudgeCollaborator[] {
  return profile.collaborators.slice(0, max).map((c) => ({
    name_or_id: c.name ?? c.id,
    one_line_summary: `${c.dominant_family.replace(/_/g, " ")} (${c.categories.map((x) => x.replace(/_/g, " ")).join(", ") || "no categories"})`,
  }));
}

// ---------------------------------------------------------------------------
// Notice texts
// ---------------------------------------------------------------------------

/** A III.3-like heading: PD/PI eligibility. */
export const ELIGIBILITY_HEADING = /eligible individuals|program directors?|principal investigators?|PD\/?PI/i;

const renderSections = (sections: readonly NoticeSection[], max: number): string => cutText(sections.map((s) => `## ${sectionLabel(s)}\n${s.text.trim()}`).join("\n\n"), max);

export type NoticeTexts = Pick<JudgeNotice, "section_I_text" | "non_responsive_text" | "eligibility_text" | "team_text">;

/**
 * Pure. The four texts from the stored Guide sections: Section I (Part 1
 * Purpose + Section I minus the non-responsive sub-sections — the
 * extractor's group 1, a synopsis included), the non-responsive sub-sections
 * (else the profile's verbatim `non_responsive` items), III.3 (the section
 * so numbered, else a Section III item whose heading names PD/PI
 * eligibility, else the profile's rules), and the Section I team language.
 */
export function noticeTexts(sections: readonly NoticeSection[], profile: Pick<OpportunityFitProfile, "non_responsive" | "eligibility">): NoticeTexts {
  const list = sections.filter((s) => s && typeof s.text === "string" && s.text.trim());
  const groups = groupSections(list);
  const nonResponsive = list.filter((s) => s.section === "I" && NON_RESPONSIVE_HEADING.test(s.heading));
  const iii3 = list.filter((s) => s.section === "III.3") ?? [];
  const eligibility = iii3.length ? iii3 : list.filter((s) => s.section.startsWith("III") && ELIGIBILITY_HEADING.test(s.heading));
  const team = list.filter((s) => s.section === "I" && TEAM_HEADING.test(s.heading));
  const rules = profile.eligibility.investigator_rules.map((r) => `- ${r}`).join("\n");
  return {
    section_I_text: groups[1].length ? renderSections(groups[1], SECTION_I_MAX) : "(no Section I text on file)",
    non_responsive_text: nonResponsive.length ? renderSections(nonResponsive, NOTICE_TEXT_MAX) : profile.non_responsive.length ? cutText(profile.non_responsive.map((r) => `- ${r}`).join("\n"), NOTICE_TEXT_MAX) : "(none stated)",
    eligibility_text: eligibility.length ? renderSections(eligibility, NOTICE_TEXT_MAX) : rules ? cutText(rules, NOTICE_TEXT_MAX) : "(none stated)",
    team_text: team.length ? renderSections(team, NOTICE_TEXT_MAX) : "(none stated)",
  };
}

// ---------------------------------------------------------------------------
// Rendering shared by the three prompts
// ---------------------------------------------------------------------------

const roleLabel = (role: string | null): string => (role ? role.replace(/_/g, " ") : "unknown");

/** With a mask, a text loses its topic terms and every notice or project number in it loses its IC letters (F6, S4). */
const maskedText = (s: string, mask: readonly MaskTerm[] | null | undefined) => (mask ? maskIcInText(maskText(s, mask).text) : s);

/** "[{id}] {kind} · {year} · role: {role}\n{title}\n{text}" per item; with a mask, the texts are masked and a project number — in the id and in the prose — loses its IC letters (F6, S4). */
export function renderEvidence(items: readonly JudgeEvidenceItem[], mask: readonly MaskTerm[] | null = null): string {
  const m = (s: string) => maskedText(s, mask);
  const id = (s: string) => (mask ? maskIcInId(s) : s);
  return items.map((e) => [`[${id(e.id)}] ${e.kind} · ${e.year ?? "year unknown"} · role: ${roleLabel(e.role)}`, m(e.title?.trim() || "(untitled)"), m(e.text)].join("\n")).join("\n\n");
}

export type NoticeRenderOptions = { mask?: readonly MaskTerm[] | null; title?: boolean; eligibility?: boolean; team?: boolean };

/** The notice block: the header line (the number without its IC letters when masked, F6), Section I, Non-responsive, and (unmasked calls) Eligibility (III.3) and Team; masked, a companion notice number in the prose loses its IC letters like the header (S4). */
export function renderNotice(n: JudgeNotice, opts: NoticeRenderOptions = {}): string {
  const m = (s: string) => maskedText(s, opts.mask);
  const head = [opts.mask ? maskIcInId(n.number) : n.number, ...(opts.title ? [m(n.title)] : []), n.activity_code ?? "activity code unknown", `clinical trial: ${n.clinical_trial_designation}`].join(" · ");
  const lines = [head, "Section I:", m(n.section_I_text), "Non-responsive:", m(n.non_responsive_text)];
  if (opts.eligibility) lines.push("Eligibility (III.3):", m(n.eligibility_text));
  if (opts.team) lines.push("Team:", m(n.team_text));
  return lines.join("\n");
}

export function renderCollaborators(collaborators: readonly JudgeCollaborator[]): string {
  return collaborators.length ? collaborators.map((c) => `- ${c.name_or_id}: ${c.one_line_summary}`).join("\n") : "(none on file)";
}

// ---------------------------------------------------------------------------
// Profile versions
// ---------------------------------------------------------------------------

/** JSON with keys sorted at every level, so a row read back from JSONB and the object the builder wrote hash the same. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(value));
}

/**
 * The content hash of a stored profile with `computed_at` left out — a rebuild
 * that changes nothing keeps it — and, on a notice profile, `sources` and
 * `needs_review` too (F13): a re-extraction that only re-counts exemplars or
 * clears the review flag keeps every adjudication; one that moves a weight or
 * a rule re-judges the pair.
 */
export function profileVersionHash(profile: InvestigatorFitProfile | OpportunityFitProfile): string {
  const { computed_at: _at, sources: _sources, needs_review: _review, ...rest } = profile as unknown as Record<string, unknown>;
  void _at;
  void _sources;
  void _review;
  return contentHash(canonicalJson(rest)).slice(0, 16);
}

/** Pure. The cache key of an adjudication for a pair. */
export function profileVersionsOf(inv: InvestigatorFitProfile, opp: OpportunityFitProfile): ProfileVersions {
  return { investigator: profileVersionHash(inv), opportunity: profileVersionHash(opp), taxonomy: TAXONOMY_VERSION, judge: JUDGE_VERSION };
}

export function sameVersions(a: ProfileVersions, b: ProfileVersions): boolean {
  return a.investigator === b.investigator && a.opportunity === b.opportunity && a.taxonomy === b.taxonomy && a.judge === b.judge;
}
