/**
 * The pure half of the NIH invariant harness (PR 5.0a).
 *
 * Phase 5's constraint is that nothing about an NIH notice changes while the
 * corpus widens (NON_NIH_PLAN § "The NIH invariant"). Everything here is
 * deterministic and takes no credentials: it re-renders the extractor prompts
 * from the committed Guide HTML fixtures, recomputes their `extractionCacheKey`s,
 * and re-runs `scorePair` over a committed sample of real investigator × notice
 * pairs, then diffs all of it against the baseline in
 * `docs/fit-engine/nih-baseline/`.
 *
 * `scripts/fit-nih-invariant.ts` adds the database half (`--capture`, the
 * corpus-wide `--verify`); `nih-invariant.test.ts` runs this half on every
 * `npm test`, so a PR that moves a prompt or a score fails in the suite rather
 * than in a review note.
 *
 * Nothing is imported statically from the baseline: the JSON is read at call
 * time so a production bundle never carries it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { scorePair } from "@/lib/fit/engine";
import {
  buildExtractorPrompt,
  chunkSections,
  extractionCacheKey,
  groupSections,
  sectionGroupTag,
  SECTION_GROUP_IDS,
  type ExtractorPriors,
  type GroupInput,
  type NoticeHeader,
  type NoticeSection,
} from "@/lib/fit/profile/opportunity-extract";
import { parseGuideSections } from "@/lib/ingestion/nih-guide/parse";
import { bm25StatsFor, type FitCorpus, type ItemInput } from "@/lib/fit/service";
import type { InvestigatorFitProfile, OpportunityFitProfile, ScoreContext, Tier } from "@/lib/fit/types";

export const BASELINE_DIR = path.join("docs", "fit-engine", "nih-baseline");
export const FIXTURE_DIR = path.join("src", "lib", "ingestion", "nih-guide", "__fixtures__");

/** Pinned so a captured context and a verified one differ in nothing a clock controls. */
export const FIXED_NOW = "2026-01-01T00:00:00.000Z";
/** Floats are compared at this precision; `score` is stored as `toFixed(6)`. */
export const DP = 6;

// ---------------------------------------------------------------------------
// Canonicalisation and hashing
// ---------------------------------------------------------------------------

/** Keys whose value is a clock reading — never part of what the invariant protects. */
const VOLATILE_KEYS = new Set([
  "computed_at",
  "created_at",
  "updated_at",
  "fetched_at",
  "guide_fetched_at",
  "source_updated_at",
  "judged_at",
  "rescored_at",
]);

/**
 * Sorted object keys, volatile keys dropped, every float fixed to `DP` — so
 * -0 and 1e-17 drift never read as a real difference, and key order never does.
 */
export function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    return Number.isInteger(value) ? value : Number(value.toFixed(DP));
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = canonical(src[k]);
    }
    return out;
  }
  return value;
}

export function stable(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 16 hex characters: ample for a change detector, and it keeps the baseline small. */
export function h(value: unknown): string {
  return sha256(stable(value)).slice(0, 16);
}

// ---------------------------------------------------------------------------
// Differences
// ---------------------------------------------------------------------------

export type Diff = { subject: string; path: string; baseline: string; current: string };

function show(v: unknown): string {
  if (v === undefined) return "(absent)";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 70 ? `${s.slice(0, 67)}…` : s;
}

/** Field-by-field, so a difference is reported as a path rather than as a blob. */
export function compareFields(into: Diff[], subject: string, baseline: Record<string, unknown>, current: Record<string, unknown>): void {
  for (const k of [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()) {
    if (stable(baseline[k]) !== stable(current[k])) {
      into.push({ subject, path: k, baseline: show(baseline[k]), current: show(current[k]) });
    }
  }
}

/** Membership first, then each shared member's fields. */
export function compareKeyed(
  into: Diff[],
  label: string,
  baseline: Array<Record<string, unknown>>,
  current: Array<Record<string, unknown>>,
  keyOf: (r: Record<string, unknown>) => string,
): void {
  const b = new Map(baseline.map((r) => [keyOf(r), r]));
  const c = new Map(current.map((r) => [keyOf(r), r]));
  for (const [k, row] of b) {
    if (!c.has(k)) into.push({ subject: `${label} ${k}`, path: "(row)", baseline: "present in baseline", current: "absent now" });
    else compareFields(into, `${label} ${k}`, row, c.get(k)!);
  }
  for (const k of c.keys()) {
    if (!b.has(k)) into.push({ subject: `${label} ${k}`, path: "(row)", baseline: "absent from baseline", current: "present now" });
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export type GroupRecord = { tag: string; prompt_sha256: string; cache_key: string };

/**
 * Every extractor group and chunk of one notice's sections with its rendered
 * prompt hash and `extractionCacheKey` — the walk `extractWithModel` performs,
 * minus the model call. The prompt is hashed as a raw string, not as a
 * canonicalised object, so one changed character in `sectionLabel()`, the quote
 * reminder or a group schema shows up.
 */
export function groupRecords(sections: NoticeSection[], header: NoticeHeader, priors: ExtractorPriors): GroupRecord[] {
  const groups = groupSections(sections);
  const out: GroupRecord[] = [];
  for (const group of SECTION_GROUP_IDS) {
    const chunks = chunkSections(groups[group]);
    for (let i = 0; i < chunks.length; i += 1) {
      const input: GroupInput = { header, priors, group, chunk: i + 1, of: chunks.length, sections: chunks[i]! };
      const prompt = buildExtractorPrompt(input);
      out.push({
        tag: sectionGroupTag(input),
        prompt_sha256: sha256(`${prompt.system}\n${prompt.user}`).slice(0, 16),
        cache_key: extractionCacheKey(input),
      });
    }
  }
  return out;
}

export type PromptFixture = {
  file: string;
  number: string;
  header: NoticeHeader;
  priors: ExtractorPriors;
  sections_sha256: string;
  groups: GroupRecord[];
};

export type PromptFixtureInput = Pick<PromptFixture, "file" | "number" | "header" | "priors">;

/** Parse each committed Guide HTML fixture with the repo's own parser and render its prompts. */
export function promptFixtureRecords(fixtures: PromptFixtureInput[], fixtureDir = FIXTURE_DIR): PromptFixture[] {
  return fixtures.map((f) => {
    const sections = parseGuideSections(readFileSync(path.join(fixtureDir, f.file), "utf8")) as NoticeSection[];
    return {
      file: f.file,
      number: f.number,
      header: f.header,
      priors: f.priors,
      sections_sha256: h(sections),
      groups: groupRecords(sections, f.header, f.priors),
    };
  });
}

/** One row per (fixture, group) so a break names the group and the field, not just the file. */
export function flattenFixtures(fixtures: PromptFixture[]): Array<Record<string, unknown>> {
  return fixtures.flatMap((f) => [
    { key: `${f.number} sections`, sections_sha256: f.sections_sha256 },
    ...f.groups.map((g) => ({ key: `${f.number} group ${g.tag}`, prompt_sha256: g.prompt_sha256, cache_key: g.cache_key })),
  ]);
}

// ---------------------------------------------------------------------------
// The committed scoring sample
// ---------------------------------------------------------------------------

/**
 * A per-pair `ScoreContext` is 175–380 KB and all but the cosines are common to
 * every pair of one investigator, so the items and the corpus-wide BM25 / IDF
 * tables are stored once and shared.
 */
export type OfflineBundle = {
  fixed_now: string;
  idf: { weights: Record<string, number>; unknown: number };
  term_df: Record<string, number>;
  doc_count: number;
  investigators: Array<{
    investigator_id: string;
    pending_items: number;
    profile: InvestigatorFitProfile;
    /** `ItemInput` without its embedding: paradigm, design, tf and length are what `scorePair` reads. */
    items: Array<Omit<ItemInput, "vector" | "judge">>;
  }>;
  notices: Array<{
    opportunity_id: string;
    number: string | null;
    complete: boolean;
    runway_weeks: number | null;
    profile: OpportunityFitProfile;
  }>;
  /** Per (investigator, notice): each item's cosine against that notice, aligned to `items`. */
  cosines: Record<string, Array<number | null>>;
  expected: ExpectedResult[];
};

export type ExpectedResult = {
  investigator_id: string;
  opportunity_id: string;
  tier: Tier;
  score: string;
  caps: string[];
  components_sha256: string;
  provenance_sha256: string;
  rationale: string;
};

export const pairKey = (investigatorId: string, opportunityId: string) => `${investigatorId}|${opportunityId}`;

/** Rebuild the pair's `ScoreContext` from the bundle and re-run the engine. Pure. */
export function scoreFromBundle(bundle: OfflineBundle, investigatorId: string, opportunityId: string): ReturnType<typeof scorePair> | null {
  const inv = bundle.investigators.find((x) => x.investigator_id === investigatorId);
  const notice = bundle.notices.find((x) => x.opportunity_id === opportunityId);
  const cosines = bundle.cosines[pairKey(investigatorId, opportunityId)];
  if (!inv || !notice || !cosines) return null;
  const items: ItemInput[] = inv.items.map((i) => ({ ...i, vector: null }));
  const ctx: ScoreContext = {
    now: bundle.fixed_now,
    actionability: { runway_weeks: notice.runway_weeks, in_pipeline: false, recently_dismissed: false },
    topic: {
      idf: bundle.idf,
      items: inv.items.map((i, n) => ({ id: i.id, paradigm: i.paradigm, design: i.design, cosine: cosines[n] ?? null, tf: i.tf, length: i.length })),
      // The real `bm25StatsFor`, so a change to it is caught here too. It reads
      // only `termDf` and `notices.length` from the corpus.
      bm25: bm25StatsFor(items, { termDf: bundle.term_df, notices: new Array(bundle.doc_count).fill(null) } as unknown as Pick<FitCorpus, "termDf" | "notices">),
      override: null,
    },
    infrastructure: null,
    track: { prior_ucsf_awardees_same_code: null },
    investigator_pending_items: inv.pending_items,
    notice_complete: notice.complete,
  };
  return scorePair(inv.profile, notice.profile, ctx);
}

export function expectedFromResult(investigatorId: string, opportunityId: string, r: ReturnType<typeof scorePair>): ExpectedResult {
  return {
    investigator_id: investigatorId,
    opportunity_id: opportunityId,
    tier: r.tier,
    score: r.score.toFixed(DP),
    caps: [...r.caps],
    components_sha256: h(r.components),
    provenance_sha256: h(r.provenance),
    rationale: r.rationale ?? "",
  };
}

// ---------------------------------------------------------------------------
// The offline check
// ---------------------------------------------------------------------------

export type PromptsFileShape = { offline: { fixtures: PromptFixture[] } };
export type ResultsFileShape = { offline: OfflineBundle };

export function readBaseline<T>(name: string, baselineDir = BASELINE_DIR): T {
  return JSON.parse(readFileSync(path.join(baselineDir, name), "utf8")) as T;
}

export type OfflineCheck = { diffs: Diff[]; fixtures: number; pairs: number };

/**
 * Re-render every fixture prompt and re-score every sampled pair, then diff
 * against the baseline. No credentials, no network — this is the check that
 * must stay green on every Phase 5 PR.
 */
export function verifyOffline(baselineDir = BASELINE_DIR, fixtureDir = FIXTURE_DIR): OfflineCheck {
  const prompts = readBaseline<PromptsFileShape>("prompts.json", baselineDir);
  const results = readBaseline<ResultsFileShape>("results.json", baselineDir);
  const diffs: Diff[] = [];

  const current = promptFixtureRecords(
    prompts.offline.fixtures.map((f) => ({ file: f.file, number: f.number, header: f.header, priors: f.priors })),
    fixtureDir,
  );
  compareKeyed(diffs, "fixture", flattenFixtures(prompts.offline.fixtures), flattenFixtures(current), (r) => String(r.key));

  const bundle = results.offline;
  for (const e of bundle.expected) {
    const number = bundle.notices.find((n) => n.opportunity_id === e.opportunity_id)?.number ?? e.opportunity_id.slice(0, 8);
    const subject = `pair ${e.investigator_id.slice(0, 8)} × ${number}`;
    const scored = scoreFromBundle(bundle, e.investigator_id, e.opportunity_id);
    if (!scored) {
      diffs.push({ subject, path: "(bundle)", baseline: "present", current: "could not be rebuilt from the bundle" });
      continue;
    }
    compareFields(
      diffs,
      subject,
      e as unknown as Record<string, unknown>,
      expectedFromResult(e.investigator_id, e.opportunity_id, scored) as unknown as Record<string, unknown>,
    );
  }

  return { diffs, fixtures: prompts.offline.fixtures.length, pairs: bundle.expected.length };
}
