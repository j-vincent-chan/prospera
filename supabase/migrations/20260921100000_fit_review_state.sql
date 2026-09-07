-- PR 3.3 · Strategist review queue (/team/fit-review).
--
-- Three additions and one back-fill, all idempotent, written and never applied by a script
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
--   fit_corrections.rescored_at / rescore_attempts
--       When the affected pairs were re-scored after the correction was
--       applied. An investigator correction re-scores that one investigator
--       in the approve action; a notice correction re-scores every
--       investigator against the notice — synchronously when the roster
--       slice is at or under FIT_RESCORE_SYNC_MAX_INVESTIGATORS
--       (src/lib/fit/service.ts), else left NULL for the nightly fit-results
--       prelude, which sweeps notices with applied-but-unrescored
--       corrections before the roster order. `rescore_attempts` counts the
--       prelude's failed passes on the row so a subject that errors every
--       night sinks below the ones that have not been tried, instead of
--       leading the order for ever.
--
--       The rows applied *before* this migration are back-filled as
--       re-scored: the judge re-scored each pair inline when it applied the
--       correction (an `auto` route patches the profile and re-scores that
--       pair in judgePair), and the approve action did not exist yet, so
--       nothing is owed on them. Without the back-fill the first nightly
--       after the migration would re-score every subject those rows name.

-- ---------------------------------------------------------------------------
-- fit_adjudications: the review state
-- ---------------------------------------------------------------------------

ALTER TABLE public.fit_adjudications
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.fit_adjudications.reviewed_by IS
  'The auth user who marked the pair''s review item reviewed on /team/fit-review (PR 3.3); NULL while it is still in the queue. No foreign key, as fit_labels.labeler and fit_corrections.decided_by: the decision is a record of who decided and outlives the account.';
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
  ADD COLUMN IF NOT EXISTS rescored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rescore_attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.fit_corrections.evidence_hash IS
  '16-hex digest of what the correction rests on (evidenceHash() in src/lib/fit/judge/corrections.ts): the evidence ids sorted, the verbatim quote, the section, `via`, and the dismissal''s suggestion id. Two proposals of the same edit on the same argument hash alike, whichever pair raised them, so a rejection here blocks every re-proposal (PR 3.3: "rejected items never reappear for the same evidence"). NULL on rows written before this migration — those fall back to comparing the evidence itself.';
COMMENT ON COLUMN public.fit_corrections.rescored_at IS
  'When the pairs an applied correction touches were re-scored. An investigator correction is re-scored in the approve action; a notice correction re-scores every investigator against the notice — in the action when the count is at or under FIT_RESCORE_SYNC_MAX_INVESTIGATORS, else NULL until the nightly fit-results prelude sweeps it (PR 3.3 acceptance: "approving a notice correction re-scores every investigator against that notice within the nightly job"). A row the judge applied itself (route auto) is stamped when it is written: judgePair patches the profile and re-scores that pair inline.';
COMMENT ON COLUMN public.fit_corrections.rescore_attempts IS
  'How many times the nightly re-score prelude has taken this row and failed (rescoreAppliedCorrections in src/lib/fit/service.ts stamps rescored_at on success and increments this on an error). The prelude orders by (rescore_attempts, decided_at), so a subject whose re-score keeps erroring drops below the ones that have not been tried instead of leading the order every night.';

-- "Was this exact edit rejected on this exact argument?" — the judge's and the
-- one-click confirmation's lookup before proposing (rejectionBlocking →
-- listRejected, from judgePair and from proposeProfileCorrection).
CREATE INDEX IF NOT EXISTS idx_fit_corrections_evidence_hash
  ON public.fit_corrections (target, target_id, path, evidence_hash)
  WHERE evidence_hash IS NOT NULL;

-- The nightly prelude's selection: applied corrections of either target whose
-- re-score has not run yet, least-tried and oldest decision first. `target` is
-- not in the key: the prelude reads both targets and never filters on it.
CREATE INDEX IF NOT EXISTS idx_fit_corrections_awaiting_rescore
  ON public.fit_corrections (rescore_attempts, decided_at)
  WHERE status = 'applied' AND rescored_at IS NULL;

-- ---------------------------------------------------------------------------
-- Back-fill: nothing applied before this migration is owed a re-score
-- ---------------------------------------------------------------------------

-- Every applied row on file was applied by the judge (route auto), which
-- patches the stored profile and re-scores the pair inline; the approve action
-- that can leave a re-score owed arrives with this migration. Stamping them
-- keeps the first nightly prelude from re-scoring every subject they name.
-- Idempotent: after this runs, no applied row has a NULL rescored_at.
UPDATE public.fit_corrections
   SET rescored_at = COALESCE(decided_at, now())
 WHERE status = 'applied' AND rescored_at IS NULL;
