/**
 * The judge's model function (plan § PR 3.1; CLAUDE.md LLM rules): JSON
 * mode, `temperature: 0`, the model name from `FIT_MODEL_JUDGE` (D2: "extract
 * and judge = the strongest approved model" — the extractor's `gpt-4o`
 * default), only the OpenAI-compatible endpoint already in use (D3), never
 * in a page render path. The call is injectable (`JudgeModelFn`) so tests
 * never touch the network; `openaiJudge()` is the runtime one, built on
 * first use so importing this module never reads the environment, with a
 * 90 s timeout and no SDK retry (F8: the SDK's default of ten minutes and
 * two retries could hold the cron past its `maxDuration`). The service
 * starts no call within `FIT_JUDGE_CALL_MARGIN_MS` — this timeout — of its
 * deadline, so the last call to start ends by the deadline (S1). A call
 * that throws (transport, auth, the timeout) reaches the service, which
 * treats it as a refused call and stops the run with the message (S3).
 * Calls run one at a time.
 *
 * Pacing (PR 3.1c). Each call is ≈ 5–9 k tokens against the organization's
 * 30,000 tokens-per-minute limit, so a few calls in quick succession are
 * refused with a 429 — and a thrown 429 was a run-ending stop. The client
 * now paces itself: it estimates a call's tokens (prompt chars / 4 +
 * `max_tokens`, the same reservation the provider makes) and keeps a
 * sliding 60 s window under `FIT_JUDGE_TPM` (default 25,000, headroom under
 * the limit); a call that would exceed the window waits the minimum time
 * that frees it — never past the request's `deadline` (the service's
 * deadline − margin): a wait that would cross it is refused as a
 * `deadline` stop instead of sleeping, so S1 still holds. A reply's
 * `usage.prompt_tokens` settles the window entry to what the provider
 * counted. The waiter (`TokenPacer`) is pure over its window and takes an
 * injected clock and sleep, so tests never sleep.
 *
 * One bounded 429 retry (PR 3.1c). A 429 whose retry-after — the
 * `retry-after-ms` header, the message's "try again in N s", or the
 * `retry-after` header, in that order — is ≤ `RETRY_429_MAX_WAIT_MS` and
 * fits before the request's deadline is retried once after that wait (plus
 * a small cushion) — counted once in the run's budget; a second 429 on the
 * same call, a longer wait, one that would cross the deadline, or a 429
 * without a retry-after is refused as a `rate_limit` stop. Both refusals
 * throw `JudgeCallRefusedError`, which the service maps onto `stopped_by`;
 * every other error keeps `stopped_by: "error"`.
 *
 * `callJson` parses one reply and says whether it is usable — a reply that
 * is not JSON or was cut off at `max_tokens` is returned with `raw: null` and
 * the reason, and the callers never cache such a result (item-classifier
 * precedent, D19).
 */
import OpenAI from "openai";
import { DEFAULT_EXTRACT_MODEL } from "@/lib/fit/profile/opportunity-extract";

/** D2 default taken: the same strongest approved model the extractor uses. */
export const DEFAULT_JUDGE_MODEL = DEFAULT_EXTRACT_MODEL;

/** `FIT_MODEL_JUDGE`, else the D2 default. */
export function judgeModelName(env: Record<string, string | undefined> = process.env): string {
  const name = env.FIT_MODEL_JUDGE?.trim();
  return name ? name : DEFAULT_JUDGE_MODEL;
}

/** Tokens per sliding minute the client keeps under when `FIT_JUDGE_TPM` is unset: headroom under the organization's 30,000 TPM. */
export const DEFAULT_JUDGE_TPM = 25_000;

/** `FIT_JUDGE_TPM` as a positive integer, else the default. */
export function judgeTpm(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FIT_JUDGE_TPM?.trim();
  if (!raw) return DEFAULT_JUDGE_TPM;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_JUDGE_TPM;
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

export type JudgeModelRequest = {
  purpose: JudgePurpose;
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  variant?: 1 | 2;
  /** Epoch ms after which the call must not start — the service's deadline − margin. The client waits for the TPM window, or a 429's retry-after, only up to it; null or absent = wait freely. */
  deadline?: number | null;
};

/** What the judge's client answers: the classifier's `ModelReply` shape (a string, or content with the finish reason) plus what the client waited for (the pair line reports it). */
export type JudgeModelReply =
  | string
  | {
      content: string;
      finish_reason?: string | null;
      /** Milliseconds the client slept before this call — the TPM window and a 429's retry-after. */
      paced_ms?: number;
      /** True when the reply came from the one 429 retry. */
      retried_429?: boolean;
      /** True when the reply came from the one transient-transport retry (a dropped connection, a timeout, a 5xx). */
      retried_transient?: boolean;
    };

/** Calls the model once. Tests inject one; runtime uses `openaiJudge()`. */
export type JudgeModelFn = (req: JudgeModelRequest) => Promise<JudgeModelReply>;

/** Per-call ceiling for the judge's client (F8). */
export const JUDGE_CALL_TIMEOUT_MS = 90_000;
/** Retries the SDK makes on a transient failure: none — an SDK retry would let a call hold the run for twice the timeout past the margin (F8, S1). The client's own single 429 retry is bounded by the request's deadline instead. */
export const JUDGE_CALL_MAX_RETRIES = 0;

/** The sliding window the pacer counts tokens over: the provider's minute. */
export const TPM_WINDOW_MS = 60_000;
/** The longest retry-after the client waits out for a 429; a longer one is a `rate_limit` stop. */
export const RETRY_429_MAX_WAIT_MS = 30_000;
/** Added to a 429's retry-after before the retry, so a retry sent at the provider's exact instant is not refused again. */
export const RETRY_429_CUSHION_MS = 250;

/**
 * The client waits this long and retries once after a transient transport failure — a dropped
 * connection, a request timeout, or a 5xx. The judge's first real slice (2026-09-07) lost 16 of an
 * investigator's 25 pairs to one `Connection error.`: every thrown call is a run-ending refusal
 * (D38), which is right for auth and quota and wrong for a blip. A second failure on the same call,
 * or a wait that would cross the deadline, still stops the run.
 */
export const RETRY_TRANSIENT_WAIT_MS = 2_000;

/** Node/undici socket failures the client retries once. */
const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

/**
 * True for a failure that is worth one retry: the SDK's connection and timeout errors, a 5xx from
 * the provider, or a socket-level code. False for anything that names the request or the account —
 * 4xx (auth, quota, a malformed call), which must stop the run.
 */
export function isTransientTransport(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { status?: unknown; message?: unknown; name?: unknown; code?: unknown; cause?: unknown };
  if (typeof err.status === "number") return err.status >= 500;
  const name = typeof err.name === "string" ? err.name : "";
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") return true;
  const message = typeof err.message === "string" ? err.message : "";
  if (/^(connection error|request timed out)\b/i.test(message)) return true;
  const code = typeof err.code === "string" ? err.code : typeof (err.cause as { code?: unknown } | undefined)?.code === "string" ? ((err.cause as { code: string }).code) : "";
  return TRANSIENT_CODES.has(code);
}

/** Why the client refused to make (or finish) a call; the service stops the run with it as `stopped_by`. */
export type JudgeRefusal = "deadline" | "rate_limit";

/** Thrown by the client for a refusal it names — a pacing wait that would cross the deadline, or a 429 it could not retry. Every other throw is a plain error (S3). */
export class JudgeCallRefusedError extends Error {
  constructor(
    public readonly reason: JudgeRefusal,
    message: string,
  ) {
    super(message);
    this.name = "JudgeCallRefusedError";
  }
}

/** Pure. The tokens a call reserves at the provider: the prompt at ≈ 4 chars per token plus the whole `max_tokens`. */
export function estimateTokens(req: Pick<JudgeModelRequest, "system" | "user" | "maxTokens">): number {
  return Math.ceil((req.system.length + req.user.length) / 4) + req.maxTokens;
}

export type WindowEntry = { at: number; tokens: number };

export type TokenPacerOptions = {
  tpm: number;
  windowMs?: number;
  /** Epoch ms. Injected by tests. */
  now?: () => number;
  /** Injected by tests, which advance their clock instead of sleeping. */
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A sliding-window token budget: the calls of the last `windowMs` and their
 * reserved tokens. `waitNeeded` and `used` are pure over the window;
 * `pace` is the waiter the client calls. One pacer per run (one per
 * `openaiJudge()`), shared by every investigator the run judges.
 */
export class TokenPacer {
  readonly tpm: number;
  readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private entries: WindowEntry[] = [];

  constructor(opts: TokenPacerOptions) {
    this.tpm = opts.tpm;
    this.windowMs = opts.windowMs ?? TPM_WINDOW_MS;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
  }

  /** Tokens counted in the window at `at`. */
  used(at: number = this.now()): number {
    this.prune(at);
    return this.entries.reduce((s, e) => s + e.tokens, 0);
  }

  /**
   * Pure over the window. Milliseconds to wait at `at` before `tokens` fit
   * under the limit: 0 when they fit; otherwise the instant the oldest
   * entries that must leave the window leave it. An empty window always
   * fits, so a call larger than the limit waits for the window to empty
   * rather than forever.
   */
  waitNeeded(tokens: number, at: number = this.now()): number {
    let used = this.used(at);
    if (used + tokens <= this.tpm) return 0;
    let wait = 0;
    for (const e of this.entries) {
      used -= e.tokens;
      wait = e.at + this.windowMs - at;
      if (used + tokens <= this.tpm) break;
    }
    return Math.max(0, wait);
  }

  /** Count a call started at `at`; the entry is returned so the caller can settle it to the provider's count. */
  record(tokens: number, at: number = this.now()): WindowEntry {
    const entry = { at, tokens };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Wait until `tokens` fit, then record the call. Refuses — without
   * sleeping — when the wait would end after `deadline` (S1: no call starts
   * after the service's deadline − margin).
   */
  async pace(tokens: number, deadline: number | null | undefined): Promise<{ waited_ms: number; entry: WindowEntry }> {
    const at = this.now();
    const wait = this.waitNeeded(tokens, at);
    if (deadline != null && at + wait > deadline) {
      throw new JudgeCallRefusedError("deadline", `the TPM window (${this.used(at)} of ${this.tpm} tokens in ${this.windowMs / 1000} s) frees room for ${tokens} tokens only in ${(wait / 1000).toFixed(1)} s, after the deadline`);
    }
    if (wait > 0) await this.sleep(wait);
    return { waited_ms: wait, entry: this.record(tokens, this.now()) };
  }

  private prune(at: number): void {
    const from = at - this.windowMs;
    if (this.entries.length && this.entries[0]!.at <= from) this.entries = this.entries.filter((e) => e.at > from);
  }
}

/** True for the provider's 429 — the SDK's `RateLimitError` (`status` 429) or any error whose message starts with "429". */
export function is429(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { status, message } = e as { status?: unknown; message?: unknown };
  return status === 429 || (typeof message === "string" && /^429\b/.test(message));
}

/** Pure. The wait the provider names in a 429 message — "try again in 1.798s", "in 20ms", "in 1m2s" — in ms; null when it names none. */
export function parseTryAgain(message: string): number | null {
  const m = /try again in\s+(?:(\d+)m)?(\d+(?:\.\d+)?)\s*(ms|s)\b/i.exec(message);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : 0;
  const n = Number(m[2]);
  const unit = m[3]!.toLowerCase();
  return Math.round(minutes * 60_000 + (unit === "ms" ? n : n * 1000));
}

/** The wait a 429 asks for, in ms: the `retry-after-ms` header, else the message's "try again in N s", else the `retry-after` header (seconds, or an HTTP date); null when none is given. */
export function retryAfterMs(e: unknown, now: number = Date.now()): number | null {
  if (typeof e !== "object" || e === null) return null;
  const { headers, message } = e as { headers?: unknown; message?: unknown };
  const header = (name: string): string | null => {
    if (headers && typeof (headers as { get?: unknown }).get === "function") return (headers as { get: (n: string) => string | null }).get(name);
    if (headers && typeof headers === "object") {
      const v = (headers as Record<string, unknown>)[name];
      return typeof v === "string" ? v : null;
    }
    return null;
  };
  const ms = header("retry-after-ms");
  if (ms !== null && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  if (typeof message === "string") {
    const fromMessage = parseTryAgain(message);
    if (fromMessage !== null) return fromMessage;
  }
  const s = header("retry-after");
  if (s !== null) {
    if (Number.isFinite(Number(s))) return Math.max(0, Number(s) * 1000);
    const date = Date.parse(s);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  return null;
}

export type OpenaiJudgeOptions = {
  apiKey?: string;
  client?: OpenAI;
  /** One per run; defaults to a pacer at `FIT_JUDGE_TPM`. */
  pacer?: TokenPacer;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

/**
 * The configured endpoint, as `classify/llm.ts` calls it: JSON mode,
 * temperature 0, one client shared by every call of a run, `timeout` 90 s
 * and no SDK retry — paced under the TPM window and retried once on a 429
 * whose retry-after fits (module note).
 */
export function openaiJudge(opts: OpenaiJudgeOptions = {}): JudgeModelFn {
  let client: OpenAI | null = opts.client ?? null;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  let pacer: TokenPacer | null = opts.pacer ?? null;
  return async (req) => {
    if (!client) {
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set; the fit judge cannot call the model");
      client = new OpenAI({ apiKey, timeout: JUDGE_CALL_TIMEOUT_MS, maxRetries: JUDGE_CALL_MAX_RETRIES });
    }
    if (!pacer) pacer = new TokenPacer({ tpm: judgeTpm(), now, sleep });
    const tokens = estimateTokens(req);
    const deadline = req.deadline ?? null;
    const paced = await pacer.pace(tokens, deadline);
    let waited = paced.waited_ms;
    if (waited > 0) opts.log?.(`paced ${(waited / 1000).toFixed(1)} s before ${req.purpose} (≈ ${tokens} tokens; window ${pacer.used()} of ${pacer.tpm})`);
    let retried = false;
    let retriedTransient = false;
    for (;;) {
      try {
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
        // Settle the window entry to the provider's own count: the prompt as tokenized plus the reservation of `max_tokens`.
        const prompt = completion.usage?.prompt_tokens;
        if (typeof prompt === "number" && prompt > 0) paced.entry.tokens = prompt + req.maxTokens;
        const choice = completion.choices[0];
        return { content: choice?.message?.content?.trim() ?? "{}", finish_reason: choice?.finish_reason ?? null, paced_ms: waited, retried_429: retried, retried_transient: retriedTransient };
      } catch (e) {
        if (!is429(e)) {
          // One retry for a blip; a second failure on the same call, or a wait past the deadline, is the run's stop.
          if (!isTransientTransport(e) || retriedTransient) throw e;
          const atTransient = now();
          if (deadline != null && atTransient + RETRY_TRANSIENT_WAIT_MS > deadline) throw e;
          opts.log?.(`${e instanceof Error ? e.message : String(e)} on ${req.purpose}; retrying once after ${(RETRY_TRANSIENT_WAIT_MS / 1000).toFixed(1)} s`);
          await sleep(RETRY_TRANSIENT_WAIT_MS);
          waited += RETRY_TRANSIENT_WAIT_MS;
          retriedTransient = true;
          paced.entry.at = now();
          continue;
        }
        const message = e instanceof Error ? e.message : String(e);
        if (retried) throw new JudgeCallRefusedError("rate_limit", `${message}; a second 429 on the same ${req.purpose} call`);
        const after = retryAfterMs(e, now());
        if (after === null) throw new JudgeCallRefusedError("rate_limit", `${message}; no retry-after to wait for`);
        if (after > RETRY_429_MAX_WAIT_MS) throw new JudgeCallRefusedError("rate_limit", `${message}; retry-after ${(after / 1000).toFixed(1)} s is over the ${RETRY_429_MAX_WAIT_MS / 1000} s the client waits`);
        const wait = after + RETRY_429_CUSHION_MS;
        const at = now();
        if (deadline != null && at + wait > deadline) throw new JudgeCallRefusedError("rate_limit", `${message}; the retry after ${(wait / 1000).toFixed(1)} s would start after the deadline`);
        opts.log?.(`429 on ${req.purpose}; retrying once after ${(wait / 1000).toFixed(1)} s`);
        await sleep(wait);
        waited += wait;
        retried = true;
        // The retry is the call the window counts, from its own start.
        paced.entry.at = now();
      }
    }
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
