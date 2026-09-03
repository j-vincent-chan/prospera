-- Step 2 created a plain index named dismissed_funding_opportunities_team_idx
-- on (team_id, opportunity_id); step 3's CREATE UNIQUE INDEX IF NOT EXISTS with
-- the same name was therefore skipped, leaving no unique key for team-level
-- dismissals. Replace it with a unique index under a new name.
DROP INDEX IF EXISTS public.dismissed_funding_opportunities_team_idx;

-- Keep the earliest row where a team dismissed the same notice more than once.
DELETE FROM public.dismissed_funding_opportunities d
 USING public.dismissed_funding_opportunities d2
 WHERE d.team_id = d2.team_id AND d.opportunity_id = d2.opportunity_id
   AND d.created_at > d2.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS dismissed_funding_opportunities_team_uniq
  ON public.dismissed_funding_opportunities (team_id, opportunity_id);
