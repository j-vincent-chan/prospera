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
