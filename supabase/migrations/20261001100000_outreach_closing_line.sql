-- Message — Draft outreach (design_handoff_prospera_review_outreach README §6).
-- The "Next step" beat of every draft is the team's standing closing line.
-- Null means the default ("If you would like to pursue it, reply here and I
-- will set up a 20-minute scoping call."); the page reads the default from
-- code so the column can stay empty until a team writes its own.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS outreach_closing_line TEXT;
