-- Which option of the ranked resolver (src/lib/funding-opportunities/nih-ic-resolution.ts)
-- produced nih_ic_tokens, and the one-sentence reason shown under "Institutes".
-- 'unresolved' is the explicit flag that no option named an institute; NULL means the
-- row predates the resolver and has not been backfilled (scripts/backfill-nih-ic-tokens.ts).
ALTER TABLE public.funding_opportunities
  ADD COLUMN IF NOT EXISTS nih_ic_source text,
  ADD COLUMN IF NOT EXISTS nih_ic_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'funding_opportunities_nih_ic_source_check') THEN
    ALTER TABLE public.funding_opportunities
      ADD CONSTRAINT funding_opportunities_nih_ic_source_check
      CHECK (nih_ic_source IS NULL OR nih_ic_source IN ('guide_participating_orgs', 'summary_text', 'notice_number', 'agency_contact', 'unresolved'));
  END IF;
END $$;

COMMENT ON COLUMN public.funding_opportunities.nih_ic_source IS 'Ranked resolver option that produced nih_ic_tokens: guide_participating_orgs > summary_text > notice_number > agency_contact; unresolved when none matched.';
COMMENT ON COLUMN public.funding_opportunities.nih_ic_reason IS 'One sentence: the option used and why the options above it were passed over.';
