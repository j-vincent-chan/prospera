import type { CalendarEvent } from "@/lib/calendar/queries";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = ` ${rest.slice(73)}`;
  }
  out.push(rest);
  return out.join("\r\n");
};

/** All-day VEVENTs, one per deadline, with the kind as the category. */
export function buildIcs(input: { teamName: string; events: CalendarEvent[]; siteUrl: string }): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Prospera//Outreach calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${esc(`Prospera · ${input.teamName}`)}`),
    "X-WR-TIMEZONE:America/Los_Angeles",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
  ];
  for (const e of input.events) {
    const d = e.date.replace(/-/g, "");
    const next = new Date(`${e.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:${e.id}@prospera`),
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
      fold(`SUMMARY:${esc(e.title)}`),
      fold(`DESCRIPTION:${esc(`${e.detail}${e.href ? `\n${input.siteUrl}${e.href}` : ""}`)}`),
      fold(`CATEGORIES:${esc(e.kind === "sponsor" ? "Sponsor deadline" : e.kind === "internal" ? "Internal deadline" : e.kind === "loi" ? "LOI" : "Limited submission")}`),
      ...(e.href ? [fold(`URL:${input.siteUrl}${e.href}`)] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
