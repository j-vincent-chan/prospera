-- "Needs your call" / "Disagreements" (docs/review/IMPLEMENTATION_DECISIONS.md R35).
-- A decision that replaces a different teammate's different decision keeps
-- what it replaced on the row, so the disagreement between reviewers is
-- visible instead of silently overwritten. Undo deletes the row, as before.
ALTER TABLE public.fit_match_decisions
  ADD COLUMN IF NOT EXISTS previous_status TEXT,
  ADD COLUMN IF NOT EXISTS previous_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_at TIMESTAMPTZ;
