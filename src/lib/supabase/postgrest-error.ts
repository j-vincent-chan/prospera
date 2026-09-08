/** Readable messages for PostgREST / Supabase gateway errors. */

export type PostgrestLikeError = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

/**
 * A gateway rejection (over-long URL, oversized body, upstream outage) returns
 * a plain-text HTTP reason phrase instead of PostgREST's JSON error, so
 * supabase-js reports it as `{ message: "Bad Request" }` with no code, details
 * or hint. That bare message tells nobody what went wrong.
 */
export function isGatewayStatusMessage(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code?.trim() || error.details?.trim() || error.hint?.trim()) return false;
  const message = error.message?.trim() ?? "";
  return /^(bad request|payload too large|request entity too large|(request-)?uri too (long|large)|bad gateway|service unavailable|gateway time-?out)$/i.test(
    message
  );
}

/**
 * Turn a PostgREST error into a message naming the operation that failed and
 * carrying every field Supabase returned.
 */
export function postgrestErrorMessage(
  context: string,
  error: PostgrestLikeError | null | undefined
): string {
  const message = error?.message?.trim() || "Unknown database error";
  const parts: string[] = [];
  if (error?.code?.trim()) parts.push(`code ${error.code.trim()}`);
  if (error?.details?.trim()) parts.push(`details: ${error.details.trim()}`);
  if (error?.hint?.trim()) parts.push(`hint: ${error.hint.trim()}`);
  if (isGatewayStatusMessage(error)) {
    parts.push(
      "no PostgREST error code — the Supabase gateway rejected the request itself, " +
        "usually because the request URL or body was too large"
    );
  }
  const suffix = parts.length > 0 ? ` (${parts.join("; ")})` : "";
  return `${context}: ${message}${suffix}`;
}
