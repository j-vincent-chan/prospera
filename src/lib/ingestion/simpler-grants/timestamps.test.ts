import { describe, expect, it } from "vitest";
import { sourceUpdatedAt } from "./timestamps";

describe("sourceUpdatedAt", () => {
  it("reads summary.updated_at from a search hit", () => {
    expect(sourceUpdatedAt({ opportunity_id: "x", summary: { updated_at: "2026-08-27T18:15:49+00:00", created_at: "2026-06-09T12:16:21+00:00" } })).toBe("2026-08-27T18:15:49.000Z");
  });
  it("takes the later of top-level updated_at (detail record) and summary.updated_at", () => {
    expect(sourceUpdatedAt({ updated_at: "2025-12-05T18:47:27+00:00", summary: { updated_at: "2025-12-05T18:47:04+00:00" } })).toBe("2025-12-05T18:47:27.000Z");
    expect(sourceUpdatedAt({ updated_at: "2025-12-01T00:00:00+00:00", summary: { updated_at: "2025-12-05T18:47:04+00:00" } })).toBe("2025-12-05T18:47:04.000Z");
  });
  it("falls back to created_at and returns null when nothing is usable", () => {
    expect(sourceUpdatedAt({ summary: { created_at: "2026-09-03T18:09:01+00:00" } })).toBe("2026-09-03T18:09:01.000Z");
    expect(sourceUpdatedAt({ summary: { updated_at: "garbage" } })).toBeNull();
    expect(sourceUpdatedAt({ summary: "legacy string summary" })).toBeNull();
    expect(sourceUpdatedAt({})).toBeNull();
    expect(sourceUpdatedAt(null)).toBeNull();
  });
});
