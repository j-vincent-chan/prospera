import { describe, expect, it } from "vitest";
import { opportunitiesHref, parseOpportunitiesState } from "./list-state";

describe("opportunities list state", () => {
  it("defaults to federal, search, open+forecasted, next-due sort", () => {
    const s = parseOpportunitiesState({});
    expect(s.scope).toBe("federal");
    expect(s.mode).toBe("search");
    expect(s.status).toBe("open_forecasted");
    expect(s.list.sort).toBe("next_due");
    expect(s.list.order).toBe("asc");
    expect(opportunitiesHref(s)).toBe("/opportunities");
  });
  it("round-trips the v2 controls", () => {
    const s = parseOpportunitiesState({ scope: "limited", mode: "ask", status: "open", closing: "60", posted: "7", dismissed: "1", q: "immunology" });
    const href = opportunitiesHref(s);
    const back = parseOpportunitiesState(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(back.scope).toBe("limited");
    expect(back.mode).toBe("ask");
    expect(back.status).toBe("open");
    expect(back.closing).toBe(60);
    expect(back.posted).toBe(7);
    expect(back.dismissed).toBe(true);
    expect(back.list.q).toBe("immunology");
  });
  it("resets the page unless asked to keep it", () => {
    const s = parseOpportunitiesState({ page: "3" });
    expect(opportunitiesHref(s)).not.toMatch(/page=3/);
    expect(opportunitiesHref(s, { keepPage: true })).toMatch(/page=3/);
  });
});
