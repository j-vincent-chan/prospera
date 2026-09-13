/**
 * Message — Draft outreach (design_handoff_prospera_review_outreach README
 * §6): the four beats of a message, composed from what the match actually
 * rests on. Pure — records in, words out; the loader in `draft-queries.ts`
 * gathers the records.
 *
 * **Nothing here is written for the page.** The prototype's "why you" line
 * was prose about peripheral tolerance; the product has no author per match,
 * so every beat is assembled from fields the notice and the match carry, and
 * a beat with nothing behind it says so in its source label rather than
 * inventing a sentence. The strategist edits from there.
 *
 * The body the send path receives is `assembleBody`: the greeting, beat 1,
 * the personal-line token in beat 2's place, beats 3 and 4, and the sign-off
 * — so `renderForRecipient` (the existing send path) puts each recipient's
 * own "why you" in, exactly as the Compose tab always did.
 */
import { fmtMonD } from "@/lib/funding-opportunities/receipt-cycles";
import { money } from "@/lib/review/queue";
import { DEFAULT_PERSONAL_LINE, LAST_NAME_TOKEN, PERSONAL_LINE_TOKEN } from "@/lib/outreach/draft";

export const DEFAULT_CLOSING_LINE = "If you would like to pursue it, reply here and I will set up a 20-minute scoping call.";

/** One beat: the text the strategist edits, and where it came from (the 11px line under the label). */
export type Beat = { text: string; source: string };

export type Beats = {
  /** "Why it is relevant" — the notice's own facts. */
  relevant: Beat;
  /**
   * "Why you" — the only sentence that changes per recipient. `evidence` is
   * the line written from the match's first cited item (or the honest
   * default when nothing is cited); `sharp` is the bolder line written from
   * what the notice requires, null when the notice has no profile to say it.
   */
  whyYou: { evidence: Beat; sharp: Beat | null };
  /** "What to know" — the notice's constraints and the team's routing rule. */
  know: Beat;
  /** "Next step" — the team's standing closing line. */
  next: Beat;
};

export type BeatNotice = {
  /** "NIH", "NSF" — the short sponsor name. */
  sponsor: string | null;
  number: string | null;
  /** The title without its trailing "(R01 Clinical Trial Optional)". */
  shortTitle: string;
  dueDate: string | null;
  /** Direct costs per year, from the profile or the notice. */
  ceilingPerYear: number | null;
  periodYears: number | null;
  /** The Guide section the award figure was read from, when the profile recorded one. */
  awardSection: string | null;
  limited: boolean;
  cap: number | null;
  consortiumRequired: boolean;
  requiredPartners: string[];
  /** The profile's clinical-trial rule: required / not_allowed / optional / basic_experimental_studies_with_humans / unknown. */
  clinicalTrial: string | null;
  humanMaterialsRequired: boolean;
  loiDue: string | null;
  routingDate: string | null;
  /** The research approaches the notice's profile requires, as labels ("Molecular / cellular mechanistic") — the sharper line's material. Empty without a profile, or when it requires none. */
  requiredApproaches: string[];
  /** The required study population in the notice's words, if any. */
  population: string | null;
};

export type BeatEvidenceKind = "publication" | "grant" | "trial" | "biosketch" | "profiles" | "other";

/** The first cited item behind the match, as the loader resolved it. */
export type BeatEvidence = {
  kind: BeatEvidenceKind;
  title: string;
  /** "Sci Immunol · 2025", "1R03AR082948-01 · NIAMS · 2023–2026". */
  meta: string | null;
  /** The year, when the meta carries one. */
  year: string | null;
};

export type BeatInput = {
  notice: BeatNotice;
  /** The match's first cited item; null when Prospera has nothing on this pair. */
  evidence: BeatEvidence | null;
  /** The last message to this person about this notice — a nudge, not a first note. */
  contactedAt: string | null;
  /** `teams.outreach_closing_line`; null for the default. */
  closingLine: string | null;
  today: string;
};

const SOURCE_NAME: Record<BeatEvidenceKind, string> = { publication: "PubMed", grant: "NIH RePORTER", trial: "ClinicalTrials.gov", biosketch: "the biosketch", profiles: "UCSF Profiles", other: "the profile" };

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const listOr = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** "[Sponsor] has posted [number] — [short title] — due [date]. Awards run to [$ ceiling] direct per year for up to [n] years." */
export function relevantBeat(n: BeatNotice, today: string): Beat {
  const sponsor = n.sponsor ?? "The sponsor";
  const what = [n.number, n.shortTitle].filter(Boolean).join(" — ");
  const due = n.dueDate ? ` — due ${fmtMonD(n.dueDate, today)}` : "";
  const ceiling = n.ceilingPerYear ? money(n.ceilingPerYear) : null;
  const award = ceiling
    ? `Awards run to ${ceiling} direct per year${n.periodYears ? ` for up to ${n.periodYears} year${n.periodYears === 1 ? "" : "s"}` : ""}.`
    : n.periodYears
      ? `Projects run up to ${n.periodYears} year${n.periodYears === 1 ? "" : "s"}.`
      : null;
  const source = `from the notice${n.awardSection && ceiling ? ` · ${n.awardSection}` : n.dueDate ? " · Key Dates" : ""}`;
  return { text: [`${sponsor} has posted ${what}${due}.`, award].filter(Boolean).join(" "), source };
}

/** The evidence-led line, and its source label — or the honest default when nothing is cited. */
export function evidenceBeat(e: BeatEvidence | null, contactedAt: string | null, routingDate: string | null, today: string): Beat {
  if (contactedAt) {
    return { text: `Following up on my note from ${fmtMonD(contactedAt.slice(0, 10), today)}${routingDate ? ` — the internal routing date is ${fmtMonD(routingDate, today)}` : ""}, in case it slipped past.`, source: "a follow-up · the first message went out " + fmtMonD(contactedAt.slice(0, 10), today) };
  }
  if (!e) return { text: DEFAULT_PERSONAL_LINE, source: "no cited evidence — Prospera has not assessed this pair, so write this line yourself" };
  const source = `from ${SOURCE_NAME[e.kind]}${e.meta ? ` · ${e.meta.split(" · ")[0]}` : ""}`;
  switch (e.kind) {
    case "publication":
      return { text: `Your ${e.year ? `${e.year} ` : ""}paper “${e.title}” is close to what this notice is asking for — worth a conversation before you commit anything.`, source };
    case "grant":
      return { text: `Your award ${e.title ? `“${e.title}”` : ""}${e.meta ? ` (${e.meta.split(" · ")[0]})` : ""} sits squarely in the scope here, and this notice would support a distinct next project.`.replace(/\s+/g, " "), source };
    case "trial":
      return { text: `Your trial “${e.title}” puts you close to what this notice is asking for — worth a conversation before you commit anything.`, source };
    case "biosketch":
      return { text: "The focus you describe in your biosketch reads as a direct fit for this notice.", source };
    case "profiles":
      return { text: "Your research focus, as your UCSF profile describes it, is close to what this notice is asking for.", source };
    default:
      return { text: DEFAULT_PERSONAL_LINE, source };
  }
}

/**
 * The sharper line: the research approach the notice requires, and that this
 * person's work is where it sits. Written from the required approach labels
 * only — never the unit levels or design ids, which are the engine's
 * vocabulary, not a sentence to a PI. Null when the profile requires nothing,
 * or on a follow-up — the toggle needs something to say.
 */
export function sharpBeat(n: BeatNotice, contactedAt: string | null): Beat | null {
  if (contactedAt || !n.requiredApproaches.length) return null;
  const kinds = listOr(n.requiredApproaches.slice(0, 3).map((a) => lower(a).replace(/\s+research$/i, "")));
  return { text: `This notice is written for ${kinds} work${n.population ? ` in ${n.population}` : ""}, and that is where your work sits — the fit is closer than most on my list, and I would rather you heard it from me than found it later.`, source: "from the notice's requirements · Prospera's assessment cleared this match" };
}

/** The constraints a strategist would flag before the investigator decides, and the routing offer. */
export function knowBeat(n: BeatNotice, today: string): Beat {
  const items: string[] = [];
  if (n.limited) items.push(n.cap ? `limited submission · ${n.cap} per institution` : "limited submission · UCSF must choose whom to put forward");
  if (n.consortiumRequired) items.push("needs a consortium");
  if (n.requiredPartners.length) items.push(`needs ${list(n.requiredPartners.map(lower))}`);
  if (n.clinicalTrial === "required") items.push("a clinical trial is required");
  if (n.clinicalTrial === "not_allowed") items.push("no clinical trial");
  if (n.clinicalTrial === "basic_experimental_studies_with_humans") items.push("basic experimental studies with humans are required");
  if (n.humanMaterialsRequired) items.push("human materials or participants are required");
  if (n.loiDue) items.push(`letter of intent due ${fmtMonD(n.loiDue, today)}`);
  const routing = n.routingDate ? `internal routing ${fmtMonD(n.routingDate, today)}` : null;
  const source = routing ? "from the notice and your team's routing rule" : "from the notice";
  if (!items.length) return { text: routing ? `No unusual constraints on this one; ${routing}, and I can handle it.` : "No unusual constraints on this one, and I can handle the internal routing.", source };
  return { text: `Worth knowing before you decide: ${[...items, routing].filter(Boolean).join("; ")}. I can handle the internal routing.`, source };
}

export function nextBeat(closingLine: string | null): Beat {
  const own = closingLine?.trim();
  return own ? { text: own, source: "your standing template" } : { text: DEFAULT_CLOSING_LINE, source: "the default closing line · set your own in Team settings" };
}

/** Pure. The four beats for one match. */
export function composeBeats(input: BeatInput): Beats {
  return {
    relevant: relevantBeat(input.notice, input.today),
    whyYou: { evidence: evidenceBeat(input.evidence, input.contactedAt, input.notice.routingDate, input.today), sharp: sharpBeat(input.notice, input.contactedAt) },
    know: knowBeat(input.notice, input.today),
    next: nextBeat(input.closingLine),
  };
}

/** "Funding opportunity: [short title] — due [Oct 16]" — the subject as README §6 writes it. */
export function subjectOf(n: Pick<BeatNotice, "shortTitle" | "dueDate">, today: string): string {
  return `Funding opportunity: ${n.shortTitle}${n.dueDate ? ` — due ${fmtMonD(n.dueDate, today)}` : ""}`;
}

/**
 * The body the send path renders per recipient: greeting, beat 1, the
 * personal-line token where "why you" goes, beats 3 and 4, the sign-off.
 * `renderForRecipient` fills the two tokens.
 */
export function assembleBody(beats: { relevant: string; know: string; next: string }, signoff: string): string {
  return [`Dear Dr. ${LAST_NAME_TOKEN},`, "", beats.relevant.trim(), "", PERSONAL_LINE_TOKEN, "", beats.know.trim(), "", beats.next.trim(), "", "Best,", signoff].join("\n");
}

/** Pure. "(R01 Clinical Trial Optional)" and its kin come off the end of a title. */
export function shortTitleOf(title: string): string {
  return title.replace(/\s*\((R|U|K|P|F|T|D|G|S|X|C|N|M)\d{2}[^)]*\)\s*$/i, "").replace(/\s*\((?:Clinical Trials?[^)]*)\)\s*$/i, "").trim();
}

/** Pure. The year in "Sci Immunol · 2025" or "1R03AR082948-01 · NIAMS · 2023–2026" (the first four-digit year). */
export function yearOf(meta: string | null | undefined): string | null {
  const m = meta?.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}
