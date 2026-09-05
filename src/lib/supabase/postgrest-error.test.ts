import { describe, expect, it } from "vitest";
import { isGatewayStatusMessage, postgrestErrorMessage } from "@/lib/supabase/postgrest-error";

describe("isGatewayStatusMessage", () => {
  it("detects bare HTTP reason phrases with no PostgREST fields", () => {
    expect(isGatewayStatusMessage({ message: "Bad Request" })).toBe(true);
    expect(isGatewayStatusMessage({ message: "payload too large" })).toBe(true);
    expect(isGatewayStatusMessage({ message: "Gateway Timeout" })).toBe(true);
  });

  it("ignores real PostgREST errors", () => {
    expect(
      isGatewayStatusMessage({ message: "Bad Request", code: "PGRST204", details: null, hint: null })
    ).toBe(false);
    expect(isGatewayStatusMessage({ message: "duplicate key value" })).toBe(false);
    expect(isGatewayStatusMessage(null)).toBe(false);
  });
});

describe("postgrestErrorMessage", () => {
  it("names the failing operation and explains a bare gateway rejection", () => {
    const message = postgrestErrorMessage(
      "community_source_items delete (716 rows)",
      { message: "Bad Request" }
    );
    expect(message).toContain("community_source_items delete (716 rows)");
    expect(message).toContain("Bad Request");
    expect(message).toContain("Supabase gateway");
  });

  it("carries code, details and hint from PostgREST", () => {
    const message = postgrestErrorMessage("community_source_items upsert (8 rows)", {
      message: 'column "origin" does not exist',
      code: "42703",
      details: "some detail",
      hint: "some hint",
    });
    expect(message).toContain("code 42703");
    expect(message).toContain("details: some detail");
    expect(message).toContain("hint: some hint");
    expect(message).not.toContain("Supabase gateway");
  });

  it("falls back when the error has no message", () => {
    expect(postgrestErrorMessage("investigators lookup", {})).toBe(
      "investigators lookup: Unknown database error"
    );
  });
});
