import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { callJson, DEFAULT_JUDGE_TPM, estimateTokens, is429, JUDGE_MAX_TOKENS, JudgeCallRefusedError, judgeTpm, openaiJudge, parseTryAgain, retryAfterMs, RETRY_429_CUSHION_MS, TokenPacer, type JudgeModelRequest } from "@/lib/fit/judge/model";

/** A clock the tests advance; `sleep` advances it instead of waiting. */
function clock(start = 1_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

const req = (chars: number, maxTokens = 1_000, over: Partial<JudgeModelRequest> = {}): JudgeModelRequest => ({ purpose: "blind_a", system: "", user: "x".repeat(chars), model: "m", maxTokens, ...over });

describe("judge/model · pacing under the TPM window (PR 3.1c)", () => {
  it("FIT_JUDGE_TPM: default 25,000; a positive integer overrides; junk is the default", () => {
    expect(judgeTpm({})).toBe(DEFAULT_JUDGE_TPM);
    expect(judgeTpm({ FIT_JUDGE_TPM: " 12000 " })).toBe(12_000);
    expect(judgeTpm({ FIT_JUDGE_TPM: "0" })).toBe(DEFAULT_JUDGE_TPM);
    expect(judgeTpm({ FIT_JUDGE_TPM: "lots" })).toBe(DEFAULT_JUDGE_TPM);
    expect(judgeTpm({ FIT_JUDGE_TPM: "1.5" })).toBe(DEFAULT_JUDGE_TPM);
  });

  it("estimates a call at prompt chars / 4 plus the whole max_tokens", () => {
    expect(estimateTokens({ system: "abcd", user: "efgh", maxTokens: 100 })).toBe(102);
    expect(estimateTokens({ system: "abcde", user: "", maxTokens: JUDGE_MAX_TOKENS.blind_a })).toBe(2 + 1_200);
  });

  it("the sliding window: a call that fits waits nothing; one that does not waits until enough of the oldest calls leave the minute; an empty window always fits", () => {
    const c = clock(0);
    const p = new TokenPacer({ tpm: 25_000, now: c.now, sleep: c.sleep });
    expect(p.waitNeeded(6_000, 0)).toBe(0);
    for (const at of [0, 10_000, 20_000, 30_000]) p.record(6_000, at);
    expect(p.used(35_000)).toBe(24_000);
    expect(p.waitNeeded(1_000, 35_000)).toBe(0);
    // 24,000 + 5,000 > 25,000: the t = 0 call must leave the window — at t = 60 s
    expect(p.waitNeeded(5_000, 35_000)).toBe(25_000);
    // 24,000 + 11,000: two must leave — the t = 10 s call leaves at 70 s
    expect(p.waitNeeded(11_000, 35_000)).toBe(35_000);
    // a call larger than the limit waits for the window to empty, never forever
    expect(p.waitNeeded(30_000, 35_000)).toBe(55_000);
    // entries that left the window are gone (the window only moves forward: a query prunes what is behind it)
    expect(p.used(61_000)).toBe(18_000);
    expect(p.waitNeeded(30_000, 90_001)).toBe(0);
  });

  it("pace: sleeps the minimum wait then records the call; refuses — without sleeping — when the wait would end after the deadline", async () => {
    const c = clock(0);
    const p = new TokenPacer({ tpm: 25_000, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 4; i++) {
      await p.pace(6_000, null);
      c.advance(10_000);
    }
    expect(c.sleeps).toEqual([]);
    // t = 40 s: the fifth call waits until t = 60 s — past a deadline of 50 s, within one of 60 s
    await expect(p.pace(6_000, 50_000)).rejects.toMatchObject({ name: "JudgeCallRefusedError", reason: "deadline", message: expect.stringMatching(/24000 of 25000 tokens .* 20\.0 s, after the deadline/) });
    expect(c.sleeps).toEqual([]);
    expect(c.now()).toBe(40_000);
    const r = await p.pace(6_000, 60_000);
    expect(c.sleeps).toEqual([20_000]);
    expect(r).toMatchObject({ waited_ms: 20_000, entry: { at: 60_000, tokens: 6_000 } });
    expect(p.used(60_000)).toBe(24_000);
  });
});

describe("judge/model · the one bounded 429 retry (PR 3.1c)", () => {
  const MSG = "429 Rate limit reached for gpt-4o in organization org-x on tokens per min (TPM): Limit 30000, Used 25339, Requested 5560. Please try again in 1.798s. Visit https://platform.openai.com/account/rate-limits to learn more.";

  it("recognizes a 429 by status or message and reads its wait: retry-after-ms, then the message, then retry-after (seconds or a date)", () => {
    expect(is429({ status: 429, message: "boom" })).toBe(true);
    expect(is429(new Error(MSG))).toBe(true);
    expect(is429(new Error("401 invalid api key"))).toBe(false);
    expect(is429(null)).toBe(false);
    expect(parseTryAgain(MSG)).toBe(1_798);
    expect(parseTryAgain("Please try again in 20ms.")).toBe(20);
    expect(parseTryAgain("Please try again in 1m2.5s.")).toBe(62_500);
    expect(parseTryAgain("try again later")).toBeNull();
    expect(retryAfterMs({ status: 429, message: MSG, headers: new Headers({ "retry-after-ms": "900" }) })).toBe(900);
    expect(retryAfterMs({ status: 429, message: MSG, headers: new Headers({ "retry-after": "5" }) })).toBe(1_798);
    expect(retryAfterMs({ status: 429, message: "429 slow down", headers: new Headers({ "retry-after": "5" }) })).toBe(5_000);
    expect(retryAfterMs({ status: 429, message: "429 slow down", headers: { "retry-after": "2" } })).toBe(2_000);
    expect(retryAfterMs({ status: 429, message: "429 slow down", headers: new Headers({ "retry-after": new Date(10_000).toUTCString() }) }, 5_000)).toBe(5_000);
    expect(retryAfterMs({ status: 429, message: "429 slow down" })).toBeNull();
  });

  /** A fake SDK client whose `create` answers from a queue: a reply, or a thunk that throws. */
  function fakeClient(answers: Array<unknown | (() => never)>) {
    const create = vi.fn(async () => {
      const a = answers.shift();
      if (typeof a === "function") (a as () => never)();
      return a;
    });
    return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
  }
  const ok = (content: string, prompt_tokens?: number) => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: prompt_tokens !== undefined ? { prompt_tokens, completion_tokens: 10, total_tokens: prompt_tokens + 10 } : undefined });
  const err429 = (message = MSG, headers?: Record<string, string>) => () => {
    throw Object.assign(new Error(message), { status: 429, headers: new Headers(headers ?? {}) });
  };

  it("waits the retry-after plus the cushion once, retries the same call and reports it; the reply's usage settles the window to the provider's count", async () => {
    const c = clock(1_000_000);
    const pacer = new TokenPacer({ tpm: 25_000, now: c.now, sleep: c.sleep });
    const { client, create } = fakeClient([err429(), ok('{"a":1}', 4_000)]);
    const log: string[] = [];
    const fn = openaiJudge({ client, pacer, now: c.now, sleep: c.sleep, log: (l) => log.push(l) });
    const reply = await fn(req(4_000, 1_000, { deadline: c.now() + 60_000 }));
    expect(create).toHaveBeenCalledTimes(2);
    expect(c.sleeps).toEqual([1_798 + RETRY_429_CUSHION_MS]);
    expect(reply).toEqual({ content: '{"a":1}', finish_reason: "stop", paced_ms: 1_798 + RETRY_429_CUSHION_MS, retried_429: true });
    expect(log).toEqual(["429 on blind_a; retrying once after 2.0 s"]);
    // the estimate (4,000 / 4 + 1,000 = 2,000) is replaced by the provider's prompt count plus the max_tokens reservation
    expect(pacer.used()).toBe(4_000 + 1_000);
  });

  it("a second 429 on the same call, a retry-after over 30 s, one that would cross the deadline, or none at all is a rate_limit refusal; any other error passes through unchanged", async () => {
    const c = clock(1_000_000);
    const mk = (answers: Array<unknown | (() => never)>) => openaiJudge({ client: fakeClient(answers).client, pacer: new TokenPacer({ tpm: 25_000, now: c.now, sleep: c.sleep }), now: c.now, sleep: c.sleep });
    await expect(mk([err429(), err429()])(req(4_000))).rejects.toMatchObject({ name: "JudgeCallRefusedError", reason: "rate_limit", message: expect.stringContaining("a second 429 on the same blind_a call") });
    await expect(mk([err429("429 slow down", { "retry-after": "45" })])(req(4_000))).rejects.toMatchObject({ reason: "rate_limit", message: expect.stringContaining("retry-after 45.0 s is over the 30 s") });
    await expect(mk([err429()])(req(4_000, 1_000, { deadline: c.now() + 1_000 }))).rejects.toMatchObject({ reason: "rate_limit", message: expect.stringContaining("would start after the deadline") });
    await expect(mk([err429("429 slow down")])(req(4_000))).rejects.toMatchObject({ reason: "rate_limit", message: expect.stringContaining("no retry-after") });
    const auth = mk([
      () => {
        throw Object.assign(new Error("401 invalid api key"), { status: 401 });
      },
    ]);
    const e = await auth(req(4_000)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(JudgeCallRefusedError);
    expect((e as Error).message).toBe("401 invalid api key");
  });

  it("paces across calls: the fifth 6 k call waits for the first to leave the minute, and is refused as a deadline stop when that wait would cross the request's deadline", async () => {
    const c = clock(1_000_000);
    const start = c.now();
    const pacer = new TokenPacer({ tpm: 25_000, now: c.now, sleep: c.sleep });
    const fn = openaiJudge({ client: fakeClient(Array.from({ length: 6 }, () => ok("{}"))).client, pacer, now: c.now, sleep: c.sleep });
    // 20,000 chars / 4 + 1,000 = 6,000 tokens a call, one every 5 s
    for (let i = 0; i < 4; i++) {
      expect(await fn(req(20_000, 1_000, { deadline: start + 240_000 }))).toMatchObject({ paced_ms: 0, retried_429: false });
      c.advance(5_000);
    }
    expect(c.sleeps).toEqual([]);
    // t = +20 s, 24,000 in the window: the fifth needs the t = 0 call gone — at +60 s, a 40 s wait — but must start by +30 s
    await expect(fn(req(20_000, 1_000, { deadline: start + 30_000 }))).rejects.toMatchObject({ reason: "deadline" });
    expect(c.sleeps).toEqual([]);
    const fifth = await fn(req(20_000, 1_000, { deadline: start + 240_000 }));
    expect(c.sleeps).toEqual([40_000]);
    expect(fifth).toMatchObject({ paced_ms: 40_000, retried_429: false });
    expect(c.now()).toBe(start + 60_000);
  });
});

describe("judge/model · callJson", () => {
  it("a string reply and the client's object reply parse the same; a truncated reply is unusable", async () => {
    const r = await callJson(async () => '{"ok":true}', req(10));
    expect(r).toMatchObject({ raw: { ok: true }, usable: true });
    const t = await callJson(async () => ({ content: '{"ok":true}', finish_reason: "length", paced_ms: 5, retried_429: false }), req(10));
    expect(t.usable).toBe(false);
  });
});
