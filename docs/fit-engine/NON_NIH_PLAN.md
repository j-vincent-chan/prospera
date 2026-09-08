# Fit beyond NIH — implementation plan (Phase 5)

Companion to `docs/fit-engine/NON_NIH_FEASIBILITY.md` (the scope) and continuation of `docs/fit-engine/IMPLEMENTATION_PLAN.md` (Phases 0–4). Same working agreement: one PR per item, in order, each with acceptance criteria and a paste-ready kickoff prompt.

**Ground rules** (unchanged, from `/CLAUDE.md`): scoring code is pure; thresholds live in `src/lib/fit/taxonomy.json`; migrations are written, never applied by scripts; backfills are idempotent and resumable; every PR runs `npm test` and `npx tsc --noEmit`; the adversarial fixtures stay green. **Stop and ask when a step depends on an OPEN item in `DECISIONS.md`** — this phase opens D61–D68, and PR 5.6 is blocked on D62 and D67 by design.

**Human checkpoints:** after PR 5.0 (the attachment hit-rate and the relevance breakdown are what the rest of the plan is sized against); after PR 5.3 (read 20 extracted non-NIH `objectives` sections yourself); before PR 5.6 sets `teams.fit_corpus = 'all'` for any team.

**Framing for every PR here:** *the engine is already source-agnostic; what is NIH-specific is text acquisition and section routing.* No PR may change a gate, a floor or a matrix except 5.6, which adds one cap and one retrieval predicate.

---

## The NIH invariant

**The constraint, stated exactly.** For any team whose `fit_corpus` is `'nih'`, every NIH notice's parsed sections, built profile, extraction cache keys, `fit_results` rows (tier, score, caps, components, provenance) and rendered rationale must be **identical** to what `main` produces before Phase 5 begins — for the whole phase, not only at the end. Nothing here is a "small acceptable drift".

This is not achieved by care. It is achieved by four structural properties plus one harness, and every PR is checked against the harness.

**1 · Additive, opt-in corpus.** `teams.fit_corpus` defaults to `'nih'` and nothing else is scored until a person changes it (PR 5.6). Non-NIH notices may acquire profiles at any point in the phase without entering any team's scoring.

**2 · The thin-profile cap keys on values that do not exist today.** The `thin_notice_profile` cap fires on `sources.text ∈ {synopsis, landing_page, full_text_thin}`. No stored profile has any of those values, because `loadCandidates` requires `guide_sections` — so the cap is dead code for every existing row by construction. **It must never be keyed on empty requirement maps**, which would demote ~76% of the NIH corpus (D24(2)).

**3 · IDF is corpus-keyed, not corpus-wide.** This is the one place NIH scores can move with no NIH input changing. `fit_topic_idf` gains a `corpus TEXT NOT NULL DEFAULT 'nih'` column with PK `(corpus, code)`; the `'nih'` rows are computed over exactly today's population, and a team scoring `'nih'` reads only those. Widening the corpus then cannot touch an NIH pair's T. This supersedes D63's "restrict to notices carrying ≥ 1 code" option — corpus-keying is an exact guarantee where that was a mitigation.

**4 · The extraction cache key is frozen.** `fit_notice_extractions` is keyed by `contentHash(taxonomy_version + system prompt + user prompt)`. Any change to `sectionLabel()`, to group membership, to the header lines or to `EXTRACTOR_SYSTEM_PROMPT` changes that key, which silently re-extracts every NIH notice with a strong model and produces a *new* profile. PR 5.1 is the danger. **The rendered prompt string for every NIH fixture must be byte-identical**, and that is a test, not a review note.

### The harness (PR 5.0a)

`npm run fit:nih-invariant` — `--capture` writes a baseline, `--verify` recomputes and diffs, exiting non-zero on any difference.

Captured per open NIH notice: `guide_sections` hash, `clinical_trial_designation`, `program_division`, `activity_code`, the three rendered extractor prompts and their cache keys, and the built profile JSON (canonicalised, hashed). Captured per pilot investigator × notice pair: `tier`, `score` to 6 dp, `caps`, `components`, `provenance` and `rationale`.

**Every PR in this phase adds one acceptance line: `npm run fit:nih-invariant -- --verify` green.** A PR that cannot keep it green is wrong, not "close enough" — stop and bring the diff to a person.

### What this costs

The invariant forbids improvements to NIH handling that this phase would otherwise make for free — better judge section selection from roles, a re-tuned IDF, a designation parser generalised across sources. Those are deferred, not lost: once Phase 5 is measured, re-baselining is a deliberate one-line decision (recapture the harness) rather than something that happened by accident.

---

## Phase 5 — Widen the aperture

### PR 5.0 · Non-NIH inventory (read-only, no behaviour change)

**Goal.** Replace every estimate in the feasibility doc with a measurement. Nothing downstream is sized correctly until this runs.

**Files.** `scripts/fit-non-nih-inventory.ts`; output written to a **new** `docs/fit-engine/NON_NIH_INVENTORY.md`; `package.json` alias `fit:non-nih-inventory`.

> Do **not** append to `INVENTORY.md`: § 12 is already taken (`## 12. RePORTER RCDC values seen (PR 0.4, D9)`) and `scripts/fit-inventory.ts:431` rewrites that file wholesale with `writeFileSync`, so a second writer's section would be destroyed on the next `npm run fit:inventory`.

**What it must answer.**

1. Open notices by `agency_code`, by `agency`, and by assistance listing / `category`, cross-tabulated with `forecasted` and with whether an `opportunity_fit_profiles` row exists. Reconcile the totals against `GUIDE_DIAGNOSTICS.md` § 1e (expect ≈ 538 posted non-NIH, 111 non-NIH forecasts).
2. **The attachment hit-rate.** For every open, posted, non-NIH row: call Simpler `getOpportunity(source_opportunity_id)` and report rows with ≥ 1 `attachments[]` entry, the mime-type mix, file-name patterns and median size. Then, for a 50-row sample, resolve the legacy Grants.gov id with `searchGrantsGovOpportunityId(opportunity_number)` and call `fetchOpportunity` — report whether `synopsisAttachments` agrees with Simpler's `attachments`. *(Superseded by the run: `raw_payload_json.legacy_opportunity_id` is stored on 536/536 posted non-NIH rows, so no `search2` lookup is needed, and the two routes return the same files.)*
3. `description` length distribution per family, and the **share of rows with a non-empty description** (the synopsis fallback's real coverage — a median over the whole corpus is not a coverage statistic).
4. NSF: does `opportunity_number` normalise to `nsf{YY}{NNN}` for the 91 rows, and does a HEAD to `https://nsf-gov-resources.nsf.gov/solicitations/pubs/{20YY}/nsf{YYNNN}/nsf{YYNNN}.pdf` return 200? Report the rate.
5. CDMRP: does `opportunity_number` match the FON shape for the 81 DOD-AMRAA rows, and does `https://cdmrp.health.mil/funding/pa/{FON}_GG.pdf` return 200? Report the distribution of mechanism suffixes (`CTA`, `IIRA`, `IDA`, `CDA`, …) — PR 5.8 needs it.
6. **RePORTER coverage of the HHS siblings.** For open notices numbered `RFA-HS-`, `RFA-CE-`, `RFA-DP-`, `RFA-OH-`, `RFA-IP-`, call the existing exemplar search with `criteria.opportunity_numbers` and report how many return ≥ 5 projects.
7. **Admission, not exclusion (D67).** Do **not** propose an agency or subject allow-list — Prospera serves multiple communities off one shared notice table, so a USDA nutrition or DOT injury notice is a real lead for a global-health investigator and noise for an immunologist, and the same row is both. Instead report: (a) the distribution of `applicant_types` and `funding_instrument` across the non-NIH set, and how many rows exclude institutions of higher education or non-profits, or are direct payments / procurement / formula grants rather than research grants — candidates for **stage-1 eligibility**, not for a corpus filter; and (b) an agency × assistance-listing table with three example titles each, as descriptive context only, explicitly labelled “not a proposed filter”.
8. `fit_topic_idf` today: row count, `n`, and the 20 highest-`df` codes — the "before" half of D63's baseline.
9. Grep for importers of `src/lib/funding-opportunities/grants-gov-opportunity-api.ts` across the **whole** repo (including `src/app` and `src/components`) and report them; the plan assumes it is reusable, not that it is dead.

**Acceptance.** `NON_NIH_INVENTORY.md` answers all nine; the script writes nothing to Supabase; `--dry-run` prints the request plan without network; every host is rate-limited at ≥ 700 ms through `AsyncRateLimiter`. Exit 2 on any predicate that cannot be evaluated.

**Checkpoint.** A person reads it and answers D61 and D67 before PR 5.1.

> **Kickoff prompt.** Read `/CLAUDE.md`, then `docs/fit-engine/NON_NIH_FEASIBILITY.md` and `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.0. Before writing code, summarise what already exists for each of the nine questions — in particular read `src/lib/funding-opportunities/grants-gov-opportunity-api.ts`, `src/lib/ingestion/simpler-grants/client.ts` and `src/lib/ingestion/reporter/exemplars.ts`. Then write `scripts/fit-non-nih-inventory.ts` following the pattern of `scripts/fit-inventory.ts` (dotenv, service-role client, read-only), writing to a **new** `docs/fit-engine/NON_NIH_INVENTORY.md` — do not append to `INVENTORY.md`, which `fit-inventory.ts` regenerates wholesale. Note that `source_opportunity_id` is Simpler's UUID and the legacy Grants.gov API needs a numeric id you must resolve first. Run with `--limit 50`, paste the output, and stop for me to read before the full run.

---

### PR 5.0a · NIH invariant harness (read-only, no behaviour change)

**Goal.** Make "nothing changes for NIH" checkable in one command, before any Phase 5 code exists. Everything after this depends on it.

**Files.** `scripts/fit-nih-invariant.ts`; baseline under `docs/fit-engine/nih-baseline/` (committed: `notices.json`, `prompts.json`, `profiles.json`, `results.json` — hashes and small canonical records, not full text); `package.json` alias `fit:nih-invariant`.

**Code.**
- `--capture` on a clean checkout of `main`: for every open NIH notice, record `opportunity_number`, `sha256(guide_sections canonicalised)`, `clinical_trial_designation`, `program_division`, `activity_code`, and for each of the three extractor groups the **rendered prompt string's hash** and the `extractionCacheKey` it produces. Then the stored `opportunity_fit_profiles.profile` canonicalised and hashed. Then, for the pilot team's roster, every `fit_results` row as `{tier, score.toFixed(6), caps, components, provenance, rationale}`.
- `--verify`: recompute all of it from the current checkout and database, diff against the baseline, print the first 20 differences with the notice number and the field path, exit 2 if any.
- `--verify --offline`: the pure half only — prompt rendering, cache keys and `scorePair` over the stored profiles — so the harness runs in CI without database credentials. This is the mode every PR must keep green.
- Canonicalisation must be stable: sorted object keys, no `computed_at`, no timestamps, floats fixed to 6 dp.

**Acceptance.** `--capture` then `--verify` on the same commit is green. `--verify` on a commit with a deliberately altered `sectionLabel()` fails and names the affected notices — demonstrate that, then revert it. The baseline is committed and its size is under a megabyte.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_PLAN.md` § "The NIH invariant" and § PR 5.0a. The constraint for this whole phase is that nothing about NIH notices changes, and this PR is what makes that checkable. Write `scripts/fit-nih-invariant.ts` with `--capture`, `--verify` and `--verify --offline`. It must be read-only against Supabase. The offline mode matters most: prompt rendering, `extractionCacheKey` and `scorePair` over stored profiles, no credentials needed, so CI can run it on every PR. Prove it works by temporarily changing `sectionLabel()` and showing the failure output, then reverting. Capture the baseline from `main` and commit it.

### PR 5.1 · Section roles (pure refactor, no behaviour change)

**Goal.** Route extractor groups on canonical roles rather than NIH roman numerals, so a non-NIH sectioner can produce something the extractor understands. Nothing about NIH output may change.

**Schema.** Migration `<ts>_fit_section_roles.sql`: update the `funding_opportunities.guide_sections` COMMENT to document the added `roles` key. No column change — roles ride inside the existing JSONB objects.

**Code.**
- `src/lib/fit/profile/section-roles.ts` (new): `SectionRole = "purpose" | "objectives" | "non_responsive" | "award_info" | "eligibility" | "human_subjects" | "review" | "contacts" | "team" | "synopsis" | "other"`; `rolesForNihSection(section, heading): SectionRole[]` implementing NON_NIH_FEASIBILITY § 6; `withRoles(sections)` filling `roles` on legacy rows at read time so no backfill is needed.
- **`roles` is a list, not a scalar.** `groupSections` is not a partition: `opportunity-extract.ts:126–130` pushes a Section I section matching `TEAM_HEADING` into group 1 (or 2 when non-responsive) **and** group 3. A scalar role changes group 1's text and therefore the `fit_notice_extractions` cache key. `rolesForNihSection` must return e.g. `["objectives","team"]`.
- `src/lib/fit/profile/opportunity-extract.ts`: `NoticeSection` gains `roles?: SectionRole[]`; `groupSections()` routes on roles (1 = `purpose`, `objectives`, `synopsis`; 2 = `non_responsive`, `award_info`, `human_subjects`; 3 = `eligibility`, `contacts`, `team`), deriving via `withRoles()` when absent.
- `src/lib/ingestion/nih-guide/parse.ts`: **`parseGuideSections` emits `GuideSection` (`parse.ts:53`), not `NoticeSection` (`opportunity-extract.ts:74`)** — add `roles` to both types, or make one extend the other. It stamps roles; its detection logic is untouched.
- `src/lib/fit/judge/inputs.ts`: `noticeTexts()` selects by role where role is sufficient. It also discriminates on `ELIGIBILITY_HEADING`, `NON_RESPONSIVE_HEADING` and `TEAM_HEADING`, and prefers `section === "III.3"` over the broader `startsWith("III")` (`:188–191`) — keep those heading tests and the III.3 preference; roles are an addition, not a replacement.
- `sectionLabel()` keeps its NIH rendering when `part`/`section` are NIH-shaped and gains a role-based rendering otherwise.

**Acceptance.** `npm run fit:nih-invariant -- --verify --offline` green — for this PR that is the whole point: the **rendered extractor prompt string and its `extractionCacheKey` must be byte-identical for every NIH notice**, or every NIH notice silently re-extracts and its profile changes. Then `npm test` green with **no fixture edits**; `opportunity.test.ts`, `judge/*.test.ts` and the notice-extractor fixture outputs byte-identical. A test asserts `groupSections` produces the same three lists for the four stored Guide HTML fixtures whether roles are stamped at parse time or derived at read time — *including* the team cross-cut duplication. `docs/fit-engine/prompts/notice-extractor.md` § Chunking rewritten in terms of roles with the NIH mapping named, and the test pinning `EXTRACTOR_SYSTEM_PROMPT` still passes.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.1 and `docs/fit-engine/NON_NIH_FEASIBILITY.md` § 6. This is a pure refactor: the three lists `groupSections()` produces for every existing fixture must be identical afterwards, and no fixture file may be edited. Two things will bite you: `groupSections` is not a partition (a `TEAM_HEADING` Section I section goes into group 1 *and* group 3, `opportunity-extract.ts:126–130`), so roles must be a list per section; and `parseGuideSections` emits `GuideSection`, a different type from `NoticeSection`. Implement `section-roles.ts`, thread roles through both types, `groupSections` and `judge/inputs.ts`, and add the round-trip test. If any existing test needs a changed expectation, stop and show me the diff instead of changing it.

---

### PR 5.2 · Announcement acquisition framework

**Goal.** One registry mapping a notice to a text source, one fetch/parse/store path that is not NIH-shaped, and the constraints widened to allow it. Only the existing NIH adapter is registered here.

**Schema.** Migration `<ts>_fit_announcement_sources.sql`:
- Widen `funding_opportunities_guide_source_check` to `('grants_nih_gov','simpler_attachment','grants_gov_attachment','nsf_solicitation','cdmrp_pa','landing_page','synopsis')`.
- `funding_opportunities`: add `announcement_kind TEXT` (the adapter id that produced the sections) and `announcement_text_hash TEXT` (SHA-256 of the extracted text, for every source).
- **`opportunity_fit_profiles`: add `announcement_text_hash TEXT` too.** `profileDue()` compares a profile row against a notice row (`profile/opportunity.ts:1358–1366`); a hash on only one side is not comparable. Thread it through `ExistingProfile`, the `loadExistingProfiles` select list (`:1294`), `CandidateNotice`, `OpportunityFitProfileRow` and `upsertProfile`.
- COMMENTs updated to "sectioned announcement text, whatever the source".

**Code.**
- `src/lib/ingestion/announcement/registry.ts`: `funderFamilyOf(row): FunderFamily` from `agency_code` first, `opportunity_number` shape second, `agency` third — an explicit table, not heuristics. Families: `nih`, `hhs_other`, `nsf`, `dod_cdmrp`, `doe`, `other_federal`, `foundation`, `internal`. Note `agency-taxonomy.ts` matches display strings, not `agency_code`, so it is a vocabulary to reuse, not a router.
- `src/lib/ingestion/announcement/types.ts`: `AnnouncementAdapter = { id, applies(row), resolve(row, deps): Promise<AnnouncementTarget[]>, fetch(target), sections(doc): NoticeSection[] }`. Targets are ordered; the first yielding ≥ 1 `objectives`-role section wins.
- `src/lib/ingestion/announcement/text.ts`: `htmlToLines(html)` and `pdfToLines(buffer)`, **both preserving line structure** — `parse.ts:98`'s `\s+ → " "` collapse must not be reused. PDF library per D66.
- `src/lib/ingestion/announcement/sectioner.ts`: `sectionByHeadings(lines, patterns: { roles, test }[]): NoticeSection[]`, plus `singleSection(lines, role)` as the prose fallback.
- `src/lib/ingestion/announcement/adapters/nih-guide.ts`: the existing Guide path moved behind the interface, behaviour unchanged.
- `src/lib/services/announcement-sync.ts`: the generalised sync. **Per-host limiters** — today there are two, `pageLimiter` (700 ms, shared by `grants.nih.gov` *and* `files.simpler.grants.gov`, see the comment at `nih-guide-sync.ts:54`) and `simplerLimiter` (550 ms, `:228`); the shared-page one must become one per host. Reuses `guide_fetch_status`; writes `guide_sections`, `guide_source`, `announcement_kind`, `announcement_text_hash`, `guide_url`, `guide_fetched_at`. `nih-guide-sync.ts` becomes a thin wrapper calling it with the NIH adapter only, so `/api/cron/sync-nih-guide` is unchanged.

**Acceptance.** `npm run fit:nih-invariant -- --verify` green (full mode: the parsed `guide_sections` hash per notice is what this PR could move); `npx tsc --noEmit` clean; every existing `nih-guide-sync` test passes through the new path unchanged; `npm run backfill-nih-guide -- --dry-run --limit 20` produces byte-identical `guide_sections` to `main`, pasted into the PR; the migration applies twice (`IF NOT EXISTS`). No new adapter registered.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.2, and `src/lib/services/nih-guide-sync.ts` and `src/lib/ingestion/nih-guide/*` in full. Build the adapter framework and move the existing NIH Guide path behind it **with no behaviour change** — the acceptance test is `npm run backfill-nih-guide -- --dry-run --limit 20` producing byte-identical `guide_sections` to `main`. Do not add any new adapter. Three traps: `parse.ts:98` collapses all whitespace and must not be reused in the new text path; there are two rate limiters, and the 700 ms one is shared across two hosts; and `announcement_text_hash` must land on **both** `funding_opportunities` and `opportunity_fit_profiles` or `profileDue` cannot compare it. If D66 (PDF library) is still open, stub `pdfToLines` with a thrown `NotImplemented` and say so.

---

### PR 5.3 · Grants.gov attachment adapter + PDF text

**Goal.** The largest single coverage win: full announcement text for CDC, DOE, ACF, IHS, USDOJ, HRSA-once-posted, the CDMRP mirror and the rest of the non-HHS tail.

**Code.**
- `adapters/grants-gov-attachment.ts`: resolve targets in order — (a) `raw_payload_json.attachments[]` when already stored; (b) Simpler `getOpportunity(source_opportunity_id)`; (c) legacy `fetchOpportunity` via the **existing** `funding-opportunities/grants-gov-opportunity-api.ts`, keyed on `raw_payload_json.legacy_opportunity_id` — stored on 536/536 posted non-NIH rows, so **skip `searchGrantsGovOpportunityId()` entirely** — using its own `grantsGovAttachmentUrl` (host `https://www.grants.gov/grantsws/rest/opportunity/att/download/{id}`, `:69–71` — not `apply07`); (d) the package-instructions PDF if the row carries a package number. PR 5.0 § 2b found (b) and (c) return the **same files** (names identical on 49/49 after folding `M&E`→`ME`, `_(1)`→`_1`), so treat them as interchangeable and prefer whichever is cheaper. 
- ⚠ **`grants-gov-opportunity-api.ts` is not dead code** (PR 5.0 § 9): `funding-opportunity-application-materials.ts` imports it and is reached from the opportunity page, `opportunity-peek.tsx` and `funding-opportunity-peek.ts`. Extend it additively; do not change existing exports' behaviour, and keep `funding-opportunity-application-materials.test.ts` green. Rank candidate files: names matching `/(full.?announcement|nofo|foa|program.?announcement|solicitation)/i` first, then the largest PDF, then the only PDF. Reject anything not `application/pdf` or `text/html`, and anything over a size cap.
- Heading tables in `sectioner.ts`: the federal NOFO template (`I. Program Funding Opportunity Description … VIII. Other Information`) and the CDMRP thirteen-block structure (`Before You Begin`, `Basic Information About the Funding Opportunity`, `Eligibility Information`, `Program Description`, `Application Contents and Format`, `Submission Requirements`, `Application Review Information`, `Federal Award Notices`, `Post-Award Requirements`, `Other Information`, `Appendix …`).
- `scripts/fit-backfill-announcements.ts` with alias **`fit:backfill-announcements`**: resumable; `--family`, `--limit`, `--only NUM,…`, `--cursor`, `--dry-run` (prints the resolved target, the recovered role set and the first 400 chars of `objectives` per row, writes nothing), `--write`.

**Acceptance.** Over a 40-row sample across ≥ 4 agencies: an `objectives` section is recovered for ≥ 70% of rows that PR 5.0 measured as having an attachment, with the dry-run output pasted into the PR. Three saved fixtures (one HRSA NOFO, one CDC NOFO, one CDMRP PA) with sectioner unit tests. A row whose extraction fails is never written with partial sections — it stamps `guide_fetch_status = 'error'` and falls through to the synopsis at profile time.

**Checkpoint.** A person reads 20 extracted `objectives` sections before PR 5.4.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.3, `docs/fit-engine/NON_NIH_INVENTORY.md` for the measured attachment rate, and `src/lib/funding-opportunities/grants-gov-opportunity-api.ts` — it already implements `search2`, `fetchOpportunity` and the attachment download URL; reuse it rather than writing a second client, and use its host (`www.grants.gov`), not `apply07`. Build the adapter, the federal-NOFO and CDMRP heading tables, the backfill script and the `fit:backfill-announcements` alias. Run `--dry-run --limit 40` across at least four agencies, paste the output, and stop for me to read it. Do not run `--write`.

---

### PR 5.4 · NSF adapter

**Goal.** 91 open notices with a derivable, well-structured PDF that Grants.gov does not carry.

**Code.** `adapters/nsf-solicitation.ts`: **follow the row's stored `additional_info_url`** (`pub_summ.jsp?ods_key=…`) with redirects on, landing at `www.nsf.gov/funding/opportunities/{slug}/nsf{YY}-{NNN}/solicitation`, and section the HTML. PR 5.0 § 4b measured 91/91 rows carrying that URL, 50/50 returning 200, and **38/38 solicitation rows carrying all six roles**. **This reverses the earlier instruction to ignore `additional_info_url` and to derive a PDF**: the derived `nsf-gov-resources.nsf.gov` PDF 404s for 52 % of rows, every 2025–26 publication among them. Use the stored URL; never construct an `ods_key` (the earlier wrong-document finding came from a constructed one). Keep the derived PDF only as a last-resort fallback. **NSF therefore needs no PDF extraction and leaves D66's scope.** Handle `PD-` rows separately: 16 of 91 are program descriptions, not solicitations — they land on a program page with no skeleton (0/12 roles recovered) and must fall through to the synopsis path rather than being retried. NSF heading table: `SUMMARY OF PROGRAM REQUIREMENTS` and `I. INTRODUCTION` → `purpose`; `II. PROGRAM DESCRIPTION` → `objectives`; `III. AWARD INFORMATION` → `award_info`; `IV. ELIGIBILITY INFORMATION` → `eligibility`; `VI. …REVIEW PROCEDURES` → `review`; `VIII. AGENCY CONTACTS` → `contacts`. Also extract (a) any `REPLACES DOCUMENT(S)` line as reissue lineage and (b) the program element / reference codes printed in the body — PR 5.7 joins on them.

**Acceptance.** `objectives` (`II. Program Description`) recovered for ≥ 95% of the `NN-NNN` solicitation rows — PR 5.0 measured 100% on 38 of 38, so anything much below that is a sectioner bug, not a source problem; `PD-` rows fall through cleanly and are counted separately; two saved PDF fixtures with sectioner tests; program-element codes extracted for ≥ 60% and reported as a table.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.4, and `NON_NIH_INVENTORY.md` question 4 for the measured URL hit-rate. Build the NSF adapter and heading table on the PR 5.2 framework. Read `NON_NIH_INVENTORY.md` § 4 first — it reverses what the plan originally said. NSF's stored `additional_info_url` works (91/91 present, 50/50 fetched 200, 38/38 solicitations carrying all six roles) and the derived PDF does not (48 %). Follow the stored URL and section the HTML; no PDF extraction. Never construct an `ods_key`. The 16 `PD-` rows are program descriptions with no skeleton — fall through to the synopsis path, do not retry them. Extract the program element codes from the page body — PR 5.7 joins on them. Dry-run over all 91 rows, paste the summary table, stop.

---

### PR 5.5 · CDMRP / DHA adapter

**Goal.** 81 open DOD-AMRAA notices. PR 5.3 reaches most through the Simpler mirror; this adds the direct route as primary, because it is derivable and does not depend on the mirror staying published.

**Code.** `adapters/cdmrp-pa.ts`: `https://cdmrp.health.mil/funding/pa/{FON}_GG.pdf` where `{FON}` is the opportunity number (`HT942526PRMRPCTA`). Decompose the FON into `{office}{FY}{program}{mechanism}` and store the parts. **Do not split with a greedy suffix regex** — PR 5.0 § 5a left 26 of 81 unmatched and mis-cut others (`PCTA ×10` is `P` + `CTA` mis-bound, and `AZRPTRCA` is `AZRP` + `TRCA`), because program abbreviations vary in length. Seed the **program** set from CDMRP's own published program list (ALSRP, PRMRP, BCRP, OCRP, …); whatever remains after a known program prefix is the mechanism. § 5b's raw tails are the authoritative input — the **mechanism suffix is the CDMRP analogue of an NIH activity code** (`CTA` Clinical Trial Award, `IIRA` Investigator-Initiated Research Award, `IDA` Idea Award, `CDA` Career Development Award, …) and PR 5.8 attaches priors to it. Reuse the CDMRP heading table from 5.3, giving the `Program Description` / Areas of Emphasis block the `objectives` role explicitly — it is the highest-signal paradigm text in the non-NIH corpus.

**Acceptance.** FON decomposes for ≥ 95% of the 81 rows (PR 5.0 got 79/81 on shape) with **zero unmatched mechanisms** against the seeded program list, and the distribution reported; the `_GG.pdf` route resolves at or above the 88% PR 5.0 measured; `objectives` recovered for ≥ 90%; one saved fixture; a PR note listing every distinct mechanism suffix seen, which is PR 5.8's input.

> **Kickoff prompt.** Read `/CLAUDE.md` and `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.5. Build the CDMRP adapter. Beyond text, the point of this PR is the FON decomposition: report the mechanism-suffix distribution over the 81 open rows, because PR 5.8 turns them into mechanism priors. CDMRP has no working funded-award abstract source today (their search page is a stub and the DTIC replacement is offline), so these profiles are text-only — do not build an exemplar path for them.

---

### PR 5.6 · Open the gate, with guardrails ⚠ the risky PR

**BLOCKED on D62 (thin-profile ceiling) and D67 (thin-notice admission rule). Do not start until both are answered.**

**Goal.** Let non-NIH notices into the profile builder and into scoring, without letting thin profiles flood the recommendation tiers. This is the only PR in the phase that changes engine behaviour.

Read NON_NIH_FEASIBILITY § 7 in full before writing a line.

**Schema.** Migration `<ts>_fit_corpus_flag.sql`: `teams.fit_corpus TEXT NOT NULL DEFAULT 'nih' CHECK (fit_corpus IN ('nih','all'))` — the same shape as the existing `teams.fit_engine` flag (`20260917100000_fit_results_and_engine_flag.sql:52–53`). `'nih'` for every team until METRICS says otherwise.

Also in this migration: `fit_topic_idf` gains `corpus TEXT NOT NULL DEFAULT 'nih'`, its primary key becomes `(corpus, code)`, and the nightly recompute writes one row set per corpus. A team scoring `'nih'` reads only the `'nih'` rows, computed over exactly today's population — this is invariant property 3, and it is what keeps NIH T scores fixed while the corpus grows.

**Code.**
- `profile/opportunity.ts` — `loadCandidates()` gains a `corpus: 'nih' | 'all'` parameter. Under `'all'` it drops `.or(NIH_NOTICE_FILTER)`, relaxes `guide_sections IS NOT NULL` to `guide_sections IS NOT NULL OR description IS NOT NULL`, and relaxes `guide_html_hash IS NOT NULL` to `announcement_text_hash IS NOT NULL OR guide_html_hash IS NOT NULL`. `profileDue()` compares `announcement_text_hash` first, `guide_html_hash` second.
- **Text-source values.** Add `full_text_thin` and `landing_page` in **both** places the union is declared: `TextSource` (`profile/opportunity.ts:993`) and the inline union on `OpportunitySources.text` (`types.ts:452`), which is what `tier.ts` reads. `noticeText()` returns `full_text_thin` when the announcement was read but only one role was recovered; `profileConfidence()` implements NON_NIH_FEASIBILITY § 8.
- `taxonomy.json › confidence_caps`: add `thin_notice_profile_max_tier: "exploratory"` (per D62).
- `engine/tier.ts`: a `thin_notice_profile` cap firing when `sources.text ∈ {synopsis, landing_page, full_text_thin}`. **Key it on text source, not on empty requirement maps.** An emptiness-keyed cap would demote ~76% of the *existing NIH* corpus (D24(2)); a taxonomy cap is not team-scoped, so that would change today's behaviour for every team. Text-source keying changes nothing today, because no profiled notice currently has a thin source.
- `fit/retrieval.ts`: **thin notices are admitted on topic, not on a vacuous gate.** A thin profile passes `structuralGate` on its own (P = 1 ≥ `poor_below` 0.25, `retrieval.ts:91`), and `candidatesForInvestigator` runs that gate over every notice with no cap (`:144–149`), so excluding thin notices from the recall net alone does nothing. Add a rule in `selectCandidates`: a candidate whose profile is thin must additionally clear the Exploratory topic floor (`tiers.exploratory.T`, per D67) to be admitted. Rich profiles are untouched. Mirror it in `candidatesForNotice`. **This is deliberately not an agency or subject filter** — the corpus is shared across communities (Global Health Sciences is onboarding behind ImmunoX), so a USDA nutrition notice must be able to reach a global-health investigator on topical grounds while never reaching an immunologist.
- `service.ts`: `loadCorpus(now)` takes no team and loads one shared corpus per run (`:913`), so the team split cannot live there. Tag each `CorpusNotice` with `nih: boolean` and `thin: boolean` at load, and filter by the acting team's `fit_corpus` at the four consumers (`:332`, `:435`, `:579`, `:749`) — confirm those call sites before writing. Re-measure corpus-load time and per-investigator pair count against the `~400 pairs` / 240 s budget documented at `:84`.
- `judge/service.ts`: skip stage 8 when `text.source === 'none'` (and `'synopsis'` per D65).

**Acceptance.**
1. **Primary, write it first:** `npm run fit:nih-invariant -- --verify` green with `fit_corpus = 'nih'` for every team — every NIH `fit_results` row identical to the PR 5.0a baseline, including after a full nightly re-run. Assert it; do not eyeball it.
2. With `'all'` on a test team: no notice whose profile has `sources.text ∈ {synopsis, landing_page, full_text_thin}` reaches Moderate or Strong for any investigator.
3. Adversarial fixtures green.
3b. **Community neutrality:** for a hand-picked global-health-shaped investigator profile and a hand-picked USDA/DOT/EPA notice with real text, the pair is admitted and tiered on its merits; the same notice is not admitted for an immunologist. A fixture test, not a manual check.
4. Corpus-load time and pair counts reported before and after, with the run-budget headroom stated.
5. `METRICS.md` gains a non-NIH section.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_FEASIBILITY.md` § 7 in full, and `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.6. Confirm D62 and D67 are answered in `DECISIONS.md` before starting; if either is open, stop and tell me. This PR changes engine behaviour, so work slowly. The core risk, from D24(2) and visible at `engine/tier.ts:112–116` and `retrieval.ts:91`: a vacuous requirement scores 1, so a thin profile is a candidate for everyone and clears Moderate's P, U and M floors. There is no topic backstop — `withNoticeMesh` (`topic/notice-mesh.ts:180`, called at `service.ts:932`) maps terms to MeSH for any notice, and `w_embedding + w_bm25 = 0.5` clears Moderate's `T 0.45` on its own. Implement the `thin_notice_profile` cap **keyed on text source, never on empty requirement maps**, the `teams.fit_corpus` flag, the retrieval predicate and the corpus tagging. Write acceptance test 1 first. Report corpus-load time and pair counts before and after. Do not set any team to `'all'`.

---

### PR 5.7 · Exemplars beyond RePORTER

**Goal.** Restore the "what did this program actually fund" prior wherever it is obtainable.

**Schema.** Migration: `opportunity_exemplars` gains `source TEXT NOT NULL DEFAULT 'reporter'` and `join_method TEXT`. The table is RePORTER-shaped — NOT NULL `project_num`, `core_project_num`, `awarded_under`, `lineage_depth`, PK `(opportunity_number, project_num)` (`20260913130000_fit_reporter_exemplars.sql:20–40`) — so non-RePORTER rows need those columns relaxed or synthesised, and the decision recorded. Also widen the partial index `idx_funding_opps_exemplars_fetch`, whose predicate is NIH-only (`:113`).

**Code.**
- **HHS siblings — smaller than hoped, and measured.** PR 5.0 § 6 asked all 34 open sibling-prefixed notices: `RFA-OH-` (NIOSH) returned projects for 5 of 20, 4 with ≥ 5; `RFA-CE-`, `RFA-DP-` and `RFA-IP-` returned **zero across 14**, and no open `RFA-HS-` exists. So widen `NIH_LIKE_FILTER` (`exemplars.ts:496`) for `RFA-OH-` and expect nothing from the others. Spend one query first on the likely cause — those agencies probably do not populate `opportunity_number` on their RePORTER awards — and if so, record a follow-up to match on agency + fiscal year + text rather than building it now.
- **Scope the prune.** `exemplars-sync.ts:305` deletes by `opportunity_number` where `fetched_at <` the run stamp; without a `source` predicate the next RePORTER refresh silently deletes every NSF and Crossref row. Fix this in the same PR as the schema change.
- **NSF.** `src/lib/ingestion/nsf/awards.ts`: `api.nsf.gov/services/v1/awards.json`, no key, `printFields=id,title,abstractText,fundProgramName,startDate`. Join by `progEleCode` (from PR 5.4) when available; else `fundProgramName` filtered client-side; else keyword + `startDateStart` window. Record `join_method` per row — fidelity differs by an order of magnitude.
- **Foundations.** `src/lib/ingestion/crossref/grants.ts`: `api.crossref.org/works?filter=type:grant`, `description` as the abstract, joined by funder name.
- `taxonomy.json › opportunity_profile.exemplar_blend`: consider a lower `exemplar_weight` band when `join_method` is weaker than an exact announcement-number match. **That is a threshold change — record it in `DECISIONS.md`, never inline.**

**Acceptance.** For 10 HHS-sibling notices, exemplars fetched and counts recorded; for 10 NSF notices, join method and count per notice; for 3 foundation funders, Crossref records fetched and classified through the existing `classifyItem`. **Assert that no NIH notice's exemplar set changes**, and that a RePORTER refresh leaves non-RePORTER rows in place.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.7 and `src/lib/ingestion/reporter/exemplars.ts` and `exemplars-sync.ts` in full. Start with the free win: RePORTER already covers CDC, AHRQ, HRSA, ACF and VA under the same `criteria.opportunity_numbers` — verify it against real numbers before building anything else. Then add NSF and Crossref behind the same `ExemplarRecord` shape, with `source` and `join_method` on every row. Two things will bite you: the table's NOT NULL columns are all RePORTER-shaped, and `exemplars-sync.ts:305` prunes by `opportunity_number` without a source predicate, so the next RePORTER refresh would delete your new rows. Assert that no NIH notice's exemplar set changes.

---

### PR 5.8 · Mechanism priors for non-NIH families

**Goal.** Give non-NIH notices the equivalent of the activity-code prior.

**Code.** `taxonomy.json › opportunity_profile.mechanism_priors`, keyed `"{family}:{code}"`, same value shape as `activity_code_priors` (`{ r?, a?, objective?, career? }`). The existing `activity_code_priors` (24 codes plus a `_comment`) stays as-is and is read as `nih:{code}` through a compatibility shim, so no existing value or test moves. Seed from PR 5.5's mechanism-suffix distribution (CDMRP `CTA`, `IIRA`, `IDA`, `CDA`, `TTDA`, …) and PR 5.4's NSF program types (`CAREER`, `MRI`, `RAPID`, `EAGER`, …). `deterministicOverlays()` (`profile/opportunity.ts:225`) resolves the family from the registry and looks up the prior; the designation-first / prior-second precedence and the excluded-drops-prior rule are unchanged.

**Acceptance.** Every seeded prior has a test; an unknown mechanism produces a note and no overlay (matching today's unknown-activity-code behaviour); `npm run fit:opportunity-report` shows the priors firing on real rows.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.8, and `deterministicOverlays` in `src/lib/fit/profile/opportunity.ts`. Generalise `activity_code_priors` to `mechanism_priors` keyed `{family}:{code}` without moving any existing NIH value or test. Seed the CDMRP and NSF entries from the distributions PRs 5.4 and 5.5 reported. Every new prior is a threshold: it goes in `taxonomy.json` with a one-line note in `DECISIONS.md`, never in code.

---

### PR 5.9 · Foundation and internal ingestion *(scope separately, after 5.6 ships)*

**Goal.** Bring non-Grants.gov funders into the corpus at all. This is an ingestion problem before it is a Fit problem, and it carries licence and robots questions the rest of the phase does not.

**Sketch, not a spec.** A new `source_system` beyond `simpler_grants`; a per-funder allow-list with canonical program URLs; a `landing_page` adapter that fetches, extracts and sections with the prose fallback; explicit robots.txt and User-Agent handling per host. **Do not start until D68 is answered.** Michael J. Fox Foundation's robots.txt names and disallows ClaudeBot; proposalcentral.com, which hosts ACS's public awards search, is disallowed wholesale; and if UCSF licenses SPIN, its credentialed API (`synopsis`, `objective`, `programurl`) is a better discovery spine than crawling and comes with terms that state what reuse is permitted.

---

### PR 5.10 · Gold set and metrics for the widened corpus

**Goal.** Prove the extension is a win on the same terms Phase 2 used, and prove it did not move NIH.

**Code.** Extend `scripts/fit-goldset-export.ts` stratification with a non-NIH stratum: 40 pairs — 15 full-text non-NIH, 15 synopsis-only, 10 adversarial cross-family pairs constructed against non-NIH notices. `scripts/fit-metrics.ts` reports every metric split NIH / non-NIH, **plus an NIH-only regression check against the pre-Phase-5 baseline**: widening the corpus changes `fit_topic_idf` for every existing code, so NIH tier precision can move without any NIH input changing (NON_NIH_FEASIBILITY § 7.2).

**Acceptance.** `METRICS.md` shows non-NIH wrong-type rate ≤ 5%, no thin-source pair above Exploratory, and NIH tier precision within noise of the pre-phase baseline. Only then does the rollout question go back to a person.

> **Kickoff prompt.** Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.10 and `src/lib/fit/goldset/*`. Extend the stratification and split every metric NIH / non-NIH. The check that matters most is the NIH-only regression against the pre-Phase-5 baseline: widening the corpus changes `fit_topic_idf` for every existing code, so NIH scores can move without any NIH input changing. Report it explicitly.

---

## Sequencing

5.0 alone → checkpoint (D61, D67). **Then 5.0a, before any code that could move NIH** — it captures the baseline from `main`. Then 5.1, then 5.2 (5.2 depends on 5.1's roles). 5.3, 5.4 and 5.5 are disjoint adapters buildable in parallel worktrees, merged in sequence — 5.3 first, since the other two reuse its heading-table plumbing. 5.6 is sequential and alone, and blocked on D62 and D67. 5.7 and 5.8 are disjoint. 5.10 last. 5.9 is a separate scoping exercise.

## Session opener for any PR in this phase

> Read `/CLAUDE.md`, `docs/fit-engine/NON_NIH_FEASIBILITY.md` and `docs/fit-engine/NON_NIH_PLAN.md`. We are on PR 5.X. Summarise what it requires and what already exists in the repo before writing any code — this phase deliberately reuses more than it adds (`grants-gov-opportunity-api.ts`, the Simpler detail client, `noticeText`'s synopsis fallback and the confidence plumbing are all already built). Check `DECISIONS.md` for any OPEN item this PR depends on and stop if there is one. Then work as usual: branch `fit/5.X-<slug>`, commits prefixed `fit(5.X):`, `npm test` and `npx tsc --noEmit` pasted before you propose a commit, and a dry run on real rows for anything touching ingest. Run `npm run fit:nih-invariant -- --verify --offline` before you propose a commit and paste the result — nothing about NIH notices may change in this phase. If a step needs a threshold or a fixture changed, that is a spec change — make it in `taxonomy.json` or the fixtures with a note in `DECISIONS.md`, and show me first.
