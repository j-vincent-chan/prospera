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
    { key: "research", title: "Research alignment", meta: "4 compatible items carried the topic score", items: [paper], empty: "No verified publications on file." },
    { key: "funding", title: "Funding history", meta: "", items: [], empty: "No NIH award on record.", action: { kind: "add_profile_id", label: "Add profile ID" } },
  ];

  it("keeps every group, its heading, its meta and its empty line", () => {
    const out = auditItemGroups(groups);
    expect(out.map((g) => g.key)).toEqual(["research", "funding"]);
    expect(out[0]!.title).toBe("Research alignment");
    expect(out[0]!.meta).toBe("4 compatible items carried the topic score");
    expect(out[1]!.meta).toBeNull();
    expect(out[1]!.items).toEqual([]);
    expect(out[1]!.empty).toBe("No NIH award on record.");
  });

  it("maps every item in every group", () => {
    expect(auditItemGroups(groups)[0]!.items).toEqual([auditItem(paper)]);
  });

  // -------------------------------------------------------------------------
  // B7 — the audit view's section 7 sits **above** the collapsed internals
  // block, and `suggestion-snapshot.ts` used to write `topic 74%` into a
  // group's meta and `track record 70%` into an item's `inferred`. The writer
  // no longer composes them that way; this is what covers the snapshots
  // already stored with the old text, which cannot be migrated without a
  // backfill.
  // -------------------------------------------------------------------------

  it("de-numbers a stored group meta rather than rendering a component value above the internals block", () => {
    const stored: EvidenceGroup[] = [{ key: "research", title: "Research alignment", meta: "Fit engine \u00b7 topic 74% over 4 compatible items", items: [], empty: "none" }];
    expect(auditItemGroups(stored)[0]!.meta).toBe("Fit engine");
  });

  it("and drops a stored `inferred` line the rewrites cannot make safe, rather than half-stripping it", () => {
    // "where a clause cannot be made safe, drop the clause rather than
    // shipping it half-stripped". `track record 70%` is not a shape the
    // rewrites can turn into a claim, and truncating at the arrow would risk
    // changing what the remaining half says. Only snapshots stored before the
    // writer changed lose the line; new ones read "counted in the track
    // record".
    const withValue = { ...award, inferred: "Holds an active R01 as PI \u2192 track record 70%." };
    expect(auditItem(withValue).inferred).toBeNull();
    const written = { ...award, inferred: "Holds an active R01 as PI \u2192 counted in the track record." };
    expect(auditItem(written).inferred).toBe("Holds an active R01 as PI \u2192 counted in the track record.");
  });

  it("but never a quote or a title — those are the source's own words (\u00a73 Kept)", () => {
    const quoted = { ...paper, heading: "IL-6 blockade at 0.5 mg/kg", quote: "the cohort reported a hazard ratio of 0.62" };
    const out = auditItem(quoted);
    expect(out.title).toBe("IL-6 blockade at 0.5 mg/kg");
    expect(out.quote).toBe("the cohort reported a hazard ratio of 0.62");
  });

  // -------------------------------------------------------------------------
  // B8 — the control an empty group offers
  // -------------------------------------------------------------------------

  it("carries an empty group's action through to the view, with the destination the caller supplies", () => {
    const out = auditItemGroups(groups, { profileHref: "/investigators/abc" });
    expect(out[1]!.action).toEqual({ kind: "add_profile_id", label: "Add profile ID", href: "/investigators/abc" });
    // "Add profile ID", "Request biosketch" and "Send reminder" were the only
    // in-context prompts to fix the two most common data gaps, and the mapping
    // dropped all three.
    expect(out[0]!.action).toBeNull();
  });

  it("and draws no action without a destination: a control is drawn only with its mechanism", () => {
    expect(auditItemGroups(groups)[1]!.action).toBeNull();
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

  // fit-UX PR 5's sweep: `suggestion-snapshot.ts` appends the tier the cap
  // imposed — in the **legacy** vocabulary — to each of these flags, and the
  // redesigned row draws them three lines under a pill that says "Moderate
  // match" and a caveat that already names the binding cap in the redesign's
  // own words.
  const capped: { flags: SuggestionFlag[]; freshLine: string; freshWarn: boolean; historyLine: string | null } = {
    flags: [
      { kind: "eligibility", text: "Eligibility unclear: rank not on file. Capped at Potential match until confirmed." },
      { kind: "limited", text: "Limited data: the fit profile is low-confidence or still partly unclassified. Capped at Potential match." },
      { kind: "limited", text: "Runway is short for an application at this scale. Capped at Potential match." },
    ],
    freshLine: "",
    freshWarn: false,
    historyLine: null,
  };

  it("with verdicts beside them, the cap clause comes off and the observation stays", () => {
    expect(suggestionChecks(capped, { verdicts: true })).toEqual([
      "Eligibility unclear: rank not on file.",
      "Limited data: the fit profile is low-confidence or still partly unclassified.",
      "Runway is short for an application at this scale.",
    ]);
    for (const t of suggestionChecks(capped, { verdicts: true })) {
      expect(t).not.toMatch(/Capped at/);
      // The legacy pill's word, on a surface whose pill says "Moderate match".
      expect(t).not.toMatch(/Potential match/);
    }
  });

  it("the legacy path keeps the sentence whole — it has no verdict to say it instead (D-a)", () => {
    expect(suggestionChecks(capped)).toEqual(capped.flags.map((f) => f.text));
    expect(suggestionChecks(capped, { verdicts: false })).toEqual(capped.flags.map((f) => f.text));
  });

  it("a flag that is only a cap clause leaves no empty bullet", () => {
    const only = { ...capped, flags: [{ kind: "limited", text: "Capped at Potential match." } as SuggestionFlag] };
    expect(suggestionChecks(only, { verdicts: true })).toEqual([]);
  });

  it("has one definition, used by both the row and the audit view", () => {
    // Two copies of this list is how the row's disclosure and the audit view
    // come to disagree about what is worth checking before you contact someone.
    expect(TAB.match(/suggestionChecks\(/g) ?? []).toHaveLength(2);
    // …and both ask for the de-capped form exactly when there are verdicts to
    // say it instead: the row is always fit-v1, the audit view is either.
    expect(TAB).toContain("suggestionChecks(s, { verdicts: true })");
    expect(TAB).toContain("suggestionChecks(evidence, { verdicts: Boolean(evidence.fit) })");
    expect(TAB).not.toMatch(/s\.flags\.map\(\(f\) => f\.text\), \.\.\.\(s\.freshWarn/);
  });
});

describe("the workspace's call site", () => {
  it("hands the audit view the snapshot's own groups", () => {
    expect(TAB).toContain("items={auditItemGroups(evidence.groups, { profileHref: `/investigators/${evidence.investigatorId}` })}");
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
