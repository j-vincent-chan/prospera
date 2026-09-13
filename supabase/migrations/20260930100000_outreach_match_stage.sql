-- Outreach re-based on matches (design_handoff_prospera_review_outreach,
-- screen 5): stage, owner and next step live on the match — one investigator
-- × one notice, which is an `outreach_recipients` row — not on the notice's
-- `outreach_items` row.
--
-- The item keeps its stage for the surfaces that read it (Home, Reports,
-- Calendar, the workspace); the match actions move it forward when a match
-- is ahead of it ("a notice is busy when any of its matches is"). Nothing
-- here changes what an existing screen sees.
--
--   pursuit_stage    NULL until the PI says yes. Then pursuing → submitted →
--                    outcome; parked and closed leave the board.
--   pursuit_outcome  The outcome recorded on this match (funded, not funded…).
--   pursuit_note     Why it was parked or closed, or the outcome's note.
--   next_step        The strategist's own next step ("OSR routing", "Book
--                    scoping call") and its date; the board composes one
--                    when none is set.
--   owner_id         The match's owner; NULL falls back to the item's owner.
--
-- `teams.reply_window_days` is the "no reply in N days" setting the board's
-- groups turn on: a sent message inside the window is "Waiting on a PI",
-- outside it is a nudge that is due.

ALTER TABLE public.outreach_recipients
  ADD COLUMN IF NOT EXISTS pursuit_stage TEXT,
  ADD COLUMN IF NOT EXISTS pursuit_outcome TEXT,
  ADD COLUMN IF NOT EXISTS pursuit_note TEXT,
  ADD COLUMN IF NOT EXISTS pursuit_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_step TEXT,
  ADD COLUMN IF NOT EXISTS next_step_date DATE,
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.outreach_recipients DROP CONSTRAINT IF EXISTS outreach_recipients_pursuit_stage_check;
ALTER TABLE public.outreach_recipients
  ADD CONSTRAINT outreach_recipients_pursuit_stage_check
  CHECK (pursuit_stage IS NULL OR pursuit_stage IN ('pursuing', 'submitted', 'outcome', 'parked', 'closed'));

ALTER TABLE public.outreach_recipients DROP CONSTRAINT IF EXISTS outreach_recipients_pursuit_outcome_check;
ALTER TABLE public.outreach_recipients
  ADD CONSTRAINT outreach_recipients_pursuit_outcome_check
  CHECK (pursuit_outcome IS NULL OR pursuit_outcome IN ('funded', 'not_funded', 'withdrawn', 'not_submitted', 'pending'));

COMMENT ON COLUMN public.outreach_recipients.pursuit_stage IS
  'The match''s own stage once the PI said yes: pursuing | submitted | outcome; parked and closed leave the Outreach board. NULL before a yes.';
COMMENT ON COLUMN public.outreach_recipients.pursuit_outcome IS
  'The outcome recorded on this match: funded | not_funded | withdrawn | not_submitted | pending.';
COMMENT ON COLUMN public.outreach_recipients.next_step IS
  'The strategist''s next step for this match, in their words; the board composes one from the state when NULL.';
COMMENT ON COLUMN public.outreach_recipients.owner_id IS
  'The match''s owner; NULL means the notice''s outreach_items.owner_id.';

CREATE INDEX IF NOT EXISTS idx_outreach_recipients_pursuit
  ON public.outreach_recipients (pursuit_stage)
  WHERE pursuit_stage IS NOT NULL;

-- Existing pursuits: a PI who replied interested on a notice already in
-- Developing, Submitted or Outcome was the pursuit. Only where nothing is
-- recorded yet, so re-running is a no-op.
UPDATE public.outreach_recipients r
SET pursuit_stage = CASE i.stage WHEN 'developing' THEN 'pursuing' WHEN 'submitted' THEN 'submitted' WHEN 'outcome' THEN 'outcome' END,
    pursuit_outcome = CASE i.stage WHEN 'outcome' THEN i.outcome END,
    pursuit_changed_at = COALESCE(i.outcome_at, i.submitted_at, i.updated_at)
FROM public.outreach_items i
WHERE r.item_id = i.id
  AND r.kind = 'person'
  AND r.removed_at IS NULL
  AND r.pursuit_stage IS NULL
  AND r.status = 'replied_interested'
  AND i.stage IN ('developing', 'submitted', 'outcome');

-- The reply window: days of silence after a send that count as no reply.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS reply_window_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_reply_window_days_check;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_reply_window_days_check CHECK (reply_window_days BETWEEN 3 AND 21);
COMMENT ON COLUMN public.teams.reply_window_days IS
  'Outreach: days after a send with no reply before the match needs a nudge (3–21, default 7).';
