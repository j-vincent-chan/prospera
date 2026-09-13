import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth/public-paths";

describe("isPublicPath", () => {
  it("lets the pages people open from an email through without a session", () => {
    expect(isPublicPath("/biosketch/0123456789abcdef")).toBe(true);
    expect(isPublicPath("/r/0123456789abcdef0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isPublicPath("/invite/abc")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/api/calendar/x.ics")).toBe(true);
    expect(isPublicPath("/api/cron/sync")).toBe(true);
  });
  it("keeps the app behind sign-in", () => {
    for (const p of ["/", "/home", "/outreach", "/outreach/draft", "/review", "/r", "/reports", "/api/investigators/search"]) expect(isPublicPath(p)).toBe(false);
  });
});
