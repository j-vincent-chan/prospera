-- PR 0.7 · Self-declared axes: what an investigator says about how they do
-- research — captured in onboarding and the edit sheet, and derived from the
-- intake sheet by the import wizard (spec §5 "Self-declared", Appendix B rows
-- self_declared_*). Biosketches are not_requested for every investigator and
-- only 5 of 144 have a trial, so this is the near-term signal for the
-- clinical, population and health-systems families.
--
-- self_declared_axes is NULL until the person answers; signal-mapping's
-- self_declared_present keys on that. Ratings are 0–3 per paradigm family
-- (taxonomy.json › paradigm.families); materials are taxonomy.json ›
-- materials.kinds ids; capabilities is reserved (no UI yet). Aspirations open
-- Exploratory and never raise a tier above it (spec §5); do_not_suggest is the
-- investigator's explicit exclusion (spec §9, "Exclude"). title_series is the
-- UCSF series (In Residence, Ladder Rank, Clinical X, HS Clinical, Adjunct …)
-- — a clinical-role prior, not evidence (spec §5). The ORCID iD stays in the
-- existing investigators.orcid column; the orcid source row records where it
-- came from in meta.note (src/lib/investigators/record-orcid.ts, the same
-- shape scripts/fit-fix-profile-ids.ts --set-orcid writes).
--
-- RLS is already enabled on investigators (authenticated: full access, MVP).

ALTER TABLE public.investigators
  ADD COLUMN IF NOT EXISTS self_declared_axes JSONB,
  ADD COLUMN IF NOT EXISTS aspirations TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS do_not_suggest TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS title_series TEXT,
  ADD COLUMN IF NOT EXISTS degrees TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.investigators.self_declared_axes IS
  '{paradigm: {<family>: 0–3}, materials: [<materials kind>], capabilities: [], updated_at}. Families and kinds are taxonomy.json ids (paradigm.families, materials.kinds); a family absent from paradigm was left unrated. NULL = never answered. Reliability 0.9 for current practice (aggregation.reliability.self_declared_current).';
COMMENT ON COLUMN public.investigators.aspirations IS
  'Free-text "Directions I''m moving toward", one entry per line as entered. Opens Exploratory; never raises a tier above it (spec §5, §6).';
COMMENT ON COLUMN public.investigators.do_not_suggest IS
  'Paradigm family ids the investigator asked never to be suggested for. Hard exclude (spec §9).';
COMMENT ON COLUMN public.investigators.title_series IS
  'UCSF academic series from the intake sheet''s "Rank Series" (In Residence, Ladder Rank, Clinical X, Health Sciences Clinical, Adjunct, Professional Researcher) or the edit sheet. A clinical-role prior, not evidence (spec §5 Profiles row); rank itself stays in investigators.rank.';
COMMENT ON COLUMN public.investigators.degrees IS
  'Degrees as entered (MD, PhD, DO, …). Feeds the clinical-role characteristic (spec §5) and the "MD required" eligibility gate (spec §9).';
