-- Review queue policy (docs/review/IMPLEMENTATION_DECISIONS.md R32, Vincent
-- 2026-09-13): a queued notice lists its Strong and Moderate matches; the
-- Exploratory leads are off by default and each strategist can switch them
-- on for themselves. The switch is a profile preference, not a team setting.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS review_exploratory BOOLEAN NOT NULL DEFAULT false;
