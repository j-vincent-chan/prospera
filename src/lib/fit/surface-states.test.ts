/**
 * §3i's four states (fit-UX PR 5): which one a surface is in, and what each
 * says. The copy is asserted where it carries a claim — the counts, the bar
 * the audience actually sees, the word "changed" rather than "reissued" — and
 * the selection logic is asserted over the cases that decide a wrong sentence:
 * a read that did not land, a profile that does not exist, a directory that is
 * half profiled, a timestamp that is not a day.
 *
 * The invariants at the bottom hold over **every** state the module can build,
 * not over the four someone thought of: at most one primary action, no action
 * without a mechanism, no engine number anywhere, and `nothing_clears` never
 * opening on a negation.
 */
import { describe, expect, it } from "vitest";
import {
  DIRECTORY_MISSING_HREF,
  dayOf,
  directoryIsThin,
  directoryThinState,
  demoted,
  EMPTY_DIRECTORY_COVERAGE,
  investigatorSurfaceState,
  noProfileState,
  noticeChangedAfter,
  noticeChangedBanner,
  noticeSurfaceState,
  nothingClearsState,
  NOTHING_CLEARS_HEADLINE,
  PROFILE_SOURCES_HREF,
  workspaceStaleBanner,
  type DirectoryCoverage,
  type FitState,
} from "@/lib/fit/surface-states";

const coverage = (over: Partial<DirectoryCoverage> = {}): DirectoryCoverage => ({ directory: 129, profiled: 18, available: true, error: null, ...over });
const TODAY = "2026-09-07";

// ---------------------------------------------------------------------------
// dayOf
// ---------------------------------------------------------------------------

describe("dayOf", () => {
  it("takes the calendar day out of a timestamptz and refuses anything else", () => {
    expect(dayOf("2026-09-05T12:34:56.789+00:00")).toBe("2026-09-05");
    expect(dayOf("2026-09-05")).toBe("2026-09-05");
    // `receipt-cycles.fmtMonD` appends `T00:00:00Z`, so a value it cannot parse
    // renders "Invalid Date" in the banner rather than failing anywhere.
    expect(dayOf("not a date")).toBeNull();
    expect(dayOf("")).toBeNull();
    expect(dayOf(null)).toBeNull();
    expect(dayOf(undefined)).toBeNull();
    expect(dayOf(12 as unknown as string)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 1 — no profile built
// ---------------------------------------------------------------------------

describe("no profile built (§3i.1)", () => {
  it("names the three sources the build reads, and says refreshing queues it", () => {
    const s = noProfileState("strategist");
    expect(s.id).toBe("no_profile");
    expect(s.when).toBe("Profile not built yet");
    expect(s.headline).toBe("No assessment yet for this investigator");
    expect(s.body).toMatch(/PubMed, RePORTER and the biosketch/);
    expect(s.body).toMatch(/Refreshing this investigator's sources queues the build/);
  });

  it("the strategist gets Refresh sources and the panel that answers 'what goes into a profile'", () => {
    const s = noProfileState("strategist");
    expect(s.actions.map((a) => [a.id, a.label, a.kind, a.href ?? null])).toEqual([
      ["refresh_sources", "Refresh sources", "primary", null],
      ["what_goes_into_a_profile", "What goes into a profile", "quiet", PROFILE_SOURCES_HREF],
    ]);
  });

  it("§3h: the PI's own page is addressed to them and offers no strategist tooling", () => {
    const s = noProfileState("investigator");
    expect(s.headline).toBe("No assessment yet for your profile");
    expect(s.body).toMatch(/Your strategist can refresh your sources/);
    // `refreshSourcesAction` is behind `requireTeamRole("member")`; a button
    // that 403s is the "button that goes nowhere" §3h refuses.
    expect(s.actions).toEqual([]);
    expect(s.body).not.toMatch(/this investigator/);
  });
});

// ---------------------------------------------------------------------------
// 2 — nothing clears the bar
// ---------------------------------------------------------------------------

describe("nothing clears the bar (§3i.2)", () => {
  it("is written as an answer: the headline leads with it and the body says so in as many words", () => {
    const s = nothingClearsState({ audience: "strategist", corpus: 1190, nearest: 12 });
    expect(s.headline).toBe(NOTHING_CLEARS_HEADLINE);
    expect(s.headline).toBe("Nothing open is worth your attention right now");
    expect(s.body).toMatch(/This is a real answer, not a gap/);
    expect(s.body).toMatch(/refreshes nightly and new notices arrive most weeks/);
    // Not a gap, and not written as one: no "no", "not" or "yet" opening it.
    expect(s.headline).not.toMatch(/^(No|Not|None|Nothing found|Nothing yet)\b/);
  });

  it("the corpus is the real count, formatted, and singular when it is one", () => {
    expect(nothingClearsState({ audience: "strategist", corpus: 1190, nearest: 0 }).body).toMatch(/^1,190 open notices were assessed against this profile/);
    expect(nothingClearsState({ audience: "strategist", corpus: 1, nearest: 0 }).body).toMatch(/^1 open notice was assessed/);
    expect(nothingClearsState({ audience: "strategist", corpus: 0, nearest: 0 }).body).toMatch(/^0 open notices were assessed/);
  });

  it("names the bar the audience actually sees: Exploratory for a strategist, Moderate on the PI's own page (§3h)", () => {
    expect(nothingClearsState({ audience: "strategist", corpus: 5, nearest: 0 }).body).toMatch(/none reached Exploratory or better/);
    const pi = nothingClearsState({ audience: "investigator", corpus: 5, nearest: 0 });
    expect(pi.body).toMatch(/none reached Moderate or better/);
    expect(pi.body).toMatch(/against your profile/);
    // `listsLabel` never draws an Exploratory row on that page, so claiming
    // nothing reached Exploratory would be a claim about a list it cannot see.
    expect(pi.body).not.toMatch(/Exploratory/);
  });

  it("offers the nearest rows only when the caller has some, and offers exactly as many as it has", () => {
    expect(nothingClearsState({ audience: "strategist", corpus: 9, nearest: 12 }).actions).toEqual([
      { id: "show_nearest", label: "Show the 12 nearest, and why they fell short", kind: "secondary" },
    ]);
    expect(nothingClearsState({ audience: "strategist", corpus: 9, nearest: 0 }).actions).toEqual([]);
    // D7: a PI's loader reads no ruled-out rows, so `nearest` is 0 there.
    expect(nothingClearsState({ audience: "investigator", corpus: 9, nearest: 0 }).actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3 — the notice changed after the assessment
// ---------------------------------------------------------------------------

describe("the notice changed after the assessment (§3i.3)", () => {
  it("is a comparison of two days, and a missing one is not staleness", () => {
    expect(noticeChangedAfter({ updatedAt: "2026-09-05T10:00:00Z", assessedAt: "2026-09-01T10:00:00Z" })).toBe(true);
    expect(noticeChangedAfter({ updatedAt: "2026-09-01T10:00:00Z", assessedAt: "2026-09-05T10:00:00Z" })).toBe(false);
    // Same day: the sweep runs nightly and a notice synced the same day is not
    // evidence the caveats were written against older text.
    expect(noticeChangedAfter({ updatedAt: "2026-09-05T23:00:00Z", assessedAt: "2026-09-05T01:00:00Z" })).toBe(false);
    // A surface that did not read the assessment time makes no claim — which
    // is what `mode: "summary"` does (it selects no `computed_at`).
    expect(noticeChangedAfter({ updatedAt: "2026-09-05T10:00:00Z", assessedAt: null })).toBe(false);
    expect(noticeChangedAfter({ updatedAt: null, assessedAt: "2026-09-01T10:00:00Z" })).toBe(false);
    expect(noticeChangedAfter({ updatedAt: "nonsense", assessedAt: "2026-09-01" })).toBe(false);
  });

  it("says 'changed', with the date, and counts what is under it", () => {
    const b = noticeChangedBanner({ changedAt: "2026-09-05T12:00:00Z", shown: 3, reassess: true, today: TODAY })!;
    expect(b.text).toBe("The notice changed on Sep 5, after these were assessed. Eligibility and required designs may have changed.");
    expect(b.note).toBe("3 suggestions, assessed against the previous version");
    expect(b.action).toEqual({ id: "reassess", label: "Reassess", kind: "secondary" });
    // `reissue_of` is a lineage pointer with no date on it, so nothing in the
    // data says a reissue happened on a day; `updated_at` says the text moved.
    expect(b.text).not.toMatch(/reissued/);
  });

  it("one suggestion is singular; none has no note at all", () => {
    expect(noticeChangedBanner({ changedAt: "2026-09-05", shown: 1, reassess: false, today: TODAY })!.note).toBe("1 suggestion, assessed against the previous version");
    expect(noticeChangedBanner({ changedAt: "2026-09-05", shown: 0, reassess: false, today: TODAY })!.note).toBeNull();
  });

  it("a date it cannot read is dropped rather than rendered, and the sentence still stands", () => {
    const b = noticeChangedBanner({ changedAt: null, shown: 2, reassess: false, today: TODAY })!;
    expect(b.text).toBe("The notice changed, after these were assessed. Eligibility and required designs may have changed.");
    expect(b.text).not.toMatch(/Invalid Date|null|undefined/);
  });

  it("Reassess is drawn only where the surface has a mechanism that re-assesses this list", () => {
    // The workspace: `regenerateSuggestionsAction` re-ranks exactly these rows.
    expect(noticeChangedBanner({ changedAt: "2026-09-05", shown: 3, reassess: true, today: TODAY })!.action).not.toBeNull();
    // The opportunity aside: the rows come from the nightly sweep, which
    // nothing on that page can re-run.
    expect(noticeChangedBanner({ changedAt: "2026-09-05", shown: 3, reassess: false, today: TODAY })!.action).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4 — the directory is too thin to assess
// ---------------------------------------------------------------------------

describe("the directory is too thin to assess (§3i.4)", () => {
  it("fires when more of the directory is unprofiled than profiled, and not on the boundary", () => {
    expect(directoryIsThin(coverage({ directory: 129, profiled: 18 }))).toBe(true);
    expect(directoryIsThin(coverage({ directory: 100, profiled: 49 }))).toBe(true);
    // Exactly half is not a minority.
    expect(directoryIsThin(coverage({ directory: 100, profiled: 50 }))).toBe(false);
    expect(directoryIsThin(coverage({ directory: 100, profiled: 51 }))).toBe(false);
    expect(directoryIsThin(coverage({ directory: 129, profiled: 129 }))).toBe(false);
    expect(directoryIsThin(coverage({ directory: 1, profiled: 1 }))).toBe(false);
  });

  it("makes no claim from a read that did not land, or from an empty directory", () => {
    expect(directoryIsThin(coverage({ available: false }))).toBe(false);
    expect(directoryIsThin(coverage({ error: "directory coverage: timeout" }))).toBe(false);
    expect(directoryIsThin(EMPTY_DIRECTORY_COVERAGE)).toBe(false);
    expect(directoryIsThin(coverage({ directory: 0, profiled: 0 }))).toBe(false);
    // An empty directory is a directory with nothing in it, not a thin one.
    expect(directoryIsThin(coverage({ directory: 0, profiled: 5 }))).toBe(false);
  });

  it("states both real counts and says why a list of them would mislead", () => {
    const s = directoryThinState({ coverage: coverage({ directory: 1290, profiled: 18 }), shown: 3 });
    expect(s.id).toBe("directory_thin");
    expect(s.when).toBe("Directory too thin to assess");
    expect(s.headline).toBe("Not enough of your directory is profiled to answer this");
    expect(s.body).toMatch(/^18 of 1,290 directory profiles have a fit profile built/);
    expect(s.body).toMatch(/A list built from 18 would read as an answer without being one/);
    // The prototype's "the rest are missing a RePORTER profile ID,
    // publications, or both" is a claim per unprofiled person and would need a
    // read per candidate; it is not written.
    expect(s.body).not.toMatch(/RePORTER profile ID/);
  });

  it("the directory link is the query the directory screen already answers; 'show anyway' needs rows to show", () => {
    const withRows = directoryThinState({ coverage: coverage(), shown: 3 });
    expect(withRows.actions.map((a) => [a.id, a.label, a.kind, a.href ?? null])).toEqual([
      ["see_what_is_missing", "See what is missing", "primary", DIRECTORY_MISSING_HREF],
      ["show_anyway", "Show the 3 anyway", "quiet", null],
    ]);
    expect(DIRECTORY_MISSING_HREF).toBe("/investigators?sources=missing_any");
    expect(directoryThinState({ coverage: coverage(), shown: 0 }).actions.map((a) => a.id)).toEqual(["see_what_is_missing"]);
  });
});

// ---------------------------------------------------------------------------
// The selectors
// ---------------------------------------------------------------------------

describe("investigatorSurfaceState", () => {
  const base = { audience: "strategist" as const, profileBuilt: true, listed: 0, corpus: 1190, nearest: 4 };

  it("no profile outranks 'nothing clears the bar' — even with rows, which cannot happen and must not read as an assessment", () => {
    expect(investigatorSurfaceState({ ...base, profileBuilt: false })!.id).toBe("no_profile");
    expect(investigatorSurfaceState({ ...base, profileBuilt: false, listed: 5 })!.id).toBe("no_profile");
  });

  it("a populated list is no state at all", () => {
    expect(investigatorSurfaceState({ ...base, listed: 1 })).toBeNull();
    expect(investigatorSurfaceState({ ...base, listed: 50 })).toBeNull();
  });

  it("a built profile with nothing listed is the answer, carrying the corpus and the nearest count", () => {
    const s = investigatorSurfaceState(base)!;
    expect(s.id).toBe("nothing_clears");
    expect(s.body).toMatch(/1,190 open notices/);
    expect(s.actions[0]!.label).toBe("Show the 4 nearest, and why they fell short");
  });
});

describe("workspaceStaleBanner", () => {
  it("fires on the tab's own signal and gives the workspace the Reassess it has", () => {
    const b = workspaceStaleBanner({ noticeChangedSince: true, noticeChangedAt: "2026-09-05T12:00:00Z" }, 4, TODAY)!;
    expect(b.text).toBe("The notice changed on Sep 5, after these were assessed. Eligibility and required designs may have changed.");
    expect(b.note).toBe("4 suggestions, assessed against the previous version");
    // `regenerateSuggestionsAction` re-ranks exactly the list under it.
    expect(b.action).toEqual({ id: "reassess", label: "Reassess", kind: "secondary" });
  });

  it("is nothing at all when the notice has not changed since this item saw it", () => {
    expect(workspaceStaleBanner({ noticeChangedSince: false, noticeChangedAt: "2026-09-05T12:00:00Z" }, 4, TODAY)).toBeNull();
    expect(workspaceStaleBanner({ noticeChangedSince: false, noticeChangedAt: null }, 0, TODAY)).toBeNull();
  });

  it("a date the item does not carry still leaves a sentence that stands", () => {
    const b = workspaceStaleBanner({ noticeChangedSince: true, noticeChangedAt: null }, 2, TODAY)!;
    expect(b.text).toBe("The notice changed, after these were assessed. Eligibility and required designs may have changed.");
  });
});

describe("demoted", () => {
  it("keeps every word and gives up the fill, so a card that already has a primary does not get a second", () => {
    const s = directoryThinState({ coverage: coverage(), shown: 3 });
    const d = demoted(s);
    expect(d.actions.map((a) => a.label)).toEqual(s.actions.map((a) => a.label));
    expect(d.actions.map((a) => a.id)).toEqual(s.actions.map((a) => a.id));
    expect(d.actions.map((a) => a.href ?? null)).toEqual(s.actions.map((a) => a.href ?? null));
    expect(d.actions.map((a) => a.kind)).toEqual(["secondary", "quiet"]);
    expect(d.actions.filter((a) => a.kind === "primary")).toEqual([]);
    // Headline, body and caption are untouched: this is tone, not claim.
    expect({ ...d, actions: [] }).toEqual({ ...s, actions: [] });
  });

  it("is a no-op on a state that never had a primary", () => {
    const s = nothingClearsState({ audience: "strategist", corpus: 9, nearest: 4 });
    expect(demoted(s)).toEqual(s);
    expect(demoted(noProfileState("investigator"))).toEqual(noProfileState("investigator"));
  });
});

describe("noticeSurfaceState", () => {
  it("is the thin-directory state or nothing; the reissue banner is not one of its answers", () => {
    expect(noticeSurfaceState({ coverage: coverage({ directory: 129, profiled: 18 }), shown: 3 })!.id).toBe("directory_thin");
    expect(noticeSurfaceState({ coverage: coverage({ directory: 129, profiled: 100 }), shown: 3 })).toBeNull();
    expect(noticeSurfaceState({ coverage: EMPTY_DIRECTORY_COVERAGE, shown: 3 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invariants over every state the module can build
// ---------------------------------------------------------------------------

describe("every state, generated", () => {
  const all: FitState[] = [];
  for (const audience of ["strategist", "investigator"] as const) {
    all.push(noProfileState(audience));
    for (const corpus of [0, 1, 1190]) for (const nearest of [0, 1, 12]) all.push(nothingClearsState({ audience, corpus, nearest }));
  }
  for (const directory of [0, 1, 129, 1290]) for (const profiled of [0, 1, 18, 129]) for (const shown of [0, 3]) all.push(directoryThinState({ coverage: coverage({ directory, profiled }), shown }));

  it("has at most one primary action", () => {
    for (const s of all) expect(s.actions.filter((a) => a.kind === "primary").length).toBeLessThanOrEqual(1);
  });

  it("gives every action either a destination or an id a surface can switch on, and never an empty label", () => {
    for (const s of all)
      for (const a of s.actions) {
        expect(a.label).toMatch(/\S/);
        expect(a.href ?? a.id).toMatch(/\S/);
      }
  });

  it("puts no engine number on any of them: no score, no component value, no floor", () => {
    for (const s of all) {
      for (const text of [s.headline, s.body, ...s.actions.map((a) => a.label)]) {
        // A component value or a floor is always a decimal; the counts these
        // states carry are whole numbers with thousands separators.
        expect(text).not.toMatch(/\d\.\d/);
        expect(text).not.toMatch(/\bS \d|\bscore\b|\bfloor\b|\bcap(ped)?\b|\bcomponent\b/i);
      }
    }
  });

  it("gives every state a headline, a body and a caption", () => {
    for (const s of all) {
      expect(s.headline).toMatch(/\S/);
      expect(s.body).toMatch(/\S/);
      expect(s.when).toMatch(/\S/);
      // §3b's rule for a row, applied to a card: one thought per line, not a
      // paragraph of model explanation (§2.2).
      expect(s.body.length).toBeLessThan(340);
    }
  });
});
