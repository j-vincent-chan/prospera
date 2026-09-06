/**
 * Typed accessors over the non-rule tables of src/lib/fit/signal-mapping.json
 * (D18 put the evidence-role and self-declared maps there; the stage-1 degree
 * vocabularies join them so no eligibility decision lives in code). The rule
 * table itself is read by classify/rules.ts.
 *
 * Loud failure, as for taxonomy.ts: a malformed block throws
 * `SignalMappingError` naming the key rather than silently evaluating no rule.
 */
import signalMapping from "@/lib/fit/signal-mapping.json";

export class SignalMappingError extends Error {
  constructor(
    public readonly key: string,
    detail: string
  ) {
    super(`signal-mapping.json › ${key}: ${detail}`);
    this.name = "SignalMappingError";
  }
}

/** The stage-1 degree vocabularies (`eligibility` block), as normalized tokens. */
export type EligibilityVocabulary = {
  /** Degrees that satisfy "clinician / MD-DO required". */
  clinical_degrees: ReadonlySet<string>;
  /** Degrees a `degree_required` rule can name and be evaluated on; a superset of `clinical_degrees`. Anything else leaves the rule unknown. */
  known_degrees: ReadonlySet<string>;
  /** Wording that makes a degree rule open-ended ("or equivalent doctoral degree"): unknown, never a fail. */
  open_ended_degree_rule: RegExp;
};

type RawEligibility = { clinical_degrees?: unknown; known_degrees?: unknown; open_ended_degree_words?: unknown };

/** Tokens must already be what `degreeTokens()` produces: lower-case letters only. */
const TOKEN = /^[a-z]+$/;

function tokenList(raw: RawEligibility, key: keyof RawEligibility): string[] {
  const list = raw[key];
  if (!Array.isArray(list) || !list.length) throw new SignalMappingError(`eligibility.${key}`, "must be a non-empty list");
  for (const t of list) if (typeof t !== "string" || !TOKEN.test(t)) throw new SignalMappingError(`eligibility.${key}`, `${JSON.stringify(t)} is not a lower-case letters-only token`);
  return list as string[];
}

/** Build the vocabulary from a raw `eligibility` block, validating it. Exported for tests; production reads `eligibilityVocabulary()`. */
export function parseEligibilityVocabulary(raw: unknown): EligibilityVocabulary {
  if (!raw || typeof raw !== "object") throw new SignalMappingError("eligibility", "block missing");
  const block = raw as RawEligibility;
  const clinical = new Set(tokenList(block, "clinical_degrees"));
  const known = new Set(tokenList(block, "known_degrees"));
  for (const d of clinical) if (!known.has(d)) throw new SignalMappingError("eligibility.known_degrees", `must include every clinical degree; missing ${JSON.stringify(d)}`);
  const words = tokenList(block, "open_ended_degree_words");
  return { clinical_degrees: clinical, known_degrees: known, open_ended_degree_rule: new RegExp(words.join("|"), "i") };
}

let vocabulary: EligibilityVocabulary | null = null;

/** `eligibility` — the degree vocabularies stage 1 evaluates clinician and degree rules with (§7 stage 1). */
export function eligibilityVocabulary(): EligibilityVocabulary {
  vocabulary ??= parseEligibilityVocabulary((signalMapping as { eligibility?: unknown }).eligibility);
  return vocabulary;
}

/**
 * One `notice_boilerplate.entries` row (PR 1.5b): an NIH template sentence
 * the profile assembly drops from the verbatim lists
 * (`eligibility.investigator_rules`, `non_responsive`) because it carries no
 * rule — stage 1 would otherwise count it as an eligibility unknown that caps
 * the tier.
 */
export type NoticeBoilerplateEntry = {
  id: string;
  /** The JSON `prefix` or `pattern`, for logs and tests. */
  source: string;
  /** True when the item — normalized as quotes are (`normalizeForMatch`) and lower-cased — is this boilerplate. */
  test: (normalized: string) => boolean;
};

type RawBoilerplate = { entries?: unknown };
type RawBoilerplateEntry = { id?: unknown; prefix?: unknown; pattern?: unknown };

/** A prefix is compared with `startsWith` against a lower-cased, whitespace-collapsed item, so it must be written that way. */
const normalizedPrefix = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Build the entries from a raw `notice_boilerplate` block, validating it. Exported for tests; production reads `noticeBoilerplate()`. */
export function parseNoticeBoilerplate(raw: unknown): NoticeBoilerplateEntry[] {
  if (!raw || typeof raw !== "object") throw new SignalMappingError("notice_boilerplate", "block missing");
  const entries = (raw as RawBoilerplate).entries;
  if (!Array.isArray(entries) || !entries.length) throw new SignalMappingError("notice_boilerplate.entries", "must be a non-empty list");
  const seen = new Set<string>();
  return entries.map((e, i) => {
    const at = `notice_boilerplate.entries[${i}]`;
    if (!e || typeof e !== "object") throw new SignalMappingError(at, "must be an object");
    const { id, prefix, pattern } = e as RawBoilerplateEntry;
    if (typeof id !== "string" || !id.trim()) throw new SignalMappingError(at, "needs a non-empty id");
    if (seen.has(id)) throw new SignalMappingError(at, `duplicate id ${JSON.stringify(id)}`);
    seen.add(id);
    const key = `notice_boilerplate.${id}`;
    if ((prefix === undefined) === (pattern === undefined)) throw new SignalMappingError(key, "needs exactly one of prefix or pattern");
    if (prefix !== undefined) {
      if (typeof prefix !== "string" || !prefix.trim()) throw new SignalMappingError(key, "prefix must be a non-empty string");
      if (prefix !== normalizedPrefix(prefix)) throw new SignalMappingError(key, "prefix must be written normalized: lower-case, single spaces, no leading or trailing space");
      return { id, source: prefix, test: (s) => s.startsWith(prefix) };
    }
    if (typeof pattern !== "string" || !pattern.trim()) throw new SignalMappingError(key, "pattern must be a non-empty string");
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      throw new SignalMappingError(key, `pattern does not compile: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { id, source: pattern, test: (s) => re.test(s) };
  });
}

let boilerplate: NoticeBoilerplateEntry[] | null = null;

/** `notice_boilerplate` — the template sentences `mergeExtractions` drops from a notice's verbatim lists (PR 1.5b). */
export function noticeBoilerplate(): NoticeBoilerplateEntry[] {
  boilerplate ??= parseNoticeBoilerplate((signalMapping as { notice_boilerplate?: unknown }).notice_boilerplate);
  return boilerplate;
}
