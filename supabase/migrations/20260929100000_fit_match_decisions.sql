-- Review (design_handoff_prospera_review_outreach, screen 2): one decision
-- record per match — one investigator × one notice, for one team.
--
-- The redesign makes the match the primary object. Until now nothing in the
-- schema held a strategist's judgment about a pair: `fit_results` is the
-- engine's nightly output and is overwritten, `fit_labels` is append-only
-- evidence for the engine, and `outreach_recipients` only exists once a
-- notice has an Outreach item. This table is the match record the Review
-- page reads and writes — Confirm / Dismiss / Watch, the reason given, and
-- whether the row was decided by a tap or cleared by a notice-scoped reason.
--
--   status        confirmed | rejected | watch — the README's Decision type.
--   reason        the chip tapped (rejected), the strength tag (confirmed),
--                 or "biosketch_requested" (watch). Free text by design: the
--                 vocabulary lives in src/lib/review/reasons.ts.
--   scope         pair | notice | person — what the reason was about. A
--                 notice-scoped reason also clears every other undecided
--                 match on the notice (auto = true on those rows).
--   auto          written by a notice-scoped reason or "Dismiss all", not by
--                 a tap on this row; "Undo" on the bulk banner deletes exactly
--                 the auto rows.
--   resurface_on  watch only: the day the match returns to the queue (30 days
--                 before the deadline, or null when the notice has none).
--   verdict_label the label the row carried when it was decided (strong,
--                 moderate, exploratory, cannot_assess, ruled_out), so a
--                 later calibration can weigh a confirmed Exploratory
--                 differently from a confirmed Strong.
--
-- Undo deletes the row (README §"Interactions & behaviour"); there is no
-- soft-delete, because a match with no decision is exactly "undecided".
-- Teammates see each other's decisions: the page reads every row for the
-- team, and the row's status text names the decision, not the decider.

CREATE TABLE IF NOT EXISTS public.fit_match_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  investigator_id UUID NOT NULL REFERENCES public.investigators (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'rejected', 'watch')),
  reason TEXT,
  scope TEXT CHECK (scope IS NULL OR scope IN ('pair', 'notice', 'person')),
  auto BOOLEAN NOT NULL DEFAULT false,
  resurface_on DATE,
  verdict_label TEXT,
  decided_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fit_match_decisions_pair_unique UNIQUE (team_id, opportunity_id, investigator_id)
);

COMMENT ON TABLE public.fit_match_decisions IS
  'One strategist decision per match (team × notice × investigator) from the Review page: confirmed, rejected or watch, with the reason and its scope. Undo deletes the row.';
COMMENT ON COLUMN public.fit_match_decisions.reason IS
  'The reason id from src/lib/review/reasons.ts: a dismiss chip (rejected), a strength tag (confirmed) or biosketch_requested (watch). NULL when none was given.';
COMMENT ON COLUMN public.fit_match_decisions.scope IS
  'What the reason was about: pair (this match), notice (every match on the notice — the others are written with auto = true) or person (also saved to the investigator profile as do-not-contact).';
COMMENT ON COLUMN public.fit_match_decisions.auto IS
  'True when the row was cleared by a notice-scoped reason or "Dismiss all N matches" rather than decided by a tap on it; the bulk Undo deletes exactly these.';
COMMENT ON COLUMN public.fit_match_decisions.resurface_on IS
  'Watch only: the day the match returns to the queue as undecided (30 days before the deadline). NULL when the notice has no deadline; such a watch does not expire.';
COMMENT ON COLUMN public.fit_match_decisions.verdict_label IS
  'The verdict label the row carried when decided (strong | moderate | exploratory | cannot_assess | ruled_out).';

CREATE INDEX IF NOT EXISTS fit_match_decisions_team_notice_idx
  ON public.fit_match_decisions (team_id, opportunity_id);
CREATE INDEX IF NOT EXISTS fit_match_decisions_team_status_idx
  ON public.fit_match_decisions (team_id, status);
CREATE INDEX IF NOT EXISTS fit_match_decisions_investigator_idx
  ON public.fit_match_decisions (investigator_id);

ALTER TABLE public.fit_match_decisions ENABLE ROW LEVEL SECURITY;

-- The team reads and writes its own decisions. Writes go through the
-- service-role client in server actions, as every other team table's do;
-- the policy is what lets a page read with the session client.
DROP POLICY IF EXISTS fit_match_decisions_team_select ON public.fit_match_decisions;
CREATE POLICY fit_match_decisions_team_select ON public.fit_match_decisions
  FOR SELECT TO authenticated
  USING (public.is_team_member(team_id));

DROP POLICY IF EXISTS fit_match_decisions_team_write ON public.fit_match_decisions;
CREATE POLICY fit_match_decisions_team_write ON public.fit_match_decisions
  FOR ALL TO authenticated
  USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));
