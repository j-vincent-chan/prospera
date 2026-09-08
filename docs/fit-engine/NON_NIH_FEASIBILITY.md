# Fit beyond NIH — feasibility and scope

**Status.** Scoping document, 2026-09-07. Companion to `docs/MATCHING_REDESIGN.md` (the spec) and `docs/fit-engine/IMPLEMENTATION_PLAN.md` (Phases 0–4). The build order is `docs/fit-engine/NON_NIH_PLAN.md` (Phase 5).

**Question.** The fit engine builds opportunity profiles only for NIH Guide notices. Can it be extended to the rest of the corpus?

**Verdict.** Yes, and the architecture needs less change than the framing suggests: the engine, the judge, the surfaces and the feedback loop already operate on an abstract profile, and nothing in scoring knows what NIH is. What is NIH-specific is **text acquisition and section routing**, not representation.

But the interesting finding is not that it can be done. It is that **the engine as calibrated has no safety rail against a thin profile**, and today that is invisible because every profile in the table is rich. §7 is the substance of this document; the rest is the map.

---

## 1. The corpus, counted honestly

From `INVENTORY.md` § 4 and `GUIDE_DIAGNOSTICS.md` § 1a/1e (2026-09-05):

| | count |
|---|---|
| Open notices | 1,304 |
| NIH-like by agency or number | 657 |
| Guide text on file today (`guide_fetch_status = 'ok'`) | 313 |
| Expected after PR 0.5's fixes | ≈ 438 |
| Non-NIH, never fetched | 649 |
| — of those, **posted** (512 non-HHS + 15 CDC + 11 other-HHS) | **538** |
| — of those, forecast (no announcement exists yet) | 111 |

**538 is the addressable set**, not 649. Named families inside it: NSF 91, DOD-AMRAA 81, USDOJ 20, plus USDA 30, NOAA 11, NASA 11, DOE, IHS 16 and a long tail. HRSA's 51 rows sit almost entirely in the 72 forecast "other HHS" rows and are *not* addressable until they post.

Two consequences worth stating up front:

- **The corpus is shared; relevance is a property of the pair.** The Simpler sync applies no agency, category or assistance-listing filter (`services/simpler-grants-sync.ts:574–579` — the docblock at `:532` says so explicitly), so USDA, NOAA, DOT and USDOJ notices are already in the table. It is tempting to read that as noise and add a subject or funder allow-list. **Do not.** Prospera serves multiple communities off one notice table — ImmunoX today, Global Health Sciences next — and a USDA nutrition program, a DOT road-traffic-injury program or an EPA exposure program is a real lead for a global-health investigator and noise for an immunologist. The same row is both. Any filter that removes a notice from the corpus is therefore wrong by construction; filtering belongs at the **pair** level, where the engine already lives (§ 7.3).
- **AHRQ and the CDC/NIOSH `RFA-` numbers are already covered.** Any `RFA-XX-YY-NNN` matches `opportunity_number.like.RFA-%` in the Guide sync's filter (`services/nih-guide-sync.ts:237`), so those notices are already in the 313 `ok` / 341 `not_found` population, not in the non-NIH remainder.

## 2. What the engine actually needs from a notice

The opportunity profile has four feeder paths (spec § 6). Only one is indispensable.

| Feeder | Code | NIH source today | Indispensable? |
|---|---|---|---|
| **Sectioned announcement text** | `noticeText()` (`profile/opportunity.ts:1064`) → `groupSections()` (`profile/opportunity-extract.ts:115`) → `extractGroup()` (`:901`) | `funding_opportunities.guide_sections`, written by `nih-guide-sync.ts` | **Yes.** Everything else is a prior. |
| **Mechanism prior** | `deterministicOverlays()` (`profile/opportunity.ts:225`) → `taxonomy.json › opportunity_profile.activity_code_priors` (24 codes) | `activity_code` parsed from the Guide page | No — improves precision; absent ⇒ neutral, with a note |
| **Clinical-trial designation** | `taxonomy.json › opportunity_profile.clinical_trial_designation` | title suffix / Section II row | No — NIH convention; `unknown` is a legal value |
| **Funded exemplars** | `ingestion/reporter/exemplars.ts` → `exemplarPrior()` (`profile/opportunity.ts:783`) → `blend()` (`:899`) | RePORTER `criteria.opportunity_numbers` | No — `blendWeights(0)` returns `{exemplar: 0, text: 1}` and `blend()` short-circuits to the text profile (`:858`, `:912`). Degrades cleanly. |

So the minimum viable non-NIH profile is **text in, profile out**.

## 3. What is already source-agnostic (more than expected)

1. **A synopsis text path.** `noticeText()` falls back to `synopsisSections(notice.description)` and returns `source: "synopsis"`; `profileConfidence()` caps that at `medium` (`profile/opportunity.ts:1064–1076`). `SYNOPSIS_SECTION` routes to extractor group 1 (`opportunity-extract.ts:118`). **It is unreachable from the nightly**, because `loadCandidates()` requires non-null `guide_sections` (§ 4, gate 1) — so nothing is profiled from a synopsis today.
2. **A Simpler detail client that returns attachments.** `SimplerGrantsClient.getOpportunity()` (`ingestion/simpler-grants/client.ts:28`) and the typed `SimplerAttachment { file_name, mime_type, download_path }`. The Guide sync already calls it to resolve `<number>-Full-Announcement.html` on `files.simpler.grants.gov` and stores `guide_source = 'simpler_attachment'`.
3. **An agency-neutral legacy Grants.gov client.** `funding-opportunities/grants-gov-opportunity-api.ts` implements `POST /search2` and `POST /fetchOpportunity`, extracts `synopsisAttachmentFolders[].synopsisAttachments[]`, and builds a download URL at `https://www.grants.gov/grantsws/rest/opportunity/att/download/{id}` (`:69–71`, `:165–167`). No API key. **It is not dead code** (PR 5.0 § 9): `funding-opportunity-application-materials.ts:9` imports it, and that is reached from the opportunity page, `opportunity-peek.tsx` and `funding-opportunity-peek.ts`. Reuse it; do not change the behaviour those render paths depend on.
4. **An extractor prompt already written for the general case.** `EXTRACTOR_SYSTEM_PROMPT` opens *"You read NIH and foundation funding announcements…"*; its schema is vocabulary-driven, not section-driven.
5. **A judge that tolerates missing text.** `noticeTexts()` degrades to `"(no Section I text on file)"` and `"(none stated)"` rather than throwing (`judge/inputs.ts:194–197`).
6. **Confidence plumbing end to end.** `opportunity_fit_profiles.confidence` is a checked enum; `engine/tier.ts:245` caps on it; `taxonomy.json › confidence_caps` holds the values.

## 4. The gates that keep non-NIH out

Five, all narrow, in three files.

| # | Gate | Where |
|---|---|---|
| 1 | Profile candidates require an NIH-shaped number **and** non-null `guide_sections` **and** non-null `guide_html_hash` | `profile/opportunity.ts:1271–1280`; `NIH_NOTICE_FILTER` at `:132`; `NIH_LIKE_FILTER` at `ingestion/reporter/exemplars.ts:496` |
| 2 | Guide sync targets only `agency_code.like.HHS-NIH%` or `PA-/PAR-/PAS-/RFA-` numbers | `services/nih-guide-sync.ts:237`; repeated at `scripts/backfill-nih-guide.ts:93,174` |
| 3 | URL construction hardwired to `grants.nih.gov` paths behind `GUIDE_NUMBER_RE` | `ingestion/nih-guide/client.ts:34,48–67` |
| 4 | **A 200 OK page without "Key Dates" or "Application Due Date" is discarded as a 404** | `ingestion/nih-guide/client.ts:127` |
| 5 | Section detection assumes the NIH template — `Part 1./Part 2.` and `Section [IVX]+.` headings (`parse.ts:453–461, 516–575`), `datalabel`/`datacolumn` rows (`:118–122, 409–416`), `KEPT_SECTIONS = {I,II,III,IV,VII}` (`:359`) | `ingestion/nih-guide/parse.ts` |

Two CHECK constraints also block new values: `guide_source IN ('grants_nih_gov','simpler_attachment')` and `clinical_trial_designation IN (…5 values…)` (`20260914100000_fit_guide_sections.sql:32,38`).

Gate 5 needs design rather than deletion; § 6 proposes the shape.

## 5. Where the full announcement text actually is

Verified September 2026. "Derivable" means the URL can be built from data already on the row.

| Family | Posted rows | Route | Format | Derivable? |
|---|---|---|---|---|
| **Grants.gov attachment** — CDC, DOE, ACF, IHS, USDOJ, HRSA (once posted), CDMRP mirror, and the rest of the non-HHS tail | ~447 (538 less NSF's 91) | `attachments[].download_path` from Simpler's `GET /v1/opportunities/{id}`, keyed on the stored `source_opportunity_id`; **or** the legacy `fetchOpportunity`, keyed on `raw_payload_json.legacy_opportunity_id`, which PR 5.0 § 2b found stored on **536/536** posted non-NIH rows — so no `search2` lookup is needed. The two routes return the **same files** (identical names on 49/49 once punctuation folding is applied); Simpler only URL-safes them. | PDF mostly, some HTML | **Yes**, by either route. Measured attachment rate: **78 %** of 49 sampled rows. Zero-attachment agencies: NSF, NASA, NEA, all three USDOJ offices, DOI-BLM, DOS-GTIP. |
| **NSF** | 91 | **The stored `additional_info_url`** (`pub_summ.jsp?ods_key=…`), which 302s to the HTML solicitation at `www.nsf.gov/funding/opportunities/{slug}/nsf{YY}-{NNN}/solicitation`. Present on 91/91 rows; 50/50 fetched returned 200; **38/38 solicitation rows carried all six section roles**. | **HTML — no PDF extraction needed** | **Yes.** Corrects an earlier claim in this document: the derived PDF at `nsf-gov-resources.nsf.gov` resolves for only 48 % (every 2025–26 publication 404s), and `additional_info_url` is *not* broken — the earlier finding came from a **constructed** `ods_key`, not the stored URL. Use the stored URL; never construct one. Separately, 16 of the 91 are `PD-` **program descriptions**, not solicitations: no `I.–IX.` skeleton, no PDF, 0/12 roles recovered. A distinct acquisition case. |
| **DoD / CDMRP / DHA** | 81 | `https://cdmrp.health.mil/funding/pa/{FON}_GG.pdf`, also mirrored as a Simpler attachment | PDF | **Yes** (both routes) |
| **Foundations, societies, internal / limited-submission** | 0 today | Not ingested at all — Simpler is the only ingestion path | landing-page HTML / PDF | needs a new `source_system` |

**How much of that ~447 actually carries a NOFO is unmeasured**, and every downstream estimate depends on it. PR 5.0 measures it.

**Sectioning is more regular than the NIH framing implies.** NSF solicitations carry a fixed `I. INTRODUCTION … IX. OTHER INFORMATION` skeleton with `II. PROGRAM DESCRIPTION` and `IV. ELIGIBILITY INFORMATION` in fixed positions. CDMRP Program Announcements carry a fixed thirteen-block structure whose `Program Description` block holds the Areas of Emphasis — the highest-signal paradigm text in the non-NIH corpus. HRSA and CDC NOFOs follow the federal `I. Program Funding Opportunity Description … VIII. Other Information` template. Three heading tables cover most of the corpus.

**PDF is the real new dependency.** Extraction must preserve line structure: `parse.ts:98` collapses all whitespace, which would destroy heading detection before a sectioner saw it, so that helper cannot be reused.

## 6. Section routing: the one design change

`groupSections()` routes on NIH section ids (`"I"`, `"II"`, `"III*"`, `"IV*"`, `"VII"`, `"synopsis"`). Every non-NIH source has the same *roles* under different names.

The proposal is a canonical role vocabulary carried on each section alongside its existing `section` id, with the extractor grouping on role:

| Role | NIH | NSF | CDMRP | HRSA/CDC | Foundation |
|---|---|---|---|---|---|
| `purpose` | Part 1 · Funding Opportunity Purpose | I. Introduction | Basic Information About the Funding Opportunity | I (intro) | overview |
| `objectives` | Section I research objectives / areas of interest | II. Program Description | Program Description / Areas of Emphasis | I. Program Description | "what we fund" |
| `non_responsive` | Section I non-responsive paragraph | "returned without review" | "not responsive" list | — | rare |
| `award_info` | Section II | III. Award Information | Basic Information (amounts) | II. Award Information | award terms |
| `eligibility` | Section III (III.3) | IV. Eligibility Information | Eligibility Information | III. Eligibility | eligibility |
| `human_subjects` | Section IV.2 | — | Human Subjects / Clinical Trial items | IV | — |
| `review` | Section V | VI. Review Procedures | Application Review Information | V | review criteria |
| `contacts` | Section VII | VIII. Agency Contacts | contacts | VII | contacts |
| `team` | Section I team language | ditto | ditto | ditto | ditto |
| `synopsis` | — | — | — | — | the existing pseudo-section |

Groups become: **1** = `purpose` + `objectives` + `synopsis`; **2** = `non_responsive` + `award_info` + `human_subjects`; **3** = `eligibility` + `contacts` + `team`.

**One trap.** `groupSections` is not a partition: a Section I section whose heading matches `TEAM_HEADING` is pushed into group 1 (or 2) **and** group 3 (`opportunity-extract.ts:126–130`). A single role per section cannot reproduce that, and changing group 1's text changes the extraction cache key. Roles must therefore be a **list** per section, not a scalar.

## 7. The three risks that decide whether this is an improvement

Building thin profiles is easy. The danger is that thin profiles are *permissive*, and the engine was calibrated on a corpus in which every profile is rich.

### 7.1 A thin profile matches everyone, and nothing stops it

D24(2) is explicit: a vacuous requirement scores **1**, not 0 and not a neutral value, for P, U, M, O and D's requirement term. PR 5.0 § 3 measured how real this is: all 536 posted non-NIH rows have a `description`, median 1,167 characters of stripped text — but **43 % are under 1,000 characters and 15 % under 500**, concentrated in `other_federal`. That is the thin tail. Follow it through for a synopsis-only notice:

- `retrieval.ts:91` admits a candidate on `E === 1 && P >= poor_below` (0.25). With P = 1, **every open notice with a thin profile is a candidate for every investigator**.
- Moderate's floors are `P 0.50 ✓ (1) · U 0.40 ✓ (1) · D 0.50 · D_required_group_min 0.20 ✓ (vacuous: `minGroup === null` passes at `tier.ts:181`) · T 0.45 · M 0.30 ✓ (1) · K 0.25`. Only **D, T and K** are doing any work.
- `confidence: "medium"` is **not capped**. `confidence_caps` has five keys, all valued `"moderate"`, and every one of them is keyed on something else (`low_notice_confidence`, `low_profile_confidence`, `eligibility_unknown`, `readiness_far`, `runway_short`). `confidenceAtLeast("medium","medium")` is true, so even Strong's `confidence_min` floor passes.
- `paradigmAxisEmpty()` (`tier.ts:112–116`) fires the `low_notice_confidence` cap only when **all four** paradigm maps are empty, and a single `allowed` weight of 0.05 defeats it. That exemption is deliberate — D24(2) records it, on the grounds that *"76 % of notices state no requirement and are genuinely broad"*. And when it does fire, its `max_tier` is `"moderate"`, so it never stood between a thin profile and Moderate in the first place.

**There is no topic backstop.** It is tempting to assume T saves us because a non-NIH notice has no MeSH — it does not. `withNoticeMesh()` maps `topic.terms` to MeSH descriptors by folded name and is applied to **every** profile at corpus load (`topic/notice-mesh.ts:180–185`, called at `service.ts:932`); nothing in it is NIH-specific. Even where the mapping fails and the coded half of T goes to zero, `compose.topic` gives `w_embedding 0.3 + w_bm25 0.2 = 0.5` — above Moderate's `T 0.45`. Only **Strong** is structurally blocked, by `T 0.6` and `T_specific_depth 3` (`tier.ts:186`).

So a synopsis-only notice for a random USDA program can reach **Moderate** for an investigator on embedding and BM25 similarity alone, with P, U and M all scoring 1 because the notice asked for nothing. That is precisely the failure mode the redesign exists to remove, arriving through a different door.

**Mitigation (PR 5.6).** A cap keyed on **what was read**, not on what the profile happens to contain:

> `thin_notice_profile` → `max_tier: "exploratory"`, fired when `sources.text ∈ {synopsis, landing_page, full_text_thin}`.

Keying on text source rather than on emptiness is what makes this safe. An emptiness-keyed cap would demote roughly three quarters of the *existing NIH* corpus (D24(2)'s 76%), and a taxonomy cap is not team-scoped, so it would change today's behaviour for everyone. A text-source-keyed cap changes nothing today: no profiled notice currently has a thin text source, because `loadCandidates` requires `guide_sections`.

### 7.2 IDF drift across the whole corpus

`fit_topic_idf` is recomputed nightly over the profiled open-notice corpus, `idf = ln((n+1)/(df+1))` (`20260917100000_fit_results_and_engine_flag.sql:143`). Going from 313 profiled notices (438 after PR 0.5's fixes) to ~1,000 raises `n` by 2–3× while `df` for existing codes stays flat, inflating every existing weight. **Topic scores for NIH pairs move even though no NIH input changed.** This is the only place in the whole extension where that can happen, and under a hard "nothing changes for NIH" constraint a mitigation is not enough: `fit_topic_idf` must be **keyed by corpus** — `corpus TEXT NOT NULL DEFAULT 'nih'`, PK `(corpus, code)` — with the `'nih'` rows computed over exactly today's population and read by any team scoring `'nih'`. Widening the corpus then cannot touch an NIH pair's T at all. See NON_NIH_PLAN § "The NIH invariant", property 3.

### 7.3 Compute, and corpus relevance

`service.ts:918` reads the **entire** `opportunity_fit_profiles` table with no predicate on every run. The nightly is sized at *"~1–3 s per investigator (… ~400 pairs scored) after a ~10 s corpus load, so a full night covers ≈ 100 investigators"* (`service.ts:84`). Because thin profiles pass the P gate, pair counts scale with the profile count, not with genuine matches.

Two things make this concrete. `candidatesForInvestigator` runs `structuralGate` over **every** profiled notice with no cap (`retrieval.ts:144–149`), and a thin notice *passes* that gate (P = 1), so it is scored and persisted for every investigator on the roster. Cost scales with the profile count, not with genuine matches.

The wrong fix is a subject or funder allow-list (§ 1). The right fix is a **pair-level admission rule for thin notices only**: a notice whose profile rests on a synopsis or an unstructured page has no requirements to gate on, so topical proximity is the only evidence there is — require it. Concretely, a thin notice becomes a candidate only when it clears the Exploratory topic floor for that investigator, instead of passing on a vacuous P = 1. Rich profiles are unaffected and keep gating on paradigm, unit and design as they do today.

This is community-neutral by construction: a USDA nutrition notice reaches a global-health investigator on topical grounds and never reaches an immunologist, without anyone having decided in advance that USDA is out of scope. It is also the compute lever — measure the pair count with and without it in PR 5.6.

Separately, some notices are ones a university genuinely cannot hold — direct payments to individuals or producers, procurement, formula grants to states. That is an **eligibility** fact, not a subject-matter one, and it belongs in stage 1 (`eligibility()`), where E = 0 removes the pair with a stated reason, using the `applicant_types` and `funding_instrument` columns the Simpler sync already stores (`simpler-grants-sync.ts:511,513`). Measure how many rows that removes before adopting it.

Mitigations: the § 7.1 cap first; a retrieval-side change so thin notices do not become candidates at all (excluding them from the *recall net* alone does nothing — they pass `structuralGate` on their own at `retrieval.ts:91`); and re-measure the run budget in the same PR.

### 7.4 Two smaller ones

- **Staleness.** `profileDue()` compares `existing.guide_html_hash !== notice.guide_html_hash` (`profile/opportunity.ts:1358–1366`); both are NULL for a synopsis-only profile, so it never re-queues on content change. Every source needs a text hash, and it has to exist on **both** `funding_opportunities` and `opportunity_fit_profiles` to be comparable.
- **The judge on nothing.** With no sections, `noticeTexts()` hands the blind pass `"(no Section I text on file)"` and three `"(none stated)"` strings, and the model still returns a confident verdict. Stage 8 should be skipped for `text.source === 'none'`, and probably for `'synopsis'` until measured.

## 8. Proposed confidence model

Confidence becomes a function of what was read. Note that two declarations must move together: `TextSource` (`profile/opportunity.ts:993`) and the inline union on `OpportunitySources.text` (`types.ts:452`), which is what `tier.ts` reads.

| Text source | Profile confidence | Tier ceiling | Mechanism |
|---|---|---|---|
| `full_text` — ≥ 2 roles recovered including `objectives` | as the extractor returns | none | today's behaviour |
| `full_text_thin` — announcement read, only one role recovered | ≤ `medium` | Exploratory | `thin_notice_profile` cap |
| `synopsis` — Simpler `description` only | ≤ `medium` | Exploratory | `thin_notice_profile` cap |
| `landing_page` — no recognised structure | ≤ `low` | Exploratory | `thin_notice_profile` cap (the existing `low_notice_confidence` cap is `moderate`, so `low` alone is not enough) |
| `none` | `low` | Poor; stage 8 skipped | existing floors |

This keeps recall — the notice appears, under Exploratory, with the gap named — without letting an unread notice reach a recommendation. That is exactly the trade the spec's Exploratory tier exists to make.

## 9. Coverage estimate

Against today's 1,304 open notices, if the plan lands in full. Every non-NIH figure is a band pending PR 5.0.

| Band | Notices | Confidence |
|---|---|---|
| NIH Guide (unchanged) | 313 today → ≈ 438 after PR 0.5's fixes | high |
| NSF (derivable PDF, fixed skeleton) | up to 91 | high |
| DoD / CDMRP (derivable PDF; no exemplars available) | up to 81 | high text, no exemplar prior |
| Grants.gov attachment — CDC, DOE, ACF, IHS, USDOJ, HRSA-once-posted and the tail | share of ~366 (538 − 91 − 81), **unmeasured** | high / medium |
| Same rows, no attachment: synopsis only | the remainder of the 538 | medium, capped Exploratory |
| Forecasts (non-NIH) | 111 | n/a until they post |
| Foundations / internal | 0 → new source | medium to low |

Headline, honestly: **the 538 posted non-NIH notices become visible, most with real full text.** Whether a given one reaches a given investigator is decided per pair by the gates and, for thin profiles, by the topic bar in § 7.3 — not by a decision about which funders matter. Foundations are an ingestion problem before they are a Fit problem; a meaningful share of that long tail will stay text-poor and belongs in Exploratory.

## 10. Effort

At the cadence Phases 0–3 were built (one agent per PR, a cold validator pass, sequential merges):

| Block | PRs | Estimate |
|---|---|---|
| Inventory, section roles, acquisition framework, Grants.gov attachment adapter + PDF | 5.0–5.3 | ~1 week |
| NSF and CDMRP adapters, open the gate with guardrails | 5.4–5.6 | ~1 week |
| Exemplars beyond RePORTER, non-NIH mechanism priors | 5.7–5.8 | ~1 week |
| Gold set, metrics, rollout | 5.10 | ~3 days |
| Foundation ingestion (scoped separately) | 5.9 | ~1–2 weeks |

**PRs 5.0–5.6 plus 5.10 are the coherent first release** and cover every federal notice in the corpus. 5.9 is a different kind of work — a new ingestion source, robots and licence judgment, per-funder scrapers — and should be scoped after 5.0–5.6 are measured.

## 11. Funded exemplars beyond RePORTER

| Source | Covers | Join key | Text | Verdict |
|---|---|---|---|---|
| **NIH RePORTER** (already built) | NIH; of the HHS siblings, **NIOSH only in practice** | `criteria.opportunity_numbers`, already used | full abstracts | **Much smaller than hoped.** PR 5.0 § 6 asked all 34 open sibling-prefixed notices: `RFA-OH-` returned projects for 5 of 20 (4 with ≥ 5, up to 29); `RFA-CE-`, `RFA-DP-`, `RFA-IP-` returned **zero across 14**, and there are no open `RFA-HS-` notices at all. RePORT's FAQ says those agencies' projects are in RePORTER, so the likely cause is that they do not populate `opportunity_number` on their awards — a follow-up worth one query (match on agency + fiscal year + text instead), not a blocker. Widen the filter for `RFA-OH-`; expect nothing from the rest. |
| **NSF Awards API** (`api.nsf.gov/services/v1/awards.json`, no key) | NSF | **no solicitation filter.** Join via `progEleCode` (program-element codes are printed in the solicitation PDF we fetch), else `fundProgramName`, else keyword + date window | `abstractText` | Real but lower fidelity; record which join was used |
| **Crossref grants** (`api.crossref.org`, `type:grant`, ~208k records, open licence) | Foundations: AHA ~4.0k, ACS ~4.0k, ALS Association, Melanoma Research Alliance, Children's Tumor Foundation, CZI, MJFF | funder name | `description` carries a real abstract on the AHA records sampled | The only clean foundation exemplar source |
| **DOE PAMS** | DOE | native Solicitation Number filter | abstracts 2014+ | Usable, scrape-only |
| **CDMRP awards** | DoD | — | — | **Unavailable today.** Their search page is a stub; the DTIC replacement is offline. |
| **USAspending** `funding_opportunity.number` | federal assistance | detail endpoint only, cannot filter | administrative one-liners | **Do not build on it.** |
| Federal RePORTER | 14 agencies | — | — | Abandoned in place; data ends FY2020. |

`opportunity_exemplars` is RePORTER-shaped (NOT NULL `project_num`, `core_project_num`, `awarded_under`, `lineage_depth`; PK `(opportunity_number, project_num)`), and `exemplars-sync.ts:305` prunes by `opportunity_number` per run — so a second source needs both a schema change and a source-scoped prune, or the next RePORTER refresh silently deletes it.

## 12. Decisions this opens (D61–D68)

`DECISIONS.md` ends at D60; D61–D68 are untaken.

- **D61 · Scope of the first release.** Federal-only (5.0–5.6, 5.10) before foundations, or both? *Recommended: federal first.*
- **D62 · Thin-profile ceiling.** Does a `synopsis` / `landing_page` / `full_text_thin` profile cap at Exploratory (recommended) or Moderate? **PR 5.6 cannot be built until this is answered** — it is the PR's central behaviour.
- **D63 · IDF corpus.** *Answered by the NIH-invariance constraint:* key `fit_topic_idf` by corpus, so a team scoring `'nih'` reads IDF computed over exactly today's population. The remaining sub-question is whether the `'all'` corpus additionally restricts to notices carrying ≥ 1 code — measure it in PR 5.10.
- **D64 · Section roles.** Adopt the ten roles in § 6, carried as a **list** per section (§ 6's trap).
- **D65 · Stage 8 on thin profiles.** Skip the blind pass below which text source — `none` only, or `synopsis` too?
- **D66 · PDF extraction library.** `unpdf` / `pdfjs-dist` / `pdf-parse`; must preserve line structure and run inside the Vercel function limit.
- **D67 · Admission rule for thin notices.** *Replaces an earlier framing as an agency allow-list, which was wrong:* Prospera serves multiple communities off one shared notice table, so no funder or subject is out of scope a priori (§ 1). The open questions are (a) the topic floor a thin notice must clear to become a candidate at all — the Exploratory floor (`tiers.exploratory.T` 0.35) is the natural default — and (b) whether applicant-type and funding-instrument facts move into stage-1 eligibility so notices a university cannot hold are excluded with a reason rather than scored. Both are measured in PR 5.0 and decided before PR 5.6.
- **D68 · Foundation retrieval policy.** Which funders are on the allow-list, the crawl cadence and User-Agent, and whether Pivot-RP or SPIN is licensed at UCSF — SPIN has a credentialed API (`synopsis`, `objective`, `programurl`) and would be a better discovery spine than crawling. **Licence terms must be read before ingestion; "publicly reachable" is not "licensed."** Michael J. Fox Foundation's robots.txt names and disallows ClaudeBot; proposalcentral.com, which hosts ACS's public awards search, is disallowed wholesale.

## 13. What is not verified

- **The Grants.gov attachment hit-rate over the ~366 non-NSF, non-CDMRP posted rows.** No published statistic exists; PR 5.0 measures it. Every downstream estimate depends on this number.
- Whether `files.simpler.grants.gov` URLs remain public and stable — the storage ADR contemplated expiring presigned links, though published files are currently public and search-indexed.
- Whether ACS's Crossref grant records populate `description` as consistently as AHA's (AHA sampled and confirmed; ACS not).
- Whether DTIC's DoD grant-awards search returns, and whether it will expose an API.
- PCORI's portfolio export and whether its funding-opportunity index can be fetched at all (403 to automated fetch).
- The share of the foundation long tail that would stay text-poor: the 60–75% figure in circulation is an extrapolation from an eight-funder sample, not a measurement of Prospera's corpus.
- ~~Whether `grants-gov-opportunity-api.ts` is genuinely unused~~ — **resolved by PR 5.0 § 9: it is in use** by `funding-opportunity-application-materials.ts`, reached from the opportunity page and the peek.
