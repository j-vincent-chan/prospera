-- Legacy pipeline events that the outreach migration copied as bare notes
-- ("pipeline_update", "pi_updated", "communities_updated", "closure") read
-- as sentences in the activity log.
UPDATE public.outreach_activity
SET kind = 'stage_change', text = 'updated the pipeline record (previous pipeline)'
WHERE kind = 'note' AND text = 'pipeline_update';

UPDATE public.outreach_activity
SET kind = 'recipient_added', text = 'updated a recipient (previous pipeline)'
WHERE kind = 'note' AND text = 'pi_updated';

UPDATE public.outreach_activity
SET kind = 'community_tagged', text = 'updated community tags (previous pipeline)'
WHERE kind = 'note' AND text = 'communities_updated';

UPDATE public.outreach_activity
SET kind = 'outcome', text = 'closed (previous pipeline)'
WHERE kind = 'note' AND text = 'closure';

-- ---------------------------------------------------------------------------
-- Match functions: their own statement timeout and a wider HNSW candidate
-- list, so a ranking is never cut short by the role default or the index's
-- default ef_search (40) while embeddings are being written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_evidence(
  query_embedding extensions.vector(1536),
  match_count INTEGER DEFAULT 600,
  min_similarity DOUBLE PRECISION DEFAULT 0.2
)
RETURNS TABLE (investigator_id UUID, kind TEXT, ref_id TEXT, content TEXT, year INTEGER, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE
SET search_path = public, extensions
SET statement_timeout = '60s'
SET hnsw.ef_search = 1000
AS $$
  SELECT e.investigator_id, e.kind, e.ref_id, e.content, e.year, 1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.evidence_embeddings e
  WHERE 1 - (e.embedding <=> query_embedding) >= min_similarity
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.score_investigator_evidence(
  p_investigator_id UUID,
  query_embedding extensions.vector(1536)
)
RETURNS TABLE (kind TEXT, ref_id TEXT, content TEXT, year INTEGER, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE
SET search_path = public, extensions
SET statement_timeout = '30s'
AS $$
  SELECT e.kind, e.ref_id, e.content, e.year, 1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.evidence_embeddings e
  WHERE e.investigator_id = p_investigator_id
  ORDER BY e.embedding <=> query_embedding;
$$;

CREATE OR REPLACE FUNCTION public.match_opportunities(
  query_embedding extensions.vector(1536),
  match_count INTEGER DEFAULT 40,
  only_open BOOLEAN DEFAULT true
)
RETURNS TABLE (opportunity_id UUID, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE
SET search_path = public, extensions
SET statement_timeout = '60s'
SET hnsw.ef_search = 400
AS $$
  SELECT o.opportunity_id, 1 - (o.embedding <=> query_embedding) AS similarity
  FROM public.opportunity_embeddings o
  JOIN public.funding_opportunities f ON f.id = o.opportunity_id
  WHERE NOT only_open
     OR f.close_date >= CURRENT_DATE
     OR f.next_due >= CURRENT_DATE
     OR f.expiration_date >= CURRENT_DATE
  ORDER BY o.embedding <=> query_embedding
  LIMIT match_count;
$$;
