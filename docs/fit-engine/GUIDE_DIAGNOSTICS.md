# Guide fetch diagnostics (PR 0.5a)

Findings note for the NIH Guide coverage gap. Read-only: nothing here changed the database, the sync, or any production data. Produced 2026-09-05 by `npm run fit:guide-diagnostics -- --sample 30 --fetch 10` plus four hand-checked `--url`s; the verbatim script output is in the appendix. INVENTORY.md (2026-09-04) counted 1,304 open notices: `guide_fetch_status` `ok` 313, `not_found` 341, never fetched 650. Today the corpus is 1,306 / 313 / 341 / 652 (two notices posted since).

## 1. Headline

**The Key Dates heuristic is not the problem. Every miss is a hard HTTP 404 at the classic Guide URL, and the misses come from two populations that need different fixes.**

| Class (plan § PR 0.5a) | Of the 341 `not_found` | Evidence | Fix |
|---|---|---|---|
| (i) page exists but fails `/Key Dates\|Application Due Date/i` | **0** | 0 of 10 fetched; both Simpler-hosted announcements and the classic control page contain "Key Dates" (5 hits each) | none |
| (ii) URL pattern wrong — the notice is posted but not at the classic `grants.nih.gov/grants/guide/…` path | **124–126** (36 %) | 3 of 10 fetched (PAR-27-064, RFA-CA-27-020, PAR-27-062) + PAS-27-028; all posted NIH notices, 404 at the classic path; the same NOFOs exist as `<number>-Full-Announcement.html` attachments on Simpler.Grants.gov, with identical Guide markup | Fix B below (Simpler attachment fallback) + `PAS-` in `guideUrlFor()` |
| (iii) genuinely no Guide page | **215–217** (63 %) | 7 of 10 fetched: 6 Simpler *forecasts* (`opportunity_status = forecasted`, no attachment either) and 1 CDC `RFA-IP-18-000` placeholder | Fix A below (stop targeting forecasts, placeholders and non-NIH `PA-XXX-` numbers) |

Split of the 341 by the data markers the fetches validated: Simpler forecasts 199 (NIH 171, CDC 28) + CDC `RFA-XX-18-000` umbrella placeholders 15 + HHS-OPHS `PA-FPH-27-001` 1 = **215** in class (iii); posted NIH notices 124 (FY27 105, FY26 15, FY25 3, FY28 1) in class (ii); the remaining 2 (CDC posted FY26, e.g. `RFA-CK-26-035`) sit between the two and are not worth a special case.

**The 652 never-fetched rows are almost entirely out of scope by design**: 649 are non-NIH-Guide notices the sync never targets (NSF 91, DOD-AMRAA 81, HRSA 51, USDOJ 20, IHS 16, …; 512 non-HHS posted, 84 forecasts, 53 other-HHS/CDC). Only 3 are NIH rows, all skipped because `guideUrlFor()` returned `null`: `PAS-27-028` (posted; fixable, it is a Simpler-hosted announcement) and `FOR-AR-26-008`, `FOR-AT-25-007` (NIH forecasts; no page exists). **Best estimate after the fixes: 1 of the 652 succeeds.** The gain is in the 341, not the 652.

**Why this matters for PR 0.5.** The 313 `ok` notices are old: FY25 213, FY24 63, FY23 11, FY22 2, FY26 19, FY27 5. Posted `not_found` NIH notices start on 2025-11-26 and dominate May–Sept 2026 (41 + 38 + 13 + 8). Since roughly November 2025 NIH has been publishing most new NOFOs as Simpler.Grants.gov attachments rather than classic Guide pages (only a handful of parent-style notices such as PA-27-034/035/036 and PAR-27-026 still appear at the classic path). Without Fix B, PR 0.5's sectioned text would cover the expiring back-catalogue and miss nearly every notice posted in the last ten months — and its 7-night `--force` re-fetch would simply re-stamp those 124 rows `not_found`.

After Fixes A and B the expected state is `ok` ≈ 313 + 124 + 1 = **438 of the ≈ 440 posted NIH-Guide notices (≈ 99 %)**, with forecasts (≈ 230) and non-NIH notices (≈ 650) correctly excluded rather than counted as failures.

## 2. Method

- Population: every open notice (`close_date`, `next_due` or `expiration_date` on/after today), the same predicate as `fit-inventory.ts`.
- Sample: 30 `not_found` rows, drawn by a seeded shuffle (mulberry32, seed 20260905) over the population sorted by `opportunity_number`, so the list reproduces for the same seed and population. Each row reports its prefix class (PA / PAR / PAS / RFA / NOT / non-NIH), agency, Simpler status, posted date, `additional_info_url`, the URL `guideUrlFor()` derives, and whether that equals the stored `guide_url`.
- Fetch: 10 of the 30, chosen round-robin across family / status / prefix strata so every stratum is exercised; GET only, ≥ 700 ms apart (`AsyncRateLimiter`), browser-like User-Agent, redirects followed; hosts restricted to `*.nih.gov` and `*.simpler.grants.gov`. Each response records HTTP status, final URL, `<title>`, whether the sync's heuristic matches, whether the notice number appears on the page, then classifies.
- Hand-checks (`--url`): the classic path for `PAS-27-028`; the classic path for `PAR-27-026` (an `ok` FY27 row, positive control); the two Simpler-hosted announcements found for `PAR-27-064` and `RFA-CA-27-020`.
- Two confirmations outside the script, both read-only: `GET /v1/opportunities/{id}` on the Simpler API (the client already in `src/lib/ingestion/simpler-grants/client.ts`, `X-API-Key`) for PAR-27-064, PAS-27-028 and the forecast RFA-RM-28-002; and `parseNihGuide()` run locally on the two saved announcement files.

## 3. The 30 sampled prefixes

Full table in appendix § 2. Prefix classes: **RFA 20, PAR 9, PA 1** (no PAS, NOT or non-NIH in the `not_found` set — `not_found` is only ever stamped on rows the sync targets). By the data markers: 16 forecasts, 3 CDC `-18-000` placeholders, 11 posted NIH notices, i.e. 19 class (iii) / 11 class (ii) / 0 class (i) — the same 63 / 36 / 0 split as the whole population. `additional_info_url` is null for 29 of 30 (the 30th is the literal string `Not Applicable`); every derived URL equals the stored `guide_url`; all were last fetched 2026-09-03 or 2026-09-05, so these are current results, not stale stamps.

## 4. The hand-checked URLs

Full table in appendix § 3 (14 rows: the 10 sampled fetches and 4 `--url` checks).

| # | Notice | URL requested | HTTP | Title | Heuristic | Class |
|---|---|---|---|---|---|---|
| 1 | RFA-DP-27-030 (CDC forecast) | classic `rfa-files/` | 404 | Page not found \| Grants & Funding | no | (iii) forecast |
| 2 | RFA-NS-26-013 (NIH forecast) | classic `rfa-files/` | 404 | Page not found | no | (iii) forecast |
| 3 | PAR-27-064 (posted 2026-06-16) | classic `pa-files/` | 404 | Page not found | no | (ii) |
| 4 | RFA-CA-27-020 (posted 2026-05-21) | classic `rfa-files/` | 404 | Page not found | no | (ii) |
| 5 | PAR-28-060 (NIH forecast) | classic `pa-files/` | 404 | Page not found | no | (iii) forecast |
| 6 | RFA-IP-18-000 (CDC placeholder, posted 2023-10-20, closes 2030-09-30) | classic `rfa-files/` | 404 | Page not found | no | (iii) placeholder |
| 7 | PA-28-047 (NIH forecast) | classic `pa-files/` | 404 | Page not found | no | (iii) forecast |
| 8 | RFA-DP-27-036 (CDC forecast) | classic `rfa-files/` | 404 | Page not found | no | (iii) forecast |
| 9 | RFA-AI-27-017 (NIH forecast) | classic `rfa-files/` | 404 | Page not found | no | (iii) forecast |
| 10 | PAR-27-062 (posted 2026-05-27) | classic `pa-files/` | 404 | Page not found | no | (ii) |
| 11 | PAS-27-028 (posted 2026-06-09; never fetched because `guideUrlFor()` → null) | classic `pa-files/` | 404 | Page not found | no | (ii) |
| 12 | PAR-27-026 (`ok` row, control) | classic `pa-files/` | 200 | PAR-27-026: Avant Garde/Avenir Awards … | yes | parses |
| 13 | PAR-27-064 | Simpler attachment `…/PAR-27-064-Full-Announcement.html` | 200 | PAR-27-064: NIAID Clinical Trial Implementation Cooperative Agreement (U01 Clinical Trial Required) | yes | parses |
| 14 | RFA-CA-27-020 | Simpler attachment `…/RFA-CA-27-020-Full-Announcement.html` | 200 | RFA-CA-27-020: Advanced Development of Informatics Technologies for Cancer Research and Management (U24 Clinical Trial Optional) | yes | parses |

What the Simpler-hosted announcements look like: `text/html`, ~140 KB, the Guide's own markup — 22 `datalabel` / 26 `datacolumn` divs, 158–161 `data-section-code` attributes, headings "Part 1. Overview Information · Key Dates · Part 2. Full Text of Announcement · Section I. Notice of Funding Opportunity Description · Section II … Section III …", the "Application Due Dates | Review and Award Cycles" table and the "Clinical Trial?" row. `parseNihGuide()` on the saved files, unchanged:

| | PAR-27-064 | RFA-CA-27-020 |
|---|---|---|
| activityCode | U01 | U24 |
| postedDate / openDate | 2026-06-16 / 2026-09-05 | 2026-05-21 / 2026-06-01 |
| cycles parsed | 18 (first due 2026-10-05, review March 2027, council May 2027, start July 2027) | 4 (first due 2026-07-01) |
| expirationDate | 2029-07-06 | 2026-10-20 |
| reissueOf | — | RFA-CA-24-018 |
| clinicalTrial | required | optional |

Simpler API detail records (`GET /v1/opportunities/{opportunity_id}`, the id already stored in `source_opportunity_id`): PAR-27-064 → 1 attachment `PAR-27-064-Full-Announcement.html` (text/html, 142,664 B); PAS-27-028 → 1 attachment `PAS-27-028-Full-Announcement.html` (120,885 B); RFA-RM-28-002 (forecast) → 0 attachments. The search endpoint the nightly sync uses does not return `attachments`, and both the cron route and the in-app sync pass `enrichWithDetailFetch: false`, which is why `raw_payload_json` never contains them.

## 5. Proposed fix per class

### Class (iii) — Fix A: stop targeting rows that cannot have a Guide page (215 rows; no network gain, but stops 215 wasted 404s a week and makes the status honest)

- `src/lib/services/nih-guide-sync.ts`, candidate query: add `forecasted = false` (or drop `forecasted` rows when building `due`). Forecasts have no Guide page and no Simpler attachment; when Simpler flips one to `posted`, `updated_at > guide_fetched_at` already re-queues it, so nothing is lost. Effect: 199 of the 341 (plus the 2 `FOR-` never-fetched rows, which `guideUrlFor()` already skips) leave the retry loop.
- `src/lib/ingestion/nih-guide/client.ts`, `guideUrlFor()`: require the Guide number shape — `^(RFA)-[A-Z]{2}-\d{2}-\d{3}$` and `^(PA|PAR|PAS)-\d{2}-\d{3}$` — and return `null` for `-\d{2}-000$` placeholders. Effect: the 15 CDC `RFA-XX-18-000` umbrella numbers and HHS-OPHS `PA-FPH-27-001` / `PA-EAA-26-001` / `PA-PHE-26-001` (three-letter office codes, not ICs) stop being fetched. The sync's `opportunity_number.like.PA-%` candidate filter can stay; the URL function is the single gate.
- Optional, for PR 0.5's migration: widen the `guide_fetch_status` CHECK with `'not_applicable'` and stamp it for rows the sync deliberately skips (forecasts, placeholders, non-Guide numbers), so INVENTORY § 4 and the data-sources page stop reporting them as failures. If that is not wanted, INVENTORY's `guide_not_found` should be computed as `not_found AND NOT forecasted`.

### Class (ii) — Fix B: fall back to the Simpler-hosted announcement (124 rows now, and nearly every NOFO NIH posts from here on)

- `src/lib/ingestion/nih-guide/client.ts`: add `PAS-` to the classic path (`/^PA[RS]?-/` → `pa-files/`; the three `ok` PAS-25 rows reached exactly that path through `additional_info_url`, which Simpler stopped populating for 2026 notices). Add `guideAttachmentUrl(attachments, number)` that picks the `attachments[]` entry whose `file_name` matches `^<number>-Full-Announcement\.html$` (case-insensitive) with `mime_type` `text/html` and returns its `download_path`.
- `src/lib/services/nih-guide-sync.ts`: when the classic path returns `not_found` for a **posted** row (after Fix A only posted, well-formed numbers get here), call `createSimplerGrantsClient().getOpportunity(row.source_opportunity_id)` (both exist today), resolve the attachment URL, and run the *same* `fetchNihGuideHtml` + `parseNihGuide` on it. Persist the attachment URL in `guide_url` so the 7-day refresh goes straight to `files.simpler.grants.gov` (no second Simpler call), and merge `attachments` into `raw_payload_json` while the detail record is in hand. Keep the 700 ms limiter around both hosts. Cost: one Simpler GET per affected notice, once — ~124 now, then ~40–60 a month. Rejected alternative: turning `enrichWithDetailFetch` back on in the nightly Simpler sync (it was switched off because enriching thousands of notices exceeds the function limit; the targeted call is bounded by the number of misses).
- Effect: the 124 posted NIH `not_found` rows and the never-fetched `PAS-27-028` become `ok`; validated on 2 of 2 (18 and 4 receipt cycles, expiration, reissue and clinical-trial designation all parsed with no parser change). `fetchNihGuideHtml` needs no change — the heuristic passes on the attachment. Add `--source` reporting (`nih_guide` vs `simpler_attachment`) to `scripts/backfill-nih-guide.ts` output so the first run can be eyeballed.

### Class (i) — no fix

The heuristic never triggered a false `not_found` in this sample: every 404 is a real 404 (the Guide's error page now returns status 404 with title "Page not found | Grants & Funding", so the soft-404 comment in `fetchNihGuideHtml` is historical), and every 200 contained "Key Dates". Leave it.

## 6. What PR 0.5 should build on

1. **Land Fix A + Fix B first** (as a small PR before, or as the first commit of, PR 0.5), then run `backfill-nih-guide --force` over the open posted NIH rows. Otherwise the sectioned-text acceptance ("≥ 90 % of `ok` notices in a 50-notice sample") is measured on a corpus that is 88 % FY22–FY25 notices, and the fit engine sees no Guide text for notices posted since November 2025.
2. **One parser, two hosts.** The Simpler-hosted announcement is byte-for-byte the Guide template (`datalabel`/`datacolumn`, `data-section-code`, Part 1 / Part 2 / Section I–VII headings), so `parseGuideSections`, `parseClinicalTrialDesignation` and `parseProgramDivision` need no host-specific branch. Use `PAR-27-064-Full-Announcement.html` (PAR, CT required, 18 cycles) and `RFA-CA-27-020-Full-Announcement.html` (RFA, reissue, CT optional) as two of the three HTML fixtures; take the BESH fixture from an `ok` classic page. Record the source host in a `guide_source` column (`'nih_guide' | 'simpler_attachment'`) or derive it from `guide_url` — `guide_html_hash` works the same for both.
3. **Coverage ceiling.** After the fixes, Guide text exists for ≈ 440 open notices (all posted NIH-Guide numbers) and can never exist for ≈ 230 forecasts and ≈ 650 non-NIH notices. PR 1.5's opportunity profile must fall back to Simpler's `summary_description` (median 1,023 chars) for those, and forecasts should be re-profiled when they flip to posted (the `updated_at` re-queue covers it).
4. **Retry cadence.** With forecasts and placeholders excluded, the weekly `not_found` retry is left for the rare posted notice whose attachment is not yet published; keep it at 7 days.

## 7. Reproduce

```
npm run fit:guide-diagnostics                       # population + 30-row sample, no network
npm run fit:guide-diagnostics -- --sample 30 --fetch 10 \
  --url https://grants.nih.gov/grants/guide/pa-files/PAS-27-028.html \
  --url https://grants.nih.gov/grants/guide/pa-files/PAR-27-026.html \
  --url https://files.simpler.grants.gov/opportunities/81895450-caf7-48ab-bab4-b80f0d74e3b1/attachments/89fd3002-0a0a-43ff-9a18-a94ede94778d/PAR-27-064-Full-Announcement.html \
  --url https://files.simpler.grants.gov/opportunities/21641587-9295-49dc-811b-95337df4af5c/attachments/3e265edd-9e45-4b63-8761-312a02b836cb/RFA-CA-27-020-Full-Announcement.html
```

`--seed N` changes the sample; `--out path.md` also writes the report to a file. The sample drifts as notices open and close; the appendix records the exact list used here.

---

## Appendix — verbatim script output (2026-09-05)

Generated 2026-09-05T21:47:26.506Z by `npm run fit:guide-diagnostics` (seed 20260905, sample 30, fetch 10). Read-only. "Open" notices = close_date, next_due or expiration_date on/after 2026-09-05.

### 1. Population (open notices)

| guide_fetch_status | count |
|---|---|
| ok | 313 |
| not_found | 341 |
| never fetched | 652 |
| error | 0 |
| total | 1306 |

#### 1a. Status × opportunity_number prefix class

| status | prefix class | count |
|---|---|---|
| never | non-NIH | 651 |
| ok | PAR | 227 |
| not_found | RFA | 212 |
| not_found | PAR | 115 |
| ok | RFA | 43 |
| ok | PA | 40 |
| not_found | PA | 14 |
| ok | PAS | 3 |
| never | PAS | 1 |

#### 1b. not_found × agency family × Simpler status × fiscal year in the number

| family | Simpler status | FY | count |
|---|---|---|---|
| NIH | posted | 27 | 105 |
| NIH | forecast | 28 | 81 |
| NIH | forecast | 27 | 48 |
| NIH | forecast | 26 | 41 |
| CDC | forecast | 27 | 28 |
| CDC | posted | 18 | 15 |
| NIH | posted | 26 | 15 |
| NIH | posted | 25 | 3 |
| CDC | posted | 26 | 2 |
| NIH | forecast | 29 | 1 |
| NIH | posted | 28 | 1 |
| other HHS | posted | 27 | 1 |

#### 1c. not_found · additional_info_url present?

| additional_info_url | count |
|---|---|
| null / empty | 340 |
| present | 1 |

#### 1d. ok × fiscal year in the number (for contrast)

| FY | count |
|---|---|
| 25 | 213 |
| 24 | 63 |
| 26 | 19 |
| 23 | 11 |
| 27 | 5 |
| 22 | 2 |

#### 1e. never fetched · would the sync target it, and would guideUrlFor() give a URL?

| sync candidate | guideUrlFor() | family | Simpler status | count |
|---|---|---|---|---|
| no | null | non-HHS | posted | 512 |
| no | null | other HHS | forecast | 72 |
| no | null | CDC | forecast | 27 |
| no | null | CDC | posted | 15 |
| no | null | non-HHS | forecast | 12 |
| no | null | other HHS | posted | 11 |
| yes | null | NIH | forecast | 2 |
| yes | null | NIH | posted | 1 |

Never-fetched rows the sync targets or that carry a Guide-style number (3):

| opportunity_number | agency_code | Simpler status | posted | guideUrlFor() |
|---|---|---|---|---|
| FOR-AR-26-008 | HHS-NIH11 | forecast | 2025-06-12 | null |
| FOR-AT-25-007 | HHS-NIH11 | forecast | 2025-07-08 | null |
| PAS-27-028 | HHS-NIH11 | posted | 2026-06-09 | null |

Never-fetched rows by raw number prefix (top 15):

| raw prefix | count |
|---|---|
| (none) | 223 |
| HRSA | 51 |
| CDC | 42 |
| O | 38 |
| HHS | 30 |
| USDA | 30 |
| 26 | 21 |
| 23 | 16 |
| PD | 16 |
| DE | 15 |
| 24 | 14 |
| 25 | 11 |
| NNH25ZDA001N | 11 |
| NOAA | 11 |
| 22 | 8 |

### 2. Sample of 30 not_found notices (seed 20260905)

| # | opportunity_number | prefix | agency_code | Simpler status | posted | FY | additional_info_url | guideUrlFor() | stored guide_url | last fetched |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | RFA-DP-27-030 | RFA | HHS-CDC-HHSCDCERA | forecast | 2026-07-28 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-DP-27-030.html | same | 2026-09-05 |
| 2 | RFA-NS-26-013 | RFA | HHS-NIH11 | forecast | 2026-02-20 | 26 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-NS-26-013.html | same | 2026-09-05 |
| 3 | RFA-AI-27-017 | RFA | HHS-NIH11 | forecast | 2026-04-09 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-AI-27-017.html | same | 2026-09-05 |
| 4 | PAR-27-064 | PAR | HHS-NIH11 | posted | 2026-06-16 | 27 | null | https://grants.nih.gov/grants/guide/pa-files/PAR-27-064.html | same | 2026-09-05 |
| 5 | RFA-DP-27-036 | RFA | HHS-CDC-HHSCDCERA | forecast | 2026-07-24 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-DP-27-036.html | same | 2026-09-05 |
| 6 | RFA-CA-27-020 | RFA | HHS-NIH11 | posted | 2026-05-21 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-CA-27-020.html | same | 2026-09-05 |
| 7 | RFA-CE-27-017 | RFA | HHS-CDC-HHSCDCERA | forecast | 2026-07-02 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-CE-27-017.html | same | 2026-09-05 |
| 8 | RFA-HD-27-001 | RFA | HHS-NIH11 | forecast | 2025-09-23 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-HD-27-001.html | same | 2026-09-05 |
| 9 | PAR-27-062 | PAR | HHS-NIH11 | posted | 2026-05-27 | 27 | null | https://grants.nih.gov/grants/guide/pa-files/PAR-27-062.html | same | 2026-09-05 |
| 10 | PAR-28-060 | PAR | HHS-NIH11 | forecast | 2026-08-24 | 28 | null | https://grants.nih.gov/grants/guide/pa-files/PAR-28-060.html | same | 2026-09-05 |
| 11 | RFA-DK-27-124 | RFA | HHS-NIH11 | forecast | 2025-09-18 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-DK-27-124.html | same | 2026-09-03 |
| 12 | RFA-IP-18-000 | RFA | HHS-CDC-HHSCDCERA | posted | 2023-10-20 | 18 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-IP-18-000.html | same | 2026-09-03 |
| 13 | RFA-OH-27-050 | RFA | HHS-CDC-HHSCDCERA | forecast | 2026-07-31 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-OH-27-050.html | same | 2026-09-05 |
| 14 | RFA-CA-27-005 | RFA | HHS-NIH11 | posted | 2026-08-31 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-CA-27-005.html | same | 2026-09-05 |
| 15 | PAR-26-052 | PAR | HHS-NIH11 | forecast | 2025-08-28 | 26 | null | https://grants.nih.gov/grants/guide/pa-files/PAR-26-052.html | same | 2026-09-03 |
| 16 | RFA-AI-27-014 | RFA | HHS-NIH11 | posted | 2026-09-01 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-AI-27-014.html | same | 2026-09-05 |
| 17 | PAR-26-116 | PAR | HHS-NIH11 | posted | 2025-12-08 | 26 | null | https://grants.nih.gov/grants/guide/pa-files/PAR-26-116.html | same | 2026-09-05 |
| 18 | PA-28-047 | PA | HHS-NIH11 | forecast | 2026-08-13 | 28 | null | https://grants.nih.gov/grants/guide/pa-files/PA-28-047.html | same | 2026-09-05 |
| 19 | RFA-DC-28-007 | RFA | HHS-NIH11 | forecast | 2026-05-12 | 28 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-DC-28-007.html | same | 2026-09-05 |
| 20 | RFA-PS-18-000 | RFA | HHS-CDC-HHSCDCERA | posted | 2023-10-20 | 18 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-PS-18-000.html | same | 2026-09-03 |
| 21 | PAR-26-115 | PAR | HHS-NIH11 | posted | 2025-12-10 | 26 | null | https://grants.nih.gov/grants/guide/pa-files/PAR-26-115.html | same | 2026-09-05 |
| 22 | RFA-GH-18-000 | RFA | HHS-CDC-HHSCDCERA | posted | 2023-10-13 | 18 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-GH-18-000.html | same | 2026-09-03 |
| 23 | RFA-HD-27-007 | RFA | HHS-NIH11 | posted | 2026-05-19 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-HD-27-007.html | same | 2026-09-05 |
| 24 | RFA-DK-27-147 | RFA | HHS-NIH11 | posted | 2026-05-20 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-DK-27-147.html | same | 2026-09-05 |
| 25 | RFA-CE-27-016 | RFA | HHS-CDC-HHSCDCERA | forecast | 2026-07-10 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-CE-27-016.html | same | 2026-09-05 |
| 26 | RFA-AG-26-018 | RFA | HHS-NIH11 | forecast | 2025-11-20 | 26 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-AG-26-018.html | same | 2026-09-05 |
| 27 | PAR-27-007 | PAR | HHS-NIH11 | forecast | 2026-03-16 | 27 | Not Applicable | https://grants.nih.gov/grants/guide/pa-files/PAR-27-007.html | same | 2026-09-05 |
| 28 | PAR-26-138 | PAR | HHS-NIH11 | posted | 2026-02-05 | 26 | null | https://grants.nih.gov/grants/guide/pa-files/PAR-26-138.html | same | 2026-09-05 |
| 29 | RFA-NS-27-001 | RFA | HHS-NIH11 | posted | 2026-02-09 | 27 | null | https://grants.nih.gov/grants/guide/rfa-files/RFA-NS-27-001.html | same | 2026-09-05 |
| 30 | PAR-27-117 | PAR | HHS-NIH11 | forecast | 2026-07-28 | 27 | null | https://grants.nih.gov/grants/guide/pa-files/PAR-27-117.html | same | 2026-09-05 |

Sample by prefix class:

| prefix class | count |
|---|---|
| RFA | 20 |
| PAR | 9 |
| PA | 1 |

### 3. Fetched 14 URLs (GET, ≥ 700 ms apart)

| # | notice | URL | HTTP | redirected to | title | heuristic | number on page | class | note |
|---|---|---|---|---|---|---|---|---|---|
| 1 | RFA-DP-27-030 | https://grants.nih.gov/grants/guide/rfa-files/RFA-DP-27-030.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (iii) no Guide page | HTTP 404; Simpler forecast, not yet in the Guide |
| 2 | RFA-NS-26-013 | https://grants.nih.gov/grants/guide/rfa-files/RFA-NS-26-013.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (iii) no Guide page | HTTP 404; Simpler forecast, not yet in the Guide |
| 3 | PAR-27-064 | https://grants.nih.gov/grants/guide/pa-files/PAR-27-064.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (ii) URL pattern | HTTP 404 for a posted NIH notice |
| 4 | RFA-CA-27-020 | https://grants.nih.gov/grants/guide/rfa-files/RFA-CA-27-020.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (ii) URL pattern | HTTP 404 for a posted NIH notice |
| 5 | PAR-28-060 | https://grants.nih.gov/grants/guide/pa-files/PAR-28-060.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (iii) no Guide page | HTTP 404; Simpler forecast, not yet in the Guide |
| 6 | RFA-IP-18-000 | https://grants.nih.gov/grants/guide/rfa-files/RFA-IP-18-000.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (iii) no Guide page | HTTP 404; -000 placeholder number |
| 7 | PA-28-047 | https://grants.nih.gov/grants/guide/pa-files/PA-28-047.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (iii) no Guide page | HTTP 404; Simpler forecast, not yet in the Guide |
| 8 | RFA-DP-27-036 | https://grants.nih.gov/grants/guide/rfa-files/RFA-DP-27-036.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (iii) no Guide page | HTTP 404; Simpler forecast, not yet in the Guide |
| 9 | RFA-AI-27-017 | https://grants.nih.gov/grants/guide/rfa-files/RFA-AI-27-017.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (iii) no Guide page | HTTP 404; Simpler forecast, not yet in the Guide |
| 10 | PAR-27-062 | https://grants.nih.gov/grants/guide/pa-files/PAR-27-062.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (ii) URL pattern | HTTP 404 for a posted NIH notice |
| 11 | (--url) PAS-27-028 | https://grants.nih.gov/grants/guide/pa-files/PAS-27-028.html | 404 | (none) | Page not found \| Grants &amp; Funding | no | no | (ii) URL pattern | HTTP 404 for a posted NIH notice |
| 12 | (--url) PAR-27-026 | https://grants.nih.gov/grants/guide/pa-files/PAR-27-026.html | 200 | (none) | PAR-27-026: Avant Garde/Avenir Awards for Investigators Conducting High Risk/High Reward R | yes | yes | (iv) parses | Guide page exists and passes the heuristic today (weekly retry heals it) |
| 13 | (--url) PAR-27-064 | https://files.simpler.grants.gov/opportunities/81895450-caf7-48ab-bab4-b80f0d74e3b1/attachments/89fd3002-0a0a-43ff-9a18-a94ede94778d/PAR-27-064-Full-Announcement.html | 200 | (none) | PAR-27-064: NIAID Clinical Trial Implementation Cooperative Agreement (U01 Clinical Trial  | yes | yes | (iv) parses | Simpler-hosted announcement passes the heuristic |
| 14 | (--url) RFA-CA-27-020 | https://files.simpler.grants.gov/opportunities/21641587-9295-49dc-811b-95337df4af5c/attachments/3e265edd-9e45-4b63-8761-312a02b836cb/RFA-CA-27-020-Full-Announcement.html | 200 | (none) | RFA-CA-27-020: Advanced Development of Informatics Technologies for Cancer Research and Ma | yes | yes | (iv) parses | Simpler-hosted announcement passes the heuristic |

Class tally:

| class | count |
|---|---|
| (iii) no Guide page | 7 |
| (ii) URL pattern | 4 |
| (iv) parses | 3 |

## Validator amendments (2026-09-05)

- The single HHS-OPHS row is `PA-FPH-27-001` (posted, closes 2027-01-11); `PA-FPT-26-001` closed 2026-08-19 and is not in the open corpus.
- "`raw_payload_json` never contains attachments" holds for the cron and the data-sources UI (`enrichWithDetailFetch: false`); 13 open rows written through the pipeline action do carry `attachments`, and two of them — `RFA-DK-26-309` (`not_found`) and `RFA-DK-26-308` (`ok`) — already store the `<number>-Full-Announcement.html` attachment: a stored, zero-network confirmation of Fix B's premise.
- **The retry cadence is nightly, not weekly.** `nih-guide-sync.ts` treats `updated_at > guide_fetched_at` as "Simpler changed it", but the `set_updated_at` BEFORE UPDATE trigger stamps the Guide sync's own row 16–181 ms after the JS-side `guide_fetched_at`, so every fetched row is due every night; with `order posted_date desc` + `limit 400`, the same newest ~400 rows (all 341 `not_found`) are re-fetched nightly — ~341 wasted 404s a night, 85% of the budget. Pre-existing and outside 0.5a's scope; PR 0.5 must fix the re-queue predicate (compare against a Simpler-owned timestamp) before its `--force` / `guide_html_hash` plan means anything.
- The ≈ 438 / ≈ 440 estimate rests on n = 3 API checks plus the two stored attachments; PR 0.5's backfill should print the actual attachment hit rate over the 124 posted `not_found` rows.
- Fix B mechanics: the sync recomputes the URL from `guideUrlFor()` every run and never reads stored `guide_url`; it must prefer a stored `files.simpler.grants.gov` URL before the classic path, and treat a 404 on a stored Simpler URL as "re-resolve via `getOpportunity`" (attachment UUIDs can change), not as `not_found`. `SimplerOpportunityHit` needs a typed `attachments: { file_name, mime_type, download_path }[]`.
