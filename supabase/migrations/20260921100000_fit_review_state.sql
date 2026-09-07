-- PR 3.3 · Strategist review queue (/team/fit-review).
--
-- Three additions, all idempotent, written and never applied by a script
-- (CLAUDE.md); until the coordinator applies it the queue answers
-- "unavailable" for the review state and the never-reappear check falls back
-- to comparing the evidence itself.
--
--   fit_adjudications.reviewed_by / reviewed_at
--       "Mark reviewed" on an AI-flagged lead or an ungrounded dissent. PR 3.1
--       stored no review state — the review item lives inside
--       `reconciliation`, which the sweep re-derives — so the strategist's
--       decision needs its own columns on the pair's adjudication row. A
--       reviewed pair leaves the queue and stays out of it until the pair is
--       judged again (a new row at new profile versions is unreviewed).
--
--   fit_corrections.evidence_hash
--       The key of "rejected items never reappear for the same evidence"
--       (PR 3.3's acceptance). PR 3.1 compared the evidence itself
--       (`sameEvidence`: the id set and the quote), which needs every prior
--       row in memory; the hash is the same comparison as one indexed
--       column, so the judge and the one-click confirmation can ask the
--       database "was this rejected?" directly. Computed by
--       `evidenceHash()` in src/lib/fit/judge/corrections.ts over the ids
--       (sorted), the quote, the section, `via` and the dismissal's
--       suggestion id — never over the confidence or the pair, so the same
--       argument from a second pair hashes the same.
--
--   fit_corrections.rescored_at
--       When the affected pairs were re-scored after the correction was
--       applied. An investigator correction re-scores that one investigator
--       in the approve action; a notice correction re-scores every
--       investigator against the notice — synchronously when the roster
--       slice is at or under FIT_RESCORE_SYNC_MAX_INVESTIGATORS
--       (src/lib/fit/service.ts), else left NULL for the nightly fit-results
--       prelude, which sweeps notices with applied-but-unrescored
--       corrections before the roster order.

-- ---------------------------------------------------------------------------
-- fit_adjudications: the review state
-- ---------------------------------------------------------------------------

ALTER TABLE public.fit_adjudications
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.fit_adjudications.reviewed_by IS
  'The auth user (profiles.id, as fit_labels.labeler and fit_corrections.decided_by) who marked the pair''s review item reviewed on /team/fit-review (PR 3.3); NULL while it is still in the queue.';
COMMENT ON COLUMN public.fit_adjudications.reviewed_at IS
  'When the pair''s review item (an AI-flagged lead or an ungrounded dissent — reconciliation.result.review.kind) was marked reviewed. A pair judged again at new profile versions writes a new row, which is unreviewed, so a lead raised by fresh evidence comes back.';

-- The queue asks for the reviewed pairs of a bounded id set, so the index is
-- on the flag, not on the pair.
CREATE INDEX IF NOT EXISTS idx_fit_adjudications_reviewed
  ON public.fit_adjudications (investigator_id, reviewed_at DESC)
  WHERE reviewed_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- fit_corrections: the evidence hash and the re-score stamp
-- ---------------------------------------------------------------------------

ALTER TABLE public.fit_corrections
  ADD COLUMN IF NOT EXISTS evidence_hash TEXT,
  ADD COLUMN IF NOT EXISTS rescored_at TIMESTAMPTZ;

COMMENT ON COLUMN public.fit_corrections.evidence_hash IS
  '16-hex digest of what the correction rests on (evidenceHash() in src/lib/fit/judge/corrections.ts): the evidence ids sorted, the verbatim quote, the section, `via`, and the dismissal''s suggestion id. Two proposals of the same edit on the same argument hash alike, whichever pair raised them, so a rejection here blocks every re-proposal (PR 3.3: "rejected items never reappear for the same evidence"). NULL on rows written before this migration — those fall back to comparing the evidence itself.';
COMMENT ON COLUMN public.fit_corrections.rescored_at IS
  'When the pairs an applied correction touches were re-scored. An investigator correction is re-scored in the approve action; a notice correction re-scores every investigator against the notice — in the action when the count is at or under FIT_RESCORE_SYNC_MAX_INVESTIGATORS, else NULL until the nightly fit-results prelude sweeps it (PR 3.3 acceptance: "approving a notice correction re-scores every investigator against that notice within the nightly job").';

-- "Was this exact edit rejected on this exact argument?" — the judge's and the
-- one-click confirmation's lookup before proposing.
CREATE INDEX IF NOT EXISTS idx_fit_corrections_evidence_hash
  ON public.fit_corrections (target, target_id, path, evidence_hash)
  WHERE evidence_hash IS NOT NULL;

-- The nightly prelude's selection: applied notice corrections whose re-score
-- has not run yet, oldest decision first.
CREATE INDEX IF NOT EXISTS idx_fit_corrections_awaiting_rescore
  ON public.fit_corrections (target, decided_at)
  WHERE status = 'applied' AND rescored_at IS NULL;
