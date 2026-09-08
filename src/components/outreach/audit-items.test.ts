/**
 * The Outreach snapshot → audit items adapter, and the wiring around it
 * (fit-UX PR 4).
 *
 * Three of these assertions exist because the mapping is where a silent loss
 * lives: `publicationId`, the identity line and the quote are each read by
 * exactly one thing, so dropping any of them leaves a page that still renders
 * and a control that has quietly disappeared.
 *
 * The last block reads `recipients-tab.tsx` — a weaker check than rendering,
 * and written as exactly that — for the four call-site facts nothing else can
 * reach: that the audit view is handed the *snapshot's* groups, that the
 * identity handler is passed, that the flag control keeps this surface's own
 * words, and that the list's state is not unmounted to show the view.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditItem, auditItemGroups, MAX_CHECKS, suggestionChecks } from "@/components/outreach/audit-items";
import { identityReviewId } from "@/lib/fit/audit-view";
import type { EvidenceGroup, EvidenceItem, SuggestionFlag } from "@/lib/outreach/types";

const TAB = readFileSync(path.join(process.cwd(), "src/components/outreach/recipients-tab.tsx"), "utf8");

const paper: EvidenceItem = {
  id: "publication:31000001",
  heading: "Spatial atlas of tissue-resident T cells",
  sub: "Nature Immunology · Mar 2025",
  link: { label: "PubMed", href: "https://pubmed.ncbi.nlm.nih.gov/31000001/" },
  quote: "We profiled 42 skin biopsies…",
  tags: "carried the topic score",
  inferred: "read as human tissue work",
  identity: { text: "ORCID-linked", kind: "ok" },
  publicationId: "11111111-2222-4333-8444-555566667777",
};

const award: EvidenceItem = { id: "grant:5R01AR070001-03", heading: "Targeted agents", sub: "FY2025 · R01", link: null, publicationId: null };

describe("auditItem", () => {
  it("carries every field the audit view renders", () => {
    expect(auditItem(paper)).toEqual({
      id: paper.id,
      title: paper.heading,
      meta: paper.sub,
      link: paper.link,
      quote: paper.quote,
      matched: paper.tags,
      inferred: paper.inferred,
      identity: paper.identity,
      publicationId: paper.publicationId,
    });
  });

  it("keeps the publication id the identity review needs, and only there", () => {
    expect(identityReviewId(auditItem(paper))).toBe(paper.publicationId);
    expect(identityReviewId(auditItem(award))).toBeNull();
  });

  it("normalises an absent meta to null rather than an empty line", () => {
    expect(auditItem({ ...award, sub: "" }).meta).toBeNull();
  });
});

describe("auditItemGroups", () => {
  const groups: EvidenceGroup[] = [
    { key: "research", title: "Research alignment", meta: "topic 0.74 over 4 items", items: [paper], empty: "No verified publications on file." },
    { key: "funding", title: "Funding history", meta: "", items: [], empty: "No NIH award on record." },
  ];

  it("keeps every group, its heading, its meta and its empty line", () => {
    const out = auditItemGroups(groups);
    expect(out.map((g) => g.key)).toEqual(["research", "funding"]);
    expect(out[0]!.title).toBe("Research alignment");
    expect(out[0]!.meta).toBe("topic 0.74 over 4 items");
    expect(out[1]!.meta).toBeNull();
    expect(out[1]!.items).toEqual([]);
    expect(out[1]!.empty).toBe("No NIH award on record.");
  });

  it("maps every item in every group", () => {
    expect(auditItemGroups(groups)[0]!.items).toEqual([auditItem(paper)]);
  });
});

describe("suggestionChecks", () => {
  const s: { flags: SuggestionFlag[]; freshLine: string; freshWarn: boolean; historyLine: string | null } = {
    flags: [
      { kind: "identity", text: "Identity unverified: name-only match" },
      { kind: "stale", text: "Profile last refreshed 14 months ago" },
    ],
    freshLine: "Sources refreshed Aug 2026",
    freshWarn: true,
    historyLine: "Contacted twice this year",
  };

  it("lists the snapshot's own warnings, flags first", () => {
    expect(suggestionChecks(s)).toEqual(["Identity unverified: name-only match", "Profile last refreshed 14 months ago", "Sources refreshed Aug 2026", "Contacted twice this year"]);
  });

  it("drops a freshness line that is not a warning, and an absent history", () => {
    expect(suggestionChecks({ ...s, freshWarn: false, historyLine: null })).toEqual(["Identity unverified: name-only match", "Profile last refreshed 14 months ago"]);
  });

  it("drops blanks and caps the list", () => {
    const many = { ...s, flags: Array.from({ length: 9 }, (_, i): SuggestionFlag => ({ kind: "limited", text: i === 0 ? "   " : `flag ${i}` })) };
    expect(suggestionChecks(many)).toHaveLength(MAX_CHECKS);
    expect(suggestionChecks(many).some((t) => !t.trim())).toBe(false);
  });

  it("has one definition, used by both the row and the audit view", () => {
    // Two copies of this list is how the row's disclosure and the audit view
    // come to disagree about what is worth checking before you contact someone.
    expect(TAB.match(/suggestionChecks\(/g) ?? []).toHaveLength(2);
    expect(TAB).not.toMatch(/s\.flags\.map\(\(f\) => f\.text\), \.\.\.\(s\.freshWarn/);
  });
});

describe("the workspace's call site", () => {
  it("hands the audit view the snapshot's own groups", () => {
    expect(TAB).toContain("items={auditItemGroups(evidence.groups)}");
  });

  it("passes the audit content the loader built, and null under the legacy engine", () => {
    expect(TAB).toContain("fit={evidence.fit ? { verdicts: evidence.fit.verdicts, panel: evidence.fit.disclosure, audit: evidence.fit.audit } : null}");
  });

  it("wires the identity handler, so the control it gates is not inert", () => {
    expect(TAB).toContain("onNotThisPerson={notThisPerson}");
    expect(TAB).toContain("reviewIdentityAction({");
  });

  it("keeps this surface's own words on the flag control", () => {
    // PR 3's 3b rule: the label is paired with the handler, so no surface
    // inherits words written for another mechanism.
    expect(TAB).toContain("onFlag={fit ? () => setWrongTypeFor(evidence) : undefined}");
    expect(TAB).toContain("flagLabel={fit ? WRONG_TYPE_LABEL : undefined}");
    expect(TAB).toContain('const WRONG_TYPE_LABEL = "Wrong type of research…"');
  });

  it("keeps the dismissal affordances the view has always had", () => {
    for (const verb of ["Add to recipients", "Dismiss", "Wrong person", "Restore"]) {
      expect(TAB, `the audit view lost "${verb}"`).toContain(`>${verb}</Button>`);
    }
  });

  it("dates the provenance strip from the stored snapshot", () => {
    expect(TAB).toContain("provenance={snapshotLine(evidence.snapshotAt)}");
  });

  it("links the admin inspector only for an admin viewer", () => {
    expect(TAB).toContain('inspectorHref={viewer.isAdmin ? inspectorHref("person", evidence.investigatorId) : null}');
  });

  it("returns to the list without unmounting it", () => {
    // `onEvidence(null)` flips one flag in the tab's own state; every other
    // piece of it — `checked`, `openRow`, `showDismissed`, `showExcluded` — is
    // still mounted, which is what makes "back restores the list" true.
    expect(TAB).toContain("onBack={() => onEvidence(null)}");
    expect(TAB).toContain('backLabel="← Back to the recipients"');
  });
});
