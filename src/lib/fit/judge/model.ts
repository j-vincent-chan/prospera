/**
 * The judge's model function (plan § PR 3.1; CLAUDE.md LLM rules): JSON
 * mode, `temperature: 0`, the model name from `FIT_MODEL_JUDGE` (D2: "extract
 * and judge = the strongest approved model" — the extractor's `gpt-4o`
 * default), only the OpenAI-compatible endpoint already in use (D3), never
 * in a page render path. The call is injectable (`JudgeModelFn`) so tests
 * never touch the network; `openaiJudge()` is the runtime one, built on
 * first use so importing this module never reads the environment, with a
 * 90 s timeout and no retry (F8: a prompt of ≈ 6 k tokens at 30k TPM takes
 * 10–15 s; the SDK's default of ten minutes and two retries could hold the
 * cron past its `maxDuration`). The service starts no call within
 * `FIT_JUDGE_CALL_MARGIN_MS` — this timeout — of its deadline, so with no
 * retry the last call to start ends by the deadline (S1). A call that
 * throws (transport, auth, the timeout) reaches the service, which treats
 * it as a refused call and stops the run with the message (S3). Calls run
 * one at a time.
 *
 * `callJson` parses one reply and says whether it is usable — a reply that
 * is not JSON or was cut off at `max_tokens` is returned with `raw: null` and
 * the reason, and the callers never cache such a result (item-classifier
 * precedent, D19).
 */
import OpenAI from "openai";
import type { ModelReply } from "@/lib/fit/classify/llm";
import { DEFAULT_EXTRACT_MODEL } from "@/lib/fit/profile/opportunity-extract";

/** D2 default taken: the same strongest approved model the extractor uses. */
export const DEFAULT_JUDGE_MODEL = DEFAULT_EXTRACT_MODEL;

/** `FIT_MODEL_JUDGE`, else the D2 default. */
export function judgeModelName(env: Record<string, string | undefined> = process.env): string {
  const name = env.FIT_MODEL_JUDGE?.trim();
  return name ? name : DEFAULT_JUDGE_MODEL;
}

export type JudgePurpose = "blind_a" | "blind_b" | "skeptic" | "reconciler";

/**
 * Output ceilings per call. The prompt specs give none; these are sized from
 * the schemas — Call A lists categories and ids (~400 tokens), Call B adds
 * five sentences and the scout field, the skeptic is one objection, the
 * reconciler carries corrections with quotes — with room for a verbose model
 * (the classifier lost a reply at 900, D19).
 */
export const JUDGE_MAX_TOKENS: Record<JudgePurpose, number> = { blind_a: 1_200, blind_b: 1_500, skeptic: 600, reconciler: 2_000 };

export type JudgeModelRequest = { purpose: JudgePurpose; system: string; user: string; model: string; maxTokens: number; variant?: 1 | 2 };

/** Calls the model once. Tests inject one; runtime uses `openaiJudge()`. */
export type JudgeModelFn = (req: JudgeModelRequest) => Promise<ModelReply>;

/** Per-call ceiling for the judge's client (F8). */
export const JUDGE_CALL_TIMEOUT_MS = 90_000;
/** Retries the client makes on a transient failure: none — a retry would let a call hold the run for twice the timeout past the margin (F8, S1); a failed call is a stop the service names. */
export const JUDGE_CALL_MAX_RETRIES = 0;

/** The configured endpoint, as `classify/llm.ts` calls it: JSON mode, temperature 0, one client shared by every call of a run, `timeout` 90 s and no retry. */
export function openaiJudge(opts: { apiKey?: string; client?: OpenAI } = {}): JudgeModelFn {
  let client: OpenAI | null = opts.client ?? null;
  return async (req) => {
    if (!client) {
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set; the fit judge cannot call the model");
      client = new OpenAI({ apiKey, timeout: JUDGE_CALL_TIMEOUT_MS, maxRetries: JUDGE_CALL_MAX_RETRIES });
    }
    const completion = await client.chat.completions.create({
      model: req.model,
      temperature: 0,
      max_tokens: req.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    });
    const choice = completion.choices[0];
    return { content: choice?.message?.content?.trim() ?? "{}", finish_reason: choice?.finish_reason ?? null };
  };
}

export type JsonReply = { raw: unknown; content: string; usable: boolean; problems: string[] };

/** One call, parsed. `usable` is false for a reply that is not a JSON object or was truncated — the callers never cache such a reply. */
export async function callJson(fn: JudgeModelFn, req: JudgeModelRequest): Promise<JsonReply> {
  const reply = await fn(req);
  const content = typeof reply === "string" ? reply : reply.content;
  const problems: string[] = [];
  if (typeof reply !== "string" && reply.finish_reason === "length") problems.push("output: truncated by max_tokens (finish_reason length)");
  let raw: unknown = null;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    problems.push(`output: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    return { raw: null, content, usable: false, problems };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push("output: not a JSON object");
    return { raw: null, content, usable: false, problems };
  }
  return { raw, content, usable: problems.length === 0, problems };
}
