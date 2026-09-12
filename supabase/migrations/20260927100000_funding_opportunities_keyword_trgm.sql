-- Keyword search on the Opportunities list matches
--   title ILIKE '%term%' OR description ILIKE '%term%' OR opportunity_number ILIKE '%term%'
-- (src/lib/funding-opportunities/keyword-filter.ts). Without trigram indexes every
-- keyword search — and every saved search with a keyword — is a sequential scan
-- that runs ILIKE over ~4.5 MB of description text: ~150 ms of CPU per query on
-- the shared-CPU database (measured 2026-09-11 against 3,335 notices). With
-- gin_trgm_ops on all three columns the planner can BitmapOr the three index
-- scans and only re-check the matching rows.
--
-- pg_trgm is already installed (20260411120000). The catalog is small, so the
-- plain CREATE INDEX finishes in seconds; the nightly sync's updates pay for
-- index maintenance, which GIN's fastupdate pending list amortises.

CREATE INDEX IF NOT EXISTS idx_funding_opps_title_trgm
  ON public.funding_opportunities USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_funding_opps_description_trgm
  ON public.funding_opportunities USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_funding_opps_opportunity_number_trgm
  ON public.funding_opportunities USING gin (opportunity_number gin_trgm_ops);
