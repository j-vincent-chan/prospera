const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

/** "Aug 28" */
export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : short.format(d);
}

/** "Jan 2025" */
export function fmtMonthYear(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : monthYear.format(d);
}

export function isPast(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

/** "expires Sep 27" or "expired" */
export function expiresLabel(iso: string): string {
  return isPast(iso) ? "expired" : `expires ${fmtShort(iso)}`;
}

/** "in 6 days" / "today" / "3 days ago" */
export function relativeDays(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86400_000);
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}

export function initialsOf(name: string | null | undefined, fallback = "?"): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function firstName(name: string | null | undefined, email?: string | null): string {
  const n = (name ?? "").trim();
  if (n) return n.split(/\s+/)[0]!;
  return email?.split("@")[0] ?? "there";
}
