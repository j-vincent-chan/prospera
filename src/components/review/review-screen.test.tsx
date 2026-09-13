/**
 * @vitest-environment jsdom
 *
 * Review, list mode, rendered the way the server renders it — `renderToString`
 * over real props — so a row shape that throws at render time fails here and
 * not in a browser. The suite has no DOM driver, so this asserts what the
 * markup says, not what a click does; the handlers' logic is in
 * `lib/review/queue.test.ts` and `reasons.test.ts`.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewScreen } from "@/components/review/review-screen";
import { ToastProvider } from "@/components/ui/toast";
import type { FitVerdicts } from "@/lib/fit/verdicts";
import type { MatchDecision } from "@/lib/review/decisions";
import type { ReviewNoticeData, ReviewRow } from "@/lib/review/queries";
import { noticeCounts, type QueueNotice } from "@/lib/review/queue";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/review" }));

const NOTICE = "11111111-1111-4111-8111-111111111111";
const P = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;

const verdicts = (label: FitVerdicts["label"], caveatTone: FitVerdicts["caveat"]["tone"] = "quiet"): FitVerdicts => ({
  label,
  approach: { text: "Same paradigm · human immunology", tone: "ok" },
  eligibility: { text: "Eligible · no rule blocks", tone: "ok" },
  evidence: { text: "3 sources · 11 dated items", tone: "ok" },
  reason: "Two 2025 publications and one active award sit inside the notice's stated scope.",
  caveat: { text: "Has never led a multi-project award; the U19 asks for a center lead.", tone: caveatTone },
  action: null,
});

const decision = (investigatorId: string, status: MatchDecision["status"], reason: string | null = null): MatchDecision => ({ opportunityId: NOTICE, investigatorId, status, reason, scope: "pair", auto: false, resurfaceOn: null, verdictLabel: null, decidedBy: "u1", decidedAt: "2026-09-12T00:00:00Z" });

const row = (n: number, name: string, tier: ReviewRow["tier"], label: FitVerdicts["label"], extra: Partial<ReviewRow> = {}): ReviewRow => ({
  investigatorId: P(n),
  opportunityId: NOTICE,
  name,
  initials: name
    .split(" ")
    .map((w) => w[0])
    .join(""),
  href: `/investigators/${P(n)}`,
  identity: "Dermatology · ImmunoX & inflammation · Associate Professor",
  tier,
  verdicts: verdicts(label),
  chips: [{ text: "Same paradigm · human immunology", tone: "ok" }, { text: "Eligible", tone: "ok" }],
  disclosure: { why: "Why this pair was surfaced.", gaps: ["Whether they would lead a center."], items: [{ id: "e1", title: "Illuminating IL-31-producing cells", meta: "NIH RePORTER · 1R03AR082948-01", source: "RePORTER", href: null }] },
  coverage: "3 verified publications · 2 awards · 0 trials. Biosketch not on file.",
  decision: null,
  doNotContact: false,
  contact: "Not contacted",
  history: null,
  clash: null,
  flag: null,
  card: { stage: "Mid-career", paradigm: "Human translational · mechanistic immunology", themes: ["Immunology", "Skin"], facts: [{ key: "Appointment", value: "Associate Professor" }] },
  checks: { assessed: true, rows: [{ key: "e-1", mark: "yes", criterion: "Any career stage", note: null }] },
  citedIds: [],
  ...extra,
});

const rows: ReviewRow[] = [
  row(1, "Marlys Fassett", "strong", "strong"),
  row(2, "Abul Abbas", "moderate", "moderate", { decision: decision(P(2), "confirmed", "science_right"), clash: "Someone else is already mid-conversation with Abul — D. Reyes contacted them Sep 2 about RFA-AR-27-001. Reply pending. Two notes in a week from the same office reads badly.", history: { text: "D. Reyes contacted Abul Sep 2 about RFA-AR-27-001 — no reply.", tone: "warn" } }),
  row(3, "Brian Graham", "exploratory", "exploratory", { decision: decision(P(3), "rejected", "wrong_area") }),
  row(4, "Renuka Nayak", "moderate", "cannot_assess", { flag: null }),
  row(5, "Ruled Out", "moderate", "moderate", { flag: { reason: "wrong_research_type", by: "D. Reyes" } }),
];

const notice: ReviewNoticeData = {
  header: {
    id: NOTICE,
    number: "RFA-AI-27-004",
    meta: "NIH · NIAID · cooperative agreement · U19",
    flag: "Limited submission",
    title: "Atopic Dermatitis Research Network (ADRN)",
    fullTitle: "Atopic Dermatitis Research Network (ADRN) (U19 Clinical Trial Optional)",
    href: `/opportunities/${NOTICE}`,
    pursuit: { verdict: "Worth pursuing", tone: "good", line: "1 strong match and 3 moderate matches in the directory." },
    keyStats: [
      { value: "Sep 24", label: "deadline · 14 days", urgent: true },
      { value: "Sep 17", label: "internal routing · 7 days", urgent: true },
      { value: "$2.5M / yr", label: "5 years · $12.5M total", urgent: false },
    ],
    metaLine: "U19 cooperative agreement · letter of intent passed Sep 3 · 1 per institution",
    summary: "NIAID is renewing the ADRN as a multi-site center network. ".repeat(12),
    dueDate: "2026-09-24",
    detail: {
      facts: [{ label: "Award", value: "$2.5M / yr", sub: "5 years · $12.5M total" }, { label: "Deadline", value: "Sep 24", sub: "14 days" }],
      priorities: ["Atopic dermatitis", "Type-2 immunity"],
      objectives: ["Mechanism discovery", "Treatment evaluation"],
      objectiveQuote: { text: "to understand the mechanisms of atopic dermatitis", section: "Part 2 · Section I" },
      notInScope: ["Animal-model-only programs"],
      bestFit: "Work that is human translational, using biospecimen assays.",
      dealBreakers: ["Limited submission — UCSF may put forward 1 application."],
      assemble: ["Multiple PDs/PIs are allowed, so a co-led application is open."],
      why: "1 strong match and 3 moderate matches in your directory clear the bar for this notice.",
      terms: [{ label: "Eligibility rules", source: "Part 2 · Section III.1", value: "Any individual with the skills…" }],
      provenance: "Assessed from the notice on Sep 9",
      summarySource: "The notice's own synopsis · not Prospera's words",
    },
    fullNoticeUrl: "https://grants.nih.gov/grants/guide/rfa-files/RFA-AI-27-004.html",
  },
  rows,
  emptyText: null,
  counts: noticeCounts(rows.map((r) => ({ tier: r.tier, decision: r.decision, doNotContact: r.doNotContact }))),
  ruledOutEligibility: 2,
  belowFloors: 105,
  hiddenExploratory: 30,
  itemId: "33333333-3333-4333-8333-333333333333",
  profilesDegraded: false,
};

const queueNotice = (id: string, number: string, title: string, dueDays: number | null, counts = notice.counts): QueueNotice => ({ id, number, title, dueDate: dueDays == null ? null : "2026-10-01", dueDays, limited: false, counts });

const notices = [queueNotice(NOTICE, "RFA-AI-27-004", "Atopic Dermatitis Research Network (ADRN) (U19 Clinical Trial Optional)", 14), queueNotice("44444444-4444-4444-8444-444444444444", "PAR-25-122", "Pilot Projects Investigating Understudied Proteins", 36)];

function render(props: Partial<Parameters<typeof ReviewScreen>[0]> = {}) {
  return renderToString(
    <ToastProvider>
      <ReviewScreen engine="fit-v1" available decisionsAvailable notices={notices} confirmedInQueue={1} selectedId={NOTICE} notice={notice} viewerId="viewer" {...props} />
    </ToastProvider>,
  );
}

describe("Review, list mode, server-rendered", () => {
  const html = render();

  it("draws the queue with the counts and the due words, and the selected item's rail", () => {
    expect(html).toContain("Notices in this queue");
    expect(html).toContain("RFA-AI-27-004");
    expect(html).toContain("PAR-25-122");
    expect(html).toContain("14 days");
    expect(html).toContain("36 days");
    expect(html).toContain("5 suggested · 2 decided");
    expect(html).toContain('aria-current="true"');
  });

  it("draws the notice header: number, meta, flag, verdict pill, title, key dates, meta line, summary toggle", () => {
    expect(html).toContain("NIH · NIAID · cooperative agreement · U19");
    expect(html).toContain("Limited submission");
    expect(html).toContain("Pursuing · 1 confirmed");
    expect(html).toContain("Atopic Dermatitis Research Network (ADRN)</h2>");
    expect(html).toContain("Worth pursuing");
    expect(html).toContain("deadline · 14 days");
    expect(html).toContain("$2.5M / yr");
    expect(html).toContain("letter of intent passed Sep 3");
    expect(html).toContain("Read the full purpose");
    expect(html).toContain("Open opportunity");
    expect(html).toContain("Dismiss all 3 matches");
  });

  it("draws every row with the verbs its label and decision imply", () => {
    expect(html).toContain("Suggested investigators");
    expect(html).toContain("2 of 5 decided");
    // Undecided Strong: confirm / dismiss / watch.
    expect(html).toContain("Confirm match");
    expect(html).toContain("Dismiss match");
    expect(html).toContain(">Watch<");
    // Can't assess: the biosketch verb.
    expect(html).toContain("Request a biosketch");
    // A standing pair flag reads as Ruled out.
    expect(html).toContain("Keep it ruled out");
    expect(html).toContain("Reinstate");
    expect(html).toContain("Ruled out · wrong type of research · D. Reyes");
    // Decided rows: Undo and their status text.
    expect(html).toContain(">Undo<");
    expect(html).toContain("Confirmed</p>");
    expect(html).toContain("Dismissed · wrong disease area");
    // The confirmed note, the tags and the clash warning.
    expect(html).toContain("Queued for outreach.");
    expect(html).toContain("Science is right");
    expect(html).toContain("optional — tags the confirmation for calibration");
    expect(html).toContain("Leave it with them");
    expect(html).toContain("Two notes in a week from the same office reads badly.");
    // The disclosure toggle, closed.
    expect(html).toContain("Read Prospera&#x27;s assessment");
    expect(html).not.toContain("Why you are seeing this");
  });

  it("says nothing has been sent, and links the pipeline and the draft", () => {
    expect(html).toContain("1 match confirmed and queued for outreach. Nothing has been sent.");
    expect(html).toContain("Review the pipeline");
    expect(html).toContain("Draft outreach");
    expect(html).toContain("/outreach?item=33333333-3333-4333-8333-333333333333&amp;tab=compose");
  });

  it("the footer carries the three counts and the next notice", () => {
    expect(html).toContain("2 people ruled out on eligibility · 105 below the bar · 30 more exploratory leads not listed.");
    expect(html).toContain("Next notice →");
    expect(html).toContain("/review?notice=44444444-4444-4444-8444-444444444444");
  });

  it("without the decisions table the rows read and the verbs are withheld", () => {
    const readOnly = render({ decisionsAvailable: false });
    expect(readOnly).toContain("Decisions cannot be recorded yet");
    expect(readOnly).not.toContain("Confirm match");
    expect(readOnly).toContain("Read Prospera&#x27;s assessment");
  });

  it("Focus mode: the progress row, the large tier pill, both cards, the strip and the keyed decision bar", () => {
    const html = render({ mode: "focus" });
    expect(html).toContain("← Back to list mode");
    expect(html).toContain("Reviewing match 1 of 5 on notice 1 of 2");
    expect(html).toContain("decisions left");
    expect(html).toContain("Read Prospera&#x27;s assessment");
    // The first undecided row is the cursor: Marlys, a Strong match.
    expect(html).toContain("Marlys Fassett");
    expect(html).toContain("Human translational · mechanistic immunology");
    expect(html).toContain("Investigator");
    expect(html).toContain("Opportunity");
    expect(html).toContain("$2.5M / yr");
    expect(html).toContain("Research objectives");
    expect(html).toContain("Mechanism discovery");
    expect(html).toContain("Best fit for");
    expect(html).toContain("Could kill it");
    expect(html).toContain("What you would need to assemble");
    expect(html).toContain("Also on this notice — click to jump");
    expect(html).toContain("Your decision");
    expect(html).toContain("Confirm match");
    expect(html).toContain("Dismiss match");
    expect(html).toContain("Skip this match");
    expect(html).toContain("Skip the rest of this notice →");
    expect(html).toContain("One at a time, but never blind");
    // List-mode chrome is gone.
    expect(html).not.toContain("Notices in this queue");
    expect(html).not.toContain("Suggested investigators");
  });

  it("Focus mode with everything decided shows the all-decided card and no decision bar", () => {
    const decidedRows = rows.map((r) => (r.decision ? r : { ...r, decision: decision(r.investigatorId, "rejected", "wrong_area") }));
    const decidedNotice = { ...notice, rows: decidedRows, counts: noticeCounts(decidedRows.map((r) => ({ tier: r.tier, decision: r.decision, doNotContact: r.doNotContact }))) };
    const decidedNotices = notices.map((n) => ({ ...n, counts: { ...decidedNotice.counts } }));
    const html = render({ mode: "focus", notice: decidedNotice, notices: decidedNotices });
    expect(html).toContain("Every suggestion is decided.");
    expect(html).toContain("1 confirmed and waiting in the outreach draft. Nothing has been sent.");
    expect(html).toContain("Review what you confirmed");
    expect(html).not.toContain("Your decision");
  });

  it("the three empty states", () => {
    expect(render({ engine: "legacy" })).toContain("Review needs the fit engine.");
    expect(render({ available: false })).toContain("Fit results are not available yet.");
    expect(render({ notices: [], notice: null, selectedId: null })).toContain("Nothing is waiting for a decision.");
  });
});
