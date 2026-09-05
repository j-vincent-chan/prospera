/**
 * Simpler-owned "last changed" timestamp for an opportunity payload.
 *
 * The NIH Guide sync re-queues a notice when Simpler changed it after the last
 * Guide fetch. It cannot use funding_opportunities.updated_at for that: the
 * set_updated_at BEFORE UPDATE trigger stamps the Guide sync's own write, so
 * every fetched row looked "changed" every night (GUIDE_DIAGNOSTICS.md,
 * validator amendments). This value comes only from Simpler's payload, which
 * the trigger cannot touch:
 *
 *   - `summary.updated_at`  — on every search hit and detail record; moves when
 *                             Simpler edits the summary (dates, description).
 *   - `updated_at`          — top-level, detail records only; moves on any
 *                             change to the opportunity (status flip, attachments).
 *   - `summary.created_at` / `created_at` — fallbacks for payloads without an
 *                             updated_at (none seen in the corpus; kept for safety).
 *
 * The latest of the available values wins. Returns an ISO-8601 UTC string or
 * null when the payload carries none of them.
 */
export function sourceUpdatedAt(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw || typeof raw !== "object") return null;
  const summary = raw.summary && typeof raw.summary === "object" && !Array.isArray(raw.summary) ? (raw.summary as Record<string, unknown>) : null;
  const primary = [raw.updated_at, summary?.updated_at].map(toIso).filter((v): v is string => v !== null);
  if (primary.length) return primary.sort().at(-1)!;
  const fallback = [raw.created_at, summary?.created_at].map(toIso).filter((v): v is string => v !== null);
  return fallback.length ? fallback.sort().at(-1)! : null;
}

function toIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
