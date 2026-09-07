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
 * takes the midpoint of the topic stage's rescale band so it is neither
 * favoured nor buried. Two items are guaranteed a place when they exist: the
 * biosketch personal statement (the person's own account of what they do)
 * and, on a Clinical Trial Required notice, the best trial record (the design
 * fact the notice turns on) — each displacing the lowest-scored selected item.
 *
 * Ids: the model cites short stable ids — PMID:<n>, <NCT id>, <project
 * number>, biosketch:statement — mapped back to the internal item ids on the
 * way out (`Adjudication.evidence`).
 */
import { itemWeight } from "@/lib/fit/profile/aggregate";
import { groupSections, NON_RESPONSIVE_HEADING, sectionLabel, TEAM_HEADING, type NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import { contentHash } from "@/lib/outreach/embeddings";
import type { NormalizedItem } from "@/lib/fit/classify/normalize";
import { maskText, type MaskTerm } from "@/lib/fit/judge/mask";
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

/** The similarity an item without an embedding is ranked at: the midpoint of `compose.topic.embedding_rescale`. */
export function neutralSimilarity(): number {
  const [lo, hi] = topicWeights().embedding_rescale;
  return (lo + hi) / 2;
}

/** Cut on a word boundary at `max` characters with an ellipsis. */
export function cutText(text: string, max: number): string {
  const s = text.replace(/\s+\n/g, "\n").trim();
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const at = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  return `${(at > max * 0.6 ? slice.slice(0, at) : slice).trimEnd()}…`;
}

const byScoreThenId = (a: { score: number; item: { id: string } }, b: { score: number; item: { id: string } }) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0);

/**
 * Pure. The top `top` items by w_item · similarity among those with text, the
 * biosketch statement and (Clinical Trial Required) the best trial guaranteed;
 * texts cut to `EVIDENCE_TEXT_MAX`; ids deduplicated (the first wins).
 */
export function selectEvidence(candidates: readonly EvidenceCandidate[], notice: { clinical_trial: string }, top = EVIDENCE_TOP): JudgeEvidenceItem[] {
  const neutral = neutralSimilarity();
  const seen = new Set<string>();
  const scored = candidates
    .filter((c) => c.text && c.text.trim().length > 0 && c.kind !== "directory")
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((item) => ({ item, score: item.weight * (item.similarity ?? neutral) }))
    .sort(byScoreThenId);
  const picked = scored.slice(0, top);
  const guaranteed = new Set<string>();
  const guarantee = (pick: (x: { item: EvidenceCandidate }) => boolean) => {
    const already = picked.find(pick);
    if (already) {
      guaranteed.add(already.item.id);
      return;
    }
    const best = scored.find(pick);
    if (!best) return;
    if (picked.length >= top) {
      // Displace the lowest-scored item that is not itself guaranteed.
      for (let i = picked.length - 1; i >= 0; i -= 1) {
        if (!guaranteed.has(picked[i]!.item.id)) {
          picked.splice(i, 1);
          break;
        }
      }
    }
    picked.push(best);
    guaranteed.add(best.item.id);
    picked.sort(byScoreThenId);
  };
  guarantee((x) => x.item.kind === "biosketch_statement");
  if (notice.clinical_trial === "required") guarantee((x) => x.item.kind === "trial");
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

/** "[{id}] {kind} · {year} · role: {role}\n{title}\n{text}" per item, masked when a mask is given. */
export function renderEvidence(items: readonly JudgeEvidenceItem[], mask: readonly MaskTerm[] | null = null): string {
  const m = (s: string) => (mask ? maskText(s, mask).text : s);
  return items.map((e) => [`[${e.id}] ${e.kind} · ${e.year ?? "year unknown"} · role: ${roleLabel(e.role)}`, m(e.title?.trim() || "(untitled)"), m(e.text)].join("\n")).join("\n\n");
}

export type NoticeRenderOptions = { mask?: readonly MaskTerm[] | null; title?: boolean; eligibility?: boolean; team?: boolean };

/** The notice block: the header line, Section I, Non-responsive, and (unmasked calls) Eligibility (III.3) and Team. */
export function renderNotice(n: JudgeNotice, opts: NoticeRenderOptions = {}): string {
  const m = (s: string) => (opts.mask ? maskText(s, opts.mask).text : s);
  const head = [n.number, ...(opts.title ? [m(n.title)] : []), n.activity_code ?? "activity code unknown", `clinical trial: ${n.clinical_trial_designation}`].join(" · ");
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

/** The content hash of a stored profile with `computed_at` left out — a rebuild that changes nothing keeps it. */
export function profileVersionHash(profile: InvestigatorFitProfile | OpportunityFitProfile): string {
  const { computed_at: _at, ...rest } = profile;
  void _at;
  return contentHash(canonicalJson(rest)).slice(0, 16);
}

/** Pure. The cache key of an adjudication for a pair. */
export function profileVersionsOf(inv: InvestigatorFitProfile, opp: OpportunityFitProfile): ProfileVersions {
  return { investigator: profileVersionHash(inv), opportunity: profileVersionHash(opp), taxonomy: TAXONOMY_VERSION, judge: JUDGE_VERSION };
}

export function sameVersions(a: ProfileVersions, b: ProfileVersions): boolean {
  return a.investigator === b.investigator && a.opportunity === b.opportunity && a.taxonomy === b.taxonomy && a.judge === b.judge;
}
