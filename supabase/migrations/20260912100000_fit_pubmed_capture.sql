-- PR 0.2 · PubMed capture: MeSH headings, publication types, abstract and the
-- matched author's position on the author list; plus the MeSH descriptor
-- vocabulary the rule classifier resolves names against (DECISIONS D10).
--
-- investigator_publications gains the fields the efetch step used to discard.
-- mesh_fetched_at and mesh_fetch_outcome are stamped for every PMID a fetch
-- touched — records that came back with MeSH (indexed), in-process records with
-- none yet (no_mesh), and PMIDs efetch did not return at all (not_returned) —
-- so the backfill is resumable and never re-fetches the whole corpus.
-- no_mesh and not_returned rows are retried once mesh_fetched_at is older than
-- 30 days; a second not_returned is not_returned_terminal and never re-requested
-- (scripts/fit-backfill-pubmed-mesh.ts; --report lists them).
-- author_position_method records how the author entry was found (orcid | name |
-- absent), the same principle as identity_method, so a scorer can discount
-- name-derived positions.

ALTER TABLE public.investigator_publications
  ADD COLUMN IF NOT EXISTS mesh JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS publication_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS abstract TEXT,
  ADD COLUMN IF NOT EXISTS author_position TEXT
    CHECK (author_position IN ('first', 'last', 'corresponding', 'middle', 'unknown')),
  ADD COLUMN IF NOT EXISTS author_position_method TEXT
    CHECK (author_position_method IN ('orcid', 'name', 'absent')),
  ADD COLUMN IF NOT EXISTS mesh_fetch_outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (mesh_fetch_outcome IN ('pending', 'indexed', 'no_mesh', 'not_returned', 'not_returned_terminal')),
  ADD COLUMN IF NOT EXISTS mesh_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN public.investigator_publications.mesh IS
  'MeshHeadingList as [{ui, name, major, qualifiers[]}]; major = the descriptor or any qualifier is a major topic. [] until fetched, and for in-process records that carry no MeSH yet.';
COMMENT ON COLUMN public.investigator_publications.publication_types IS
  'PublicationTypeList descriptor names (Journal Article, Randomized Controlled Trial, …).';
COMMENT ON COLUMN public.investigator_publications.abstract IS
  'AbstractText sections joined as "LABEL: text" paragraphs; NULL when the record has no abstract.';
COMMENT ON COLUMN public.investigator_publications.author_position IS
  'Position of this investigator on the author list: first, last, corresponding (email on the affiliation), middle, or unknown when the author entry could not be located.';
COMMENT ON COLUMN public.investigator_publications.author_position_method IS
  'How the author entry behind author_position was identified: orcid (the entry carries the investigator''s ORCID iD), name (strict name + UCSF affiliation, else name only — discountable), absent (nobody matched; position is unknown).';
COMMENT ON COLUMN public.investigator_publications.mesh_fetch_outcome IS
  'pending = never fetched; indexed = MeSH stored; no_mesh = returned without MeSH (in-process, retried after 30 days); not_returned = efetch did not return the PMID (retried once); not_returned_terminal = missed twice, never re-requested — a linkage or withdrawal for a person to look at.';
COMMENT ON COLUMN public.investigator_publications.mesh_fetched_at IS
  'When efetch last touched this PMID. Set for every outcome, so a rerun skips it; no_mesh and not_returned rows are retried after 30 days.';

-- Backfill predicate (outcome, then age) and the per-PMID fan-out (every row sharing a PMID gets the same MeSH).
CREATE INDEX IF NOT EXISTS idx_inv_publications_mesh_fetch
  ON public.investigator_publications (mesh_fetch_outcome, mesh_fetched_at);
CREATE INDEX IF NOT EXISTS idx_inv_publications_pmid
  ON public.investigator_publications (pmid);

-- ---------------------------------------------------------------------------
-- mesh_descriptors: the NLM descriptor file, loaded once a year by
-- scripts/fit-load-mesh-descriptors.ts. Names in src/lib/fit/signal-mapping.json
-- resolve against this table and the loader fails when any does not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mesh_descriptors (
  ui TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tree_numbers TEXT[] NOT NULL,
  is_check_tag BOOLEAN NOT NULL DEFAULT false,
  year INTEGER NOT NULL
);

COMMENT ON TABLE public.mesh_descriptors IS
  'NLM MeSH descriptors (DescriptorUI, DescriptorName, TreeNumberList) for the fit engine. year = the descriptor edition the row came from (D12: tree numbers are positional and change between editions; signal-mapping.json prefixes are validated against this table on every reload).';
COMMENT ON COLUMN public.mesh_descriptors.is_check_tag IS
  'True for the MeSH check tags (Humans, Animals, Male, Female, the age groups, the common lab species), marked from an explicit list in the loader.';

CREATE INDEX IF NOT EXISTS idx_mesh_descriptors_name ON public.mesh_descriptors (name);

ALTER TABLE public.mesh_descriptors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mesh_descriptors_all_authenticated ON public.mesh_descriptors;
CREATE POLICY mesh_descriptors_all_authenticated ON public.mesh_descriptors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
