-- PR 1.3 · LLM item classifier and cache.
--
-- One row per classified evidence item (publication abstract, RePORTER
-- abstract, registered trial, biosketch statement or contribution, Profiles
-- narrative, self-declared text), keyed by the content hash the way
-- evidence_embeddings is: content_hash = sha1(taxonomy_version + "\n" + kind
-- + "\n" + text) — see itemCacheKey in src/lib/fit/classify/index.ts. The
-- same text is classified by the model once per taxonomy version; a taxonomy
-- bump changes every key and re-classifies everything (spec §5 "re-run only
-- when the taxonomy version changes").
--
-- rules   = what signal-mapping.json decided (PR 1.2), verbatim
-- llm     = the model's validated output plus the raw reply and the
--           validation log (`dropped`), for audit; NULL when the model was
--           not needed (no prose, or rules fired on every axis)
-- merged  = the ItemProfile aggregation reads (src/lib/fit/types.ts): rules
--           override the model on every axis a rule fired on
--
-- Written by classifyItem through supabaseItemProfileCache (PR 1.4's profile
-- builder and cron); never by a page render.

CREATE TABLE IF NOT EXISTS public.fit_item_profiles (
  content_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT,
  taxonomy_version TEXT NOT NULL,
  rules JSONB,
  llm JSONB,
  merged JSONB NOT NULL,
  llm_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fit_item_profiles IS
  'Item classifier cache (PR 1.3): one row per evidence text per taxonomy version, keyed by sha1(taxonomy_version + kind + text). Read before any model call, written after it.';
COMMENT ON COLUMN public.fit_item_profiles.content_hash IS
  'sha1 of taxonomy_version, kind and the item text joined by newlines (itemCacheKey). A taxonomy bump changes every key.';
COMMENT ON COLUMN public.fit_item_profiles.kind IS
  'publication | grant | trial | biosketch_statement | biosketch_contribution | profiles_narrative | self_declared (item-classifier prompt spec).';
COMMENT ON COLUMN public.fit_item_profiles.ref_id IS
  'The evidence id the row was first written for (PMID, project number, NCT id, biosketch:statement …). Informational: the key is the hash, and identical text under another id reuses the row.';
COMMENT ON COLUMN public.fit_item_profiles.taxonomy_version IS
  'src/lib/fit/taxonomy.json version the classification used (also part of the key).';
COMMENT ON COLUMN public.fit_item_profiles.rules IS
  'RuleClassification from signal-mapping.json (PR 1.2): axes, fired rules, firedAxes, refinedBy. NULL only for rows written before PR 1.2 landed.';
COMMENT ON COLUMN public.fit_item_profiles.llm IS
  'LlmClassification: validated axes, confidence, topic_terms, justification, dropped (validation log), model, raw reply. NULL when the model was not needed.';
COMMENT ON COLUMN public.fit_item_profiles.merged IS
  'The ItemProfile (src/lib/fit/types.ts) aggregation reads: rules override the model on every axis in rules.firedAxes; decided_by records which side decided each axis.';
COMMENT ON COLUMN public.fit_item_profiles.llm_model IS
  'The model name the llm column was produced with (FIT_MODEL_CLASSIFY at the time); NULL when the model was not called.';
COMMENT ON COLUMN public.fit_item_profiles.created_at IS
  'When the row was written (rewritten when a later run had to call the model for a row cached without model output).';

-- Inspector and backfills look up rows by the evidence id they were written for.
CREATE INDEX IF NOT EXISTS idx_fit_item_profiles_ref_id
  ON public.fit_item_profiles (ref_id);

ALTER TABLE public.fit_item_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fit_item_profiles_all_authenticated ON public.fit_item_profiles;
CREATE POLICY fit_item_profiles_all_authenticated ON public.fit_item_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
