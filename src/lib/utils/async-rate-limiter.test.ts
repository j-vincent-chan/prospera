import { describe, expect, it } from "vitest";
import { AsyncRateLimiter, runWorkerPool } from "@/lib/utils/async-rate-limiter";

describe("AsyncRateLimiter", () => {
  it("spaces concurrent schedules by minIntervalMs", async () => {
    const limiter = new AsyncRateLimiter(50);
    const started: number[] = [];

    await Promise.all(
      Array.from({ length: 4 }, () =>
        limiter.schedule(async () => {
          started.push(Date.now());
        })
      )
    );

    for (let i = 1; i < started.length; i++) {
      expect(started[i]! - started[i - 1]!).toBeGreaterThanOrEqual(45);
    }
  });
});

describe("runWorkerPool", () => {
  it("runs items in order with the given concurrency", async () => {
    const seen: number[] = [];
    await runWorkerPool([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops dispatching after a worker throws; a worker in flight finishes its item and stops", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = runWorkerPool([0, 1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item);
      if (item === 1) throw new Error("boom");
      if (item === 0) await gate;
      finished.push(item);
    });
    await expect(run).rejects.toThrow("boom");
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([0, 1]);
    expect(finished).toEqual([0]);
  });
});
