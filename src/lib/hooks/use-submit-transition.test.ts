import { describe, expect, it } from "vitest";
import { makeGuardedStart } from "@/lib/hooks/use-submit-transition";

describe("a guarded submit", () => {
  it("runs one submission at a time: clicks that land while one is in flight are dropped", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const start = (fn: () => Promise<void>) => { void fn(); };
    const submit = makeGuardedStart(start);
    submit(async () => { runs += 1; await gate; });
    submit(async () => { runs += 1; await gate; });
    submit(async () => { runs += 1; await gate; });
    expect(runs).toBe(1);
    release();
    await gate;
    await Promise.resolve();
    submit(async () => { runs += 1; });
    await Promise.resolve();
    expect(runs).toBe(2);
  });

  it("releases the guard when the submission throws", async () => {
    let runs = 0;
    const start = (fn: () => Promise<void>) => { void fn().catch(() => undefined); };
    const submit = makeGuardedStart(start);
    submit(async () => { runs += 1; throw new Error("boom"); });
    await Promise.resolve();
    await Promise.resolve();
    submit(async () => { runs += 1; });
    await Promise.resolve();
    expect(runs).toBe(2);
  });
});
