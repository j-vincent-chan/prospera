-- Saved searches are shared with the team by default (personal stays available as a choice).
ALTER TABLE public.saved_funding_searches ALTER COLUMN visibility SET DEFAULT 'team';
