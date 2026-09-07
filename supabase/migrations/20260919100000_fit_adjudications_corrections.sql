-- PR 3.1 · Stage 8: blind pass, skeptic, reconciler (spec §7 stage 8, §16).
--
-- Three things:
--
--   fit_adjudications    one row per judged investigator–notice pair per profile
--                        version: the validated outputs of the three model
--                        passes (src/lib/fit/judge/*) and the reconciliation
--                        the code derived from them (the §16 table). The row
--                        is the stage-8 cache: a pair is judged once per
--                        `profile_versions` (content hashes of the two stored
--                        profiles plus the taxonomy and judge versions), and
--                        the nightly fit-results sweep re-derives the final
--                        tier from the stored row (pure `applyAdjudication`)
--                        until either profile changes, when the pair is due
--                        again. Written by /api/cron/fit-judge and
--                        scripts/fit-judge.ts --write; never by a page.
--
--   fit_corrections      the model's (later: an investigator's or strategist's)
--                        proposed corrections to one input of a stored profile
--                        — "investigator.design.rct 0.10 → 0.70, NCT… lists
--                        this person as PI" — with the evidence that supports
--                        it. Investigator ingest misses and characteristics at
--                        high confidence are applied by the judge itself
--                        (status applied); investigator profile weights (D6) and
--                        every notice correction wait for a strategist
--                        (status proposed → applied | rejected, PR 3.3), applied
--                        provisionally for the pair that raised them meanwhile.
--                        Applying patches the stored profile JSON and re-scores
--                        the affected pairs (src/lib/fit/judge/corrections.ts).
--
--   investigator_fit_profiles.fit_judged_at
--                        when the judge last took this investigator; the
--                        nightly takes the roster never-judged first, then the
--                        oldest, within its model and time budgets.
--
-- Written, never applied by a script (CLAUDE.md); the coordinator applies it
-- before the merge deploys. Every statement is idempotent. Until it is applied
-- the judge cron answers 200 { skipped } and the sweep leaves adjudication NULL.

-- ---------------------------------------------------------------------------
-- fit_adjudications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fit_adjudications (
  investigator_id UUID NOT NULL REFERENCES public.investigators (id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  profile_versions JSONB NOT NULL,
  blind JSONB,
  skeptic JSONB,
  reconciliation JSONB NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (investigator_id, opportunity_id, profile_versions)
);

COMMENT ON TABLE public.fit_adjudications IS
  'Stage 8 (PR 3.1, spec §16): the blind pass, skeptic and reconciler outputs for one investigator–notice pair at one profile version, plus the reconciliation the code derived (tier after adjudication, caps, confidence, review item, corrections). One row per (pair, profile_versions); the newest row for a pair whose versions match the stored profiles is the live one.';
COMMENT ON COLUMN public.fit_adjudications.profile_versions IS
  '{ investigator: <content hash of the stored investigator profile>, opportunity: <content hash of the stored notice profile>, taxonomy: <taxonomy.json version>, judge: <judge module version> } — the cache key: a pair is judged once per value; a profile rebuild that changes nothing keeps the hash and the row.';
COMMENT ON COLUMN public.fit_adjudications.blind IS
  'BlindResult (src/lib/fit/judge/blind.ts): both prompt variants'' validated Call A / Call B outputs with the ids that were dropped, each variant''s verdict before and after the counter-case post-rule, the combined verdict (NULL when the variants disagree by two tiers or nothing usable came back), the scout''s latent-fit finding for a near-miss pair, and the evidence ids the pass was given. NULL when the pass could not run.';
COMMENT ON COLUMN public.fit_adjudications.skeptic IS
  'SkepticResult (src/lib/fit/judge/skeptic.ts): the strongest objection, its kind, whether it is gate-level and grounded in a cited item, the ids it rests on. NULL when the skeptic did not run (it runs on every provisional Strong and every blind-pass Strong).';
COMMENT ON COLUMN public.fit_adjudications.reconciliation IS
  'The reconciler''s validated output (agreement, explanation, corrections after validation, inexpressible insight, rationale, why_not) and the Reconciliation the code derived from the §16 table: row, tier before and after, caps added, confidence shown, review item, structured-miss flag, the corrections applied (auto or provisionally for this pair) with their fit_corrections ids.';
COMMENT ON COLUMN public.fit_adjudications.model IS
  'The FIT_MODEL_JUDGE model name the passes were made with.';

CREATE INDEX IF NOT EXISTS idx_fit_adjudications_opportunity
  ON public.fit_adjudications (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_fit_adjudications_investigator_created
  ON public.fit_adjudications (investigator_id, created_at DESC);

ALTER TABLE public.fit_adjudications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fit_adjudications_all_authenticated ON public.fit_adjudications;
CREATE POLICY fit_adjudications_all_authenticated ON public.fit_adjudications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- fit_corrections
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fit_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target TEXT NOT NULL CHECK (target IN ('investigator_profile', 'opportunity_profile')),
  target_id UUID NOT NULL,
  path TEXT NOT NULL,
  from_value JSONB,
  to_value JSONB,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  kind TEXT NOT NULL CHECK (kind IN ('ingest_miss', 'misread_requirement', 'profile_weight', 'characteristic')),
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('judge', 'investigator', 'strategist')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'rejected')),
  decided_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

COMMENT ON TABLE public.fit_corrections IS
  'Proposed corrections to one input field of a stored fit profile (PR 3.1, spec §16 "the model never emits a score; it proposes corrections to inputs"; PR 3.2 one-click confirmation; PR 3.3 review queue). Applying one patches the stored profile JSON and re-scores the affected pairs; rejecting one keeps it so the same evidence never reappears.';
COMMENT ON COLUMN public.fit_corrections.target IS
  'investigator_profile → investigator_fit_profiles (target_id = investigator_id); opportunity_profile → opportunity_fit_profiles (target_id = opportunity_id).';
COMMENT ON COLUMN public.fit_corrections.target_id IS
  'The investigator or notice whose stored profile the correction edits (no FK: it points at either table by `target`).';
COMMENT ON COLUMN public.fit_corrections.path IS
  'Dotted field path inside the stored profile JSON — design.rct, paradigm.recent.clinical_trials, characteristics.trial_pi_count, paradigm.required.human_biospecimen, design.required_any, eligibility.esi_only … (the known paths are listed in src/lib/fit/judge/corrections.ts).';
COMMENT ON COLUMN public.fit_corrections.from_value IS
  'The stored value at `path` when the correction was proposed (null for an absent weight or list entry); apply refuses when the stored value has moved since.';
COMMENT ON COLUMN public.fit_corrections.to_value IS
  'The proposed value: a weight in [0, 1], a list of vocabulary ids, a boolean, a count, a string — validated against the taxonomy for the path.';
COMMENT ON COLUMN public.fit_corrections.evidence IS
  '{ ids: [evidence ids the correction rests on], quote, section (a verbatim notice quote and the Guide section it verified in, for notice corrections), confidence: high | medium, why, pair: { investigator_id, opportunity_id } (the pair that raised it), dismissal_reason (PR 3.2) }.';
COMMENT ON COLUMN public.fit_corrections.kind IS
  'ingest_miss (a structured record the ingest missed or misread — auto-applied at high confidence), characteristic (a count or flag in characteristics — auto-applied at high confidence), profile_weight (an axis weight — strategist confirmation, D6), misread_requirement (a notice requirement — strategist confirmation before it applies globally).';
COMMENT ON COLUMN public.fit_corrections.proposed_by IS
  'judge (the stage-8 reconciler), investigator (the one-click confirmation, PR 3.2), strategist.';
COMMENT ON COLUMN public.fit_corrections.status IS
  'proposed → applied | rejected. A proposed investigator profile_weight or notice correction is applied provisionally for the pair that raised it until decided.';
COMMENT ON COLUMN public.fit_corrections.decided_by IS
  'The auth user (profiles.id, as fit_labels.labeler) who applied or rejected it; NULL for a judge auto-application.';

CREATE INDEX IF NOT EXISTS idx_fit_corrections_target_status
  ON public.fit_corrections (target, target_id, status);
CREATE INDEX IF NOT EXISTS idx_fit_corrections_status_created
  ON public.fit_corrections (status, created_at DESC);

ALTER TABLE public.fit_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fit_corrections_all_authenticated ON public.fit_corrections;
CREATE POLICY fit_corrections_all_authenticated ON public.fit_corrections
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- investigator_fit_profiles.fit_judged_at
-- ---------------------------------------------------------------------------

ALTER TABLE public.investigator_fit_profiles
  ADD COLUMN IF NOT EXISTS fit_judged_at TIMESTAMPTZ;

COMMENT ON COLUMN public.investigator_fit_profiles.fit_judged_at IS
  'When /api/cron/fit-judge last took this investigator (PR 3.1); NULL until the first run. The nightly takes the roster in fit_judged_at ASC NULLS FIRST, investigator_id order within its model and time budgets.';

CREATE INDEX IF NOT EXISTS idx_investigator_fit_profiles_fit_judged_at
  ON public.investigator_fit_profiles (fit_judged_at NULLS FIRST, investigator_id);

-- fit_results.caps gains the stage-8 cap ids (the column exists since PR 2.2).
COMMENT ON COLUMN public.fit_results.caps IS
  'CapId[]: every reason the tier was capped (paradigm_gate, unit_gate, design_required_unsupported, eligibility_unknown, low_profile_confidence, low_notice_confidence, readiness_far, runway_short, paradigm_gate_relaxed_*) — spec §9 — plus the stage-8 caps stage8_verdict (lowered to the blind verdict), stage8_objection (lowered by a grounded skeptic objection) and stage8_pending_confirmation (a rise held to one tier per cycle until a strategist confirms the correction) — spec §16.';
COMMENT ON COLUMN public.fit_results.adjudication IS
  'Stage 8 summary (PR 3.1): profile_versions, the blind verdict per variant, the skeptic objection, the reconciliation row, tier before / after, confidence shown, review item and the corrections applied — the compact form of the fit_adjudications row the sweep re-derives the tier from; NULL until the pair is judged.';
