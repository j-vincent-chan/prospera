-- PR 5.1 · Section roles.
--
-- The extractor used to decide which of its three section groups a block of
-- notice text belonged to from the block's NIH roman numeral ("II" -> group 2).
-- That is the one part of the pipeline a non-NIH announcement cannot satisfy:
-- an NSF solicitation's "IV. ELIGIBILITY INFORMATION" and a CDMRP Program
-- Announcement's "Eligibility Information" block carry the same *role* under
-- different names. Sections now carry that role, and `groupSections` routes on
-- it (src/lib/fit/profile/section-roles.ts).
--
-- No column changes: `roles` rides inside the objects already stored in
-- `guide_sections`. Rows written before this PR carry no `roles` key and need
-- no backfill -- `withRoles()` derives the same values at read time from the
-- section id and heading, and a round-trip test asserts the derived and stamped
-- values route identically (verified on all 512 stored notices).
--
-- Written, never applied by a script (CLAUDE.md); the coordinator applies it
-- before the merge deploys. The statement is idempotent.

COMMENT ON COLUMN public.funding_opportunities.guide_sections IS
  'Sectioned full text of the notice, parseGuideSections(): array of {part (1|2), section ("overview", "I", "II", "III", "III.3", "IV.2", "VII", "synopsis" …), heading (verbatim), text (one line per paragraph / list item), roles (PR 5.1)}. Part 1 keeps Announcement Type, Components of Participating Organizations and Funding Opportunity Purpose; Part 2 keeps Section I with its sub-headings, Section II rows, Section III minus the standard eligibility lists, Section IV clinical-trial / human-subjects items, Section VII scientific and peer-review contacts. NULL until the page is parsed; the plain-text notices (no headings) get section-level text only. roles is a LIST of "purpose" | "objectives" | "non_responsive" | "award_info" | "eligibility" | "human_subjects" | "review" | "contacts" | "team" | "synopsis" | "other" saying what the block is for, so the extractor routes on the role rather than on the NIH numbering and a non-NIH announcement can be sectioned the same way; a list, not a scalar, because the routing is not a partition (a Section I heading matching TEAM_HEADING is read by group 1 and group 3 both). Absent on rows written before PR 5.1: withRoles() derives the same values at read time from section and heading, so no backfill is needed.';
