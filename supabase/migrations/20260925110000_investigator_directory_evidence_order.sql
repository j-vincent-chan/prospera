-- Same function, deterministic order. The first version ordered grants by
-- fiscal year alone and publications by date alone, so grants sharing a
-- fiscal year and papers sharing a date came back in whatever order the heap
-- had them — which decided which three the popover shows. Within a fiscal year
-- the award ending latest now comes first (then project number); same-day
-- publications come newest PMID first. Both paths of the loader sort the same
-- way.
CREATE OR REPLACE FUNCTION public.investigator_directory_evidence()
RETURNS TABLE (
  investigator_id UUID,
  grants JSONB,
  verified_by_method JSONB,
  unverified_count INTEGER,
  recent_verified JSONB,
  recent_unverified JSONB
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH inv AS (
    SELECT id FROM public.investigators WHERE archived_at IS NULL
  ),
  g AS (
    SELECT
      n.investigator_id,
      jsonb_agg(
        jsonb_build_object(
          'project_num', n.project_num,
          'project_title', n.project_title,
          'ic_name', n.ic_name,
          'fiscal_year', n.fiscal_year,
          'is_active', n.is_active,
          'identity_status', n.identity_status,
          'project_start_date', left(n.raw_json ->> 'project_start_date', 10),
          'project_end_date', left(n.raw_json ->> 'project_end_date', 10),
          'contact_pi_name', n.raw_json ->> 'contact_pi_name',
          'principal_investigators', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'last_name', p ->> 'last_name',
              'is_contact_pi', COALESCE((p ->> 'is_contact_pi')::boolean, false)
            ))
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(n.raw_json -> 'principal_investigators') = 'array'
                   THEN n.raw_json -> 'principal_investigators'
                   ELSE '[]'::jsonb END
            ) AS p
          ), '[]'::jsonb)
        )
        ORDER BY n.fiscal_year DESC, (n.raw_json ->> 'project_end_date') DESC NULLS LAST, n.project_num
      ) AS grants
    FROM public.investigator_nih_grants n
    GROUP BY n.investigator_id
  ),
  pc AS (
    SELECT p.investigator_id, p.identity_status, p.identity_method, count(*)::int AS n
    FROM public.investigator_publications p
    GROUP BY 1, 2, 3
  ),
  pcounts AS (
    SELECT
      pc.investigator_id,
      COALESCE(jsonb_object_agg(pc.identity_method, pc.n) FILTER (WHERE pc.identity_status = 'verified'), '{}'::jsonb) AS verified_by_method,
      COALESCE(sum(pc.n) FILTER (WHERE pc.identity_status = 'unverified'), 0)::int AS unverified_count
    FROM pc
    GROUP BY pc.investigator_id
  ),
  ranked AS (
    SELECT
      p.investigator_id, p.pmid, p.title, p.journal, p.publication_date, p.identity_method, p.identity_status,
      row_number() OVER (PARTITION BY p.investigator_id, p.identity_status ORDER BY p.publication_date DESC NULLS LAST, p.pmid DESC) AS rn
    FROM public.investigator_publications p
    WHERE p.identity_status IN ('verified', 'unverified')
  ),
  recent AS (
    SELECT
      r.investigator_id,
      COALESCE(jsonb_agg(
        jsonb_build_object('pmid', r.pmid, 'title', r.title, 'journal', r.journal, 'publication_date', r.publication_date, 'identity_method', r.identity_method, 'identity_status', r.identity_status)
        ORDER BY r.publication_date DESC NULLS LAST, r.pmid DESC
      ) FILTER (WHERE r.identity_status = 'verified' AND r.rn <= 2), '[]'::jsonb) AS recent_verified,
      COALESCE(jsonb_agg(
        jsonb_build_object('pmid', r.pmid, 'title', r.title, 'journal', r.journal, 'publication_date', r.publication_date, 'identity_method', r.identity_method, 'identity_status', r.identity_status)
        ORDER BY r.publication_date DESC NULLS LAST, r.pmid DESC
      ) FILTER (WHERE r.identity_status = 'unverified' AND r.rn <= 1), '[]'::jsonb) AS recent_unverified
    FROM ranked r
    WHERE r.rn <= 2
    GROUP BY r.investigator_id
  )
  SELECT
    inv.id AS investigator_id,
    COALESCE(g.grants, '[]'::jsonb) AS grants,
    COALESCE(pcounts.verified_by_method, '{}'::jsonb) AS verified_by_method,
    COALESCE(pcounts.unverified_count, 0) AS unverified_count,
    COALESCE(recent.recent_verified, '[]'::jsonb) AS recent_verified,
    COALESCE(recent.recent_unverified, '[]'::jsonb) AS recent_unverified
  FROM inv
  LEFT JOIN g ON g.investigator_id = inv.id
  LEFT JOIN pcounts ON pcounts.investigator_id = inv.id
  LEFT JOIN recent ON recent.investigator_id = inv.id;
$$;

GRANT EXECUTE ON FUNCTION public.investigator_directory_evidence() TO authenticated;
GRANT EXECUTE ON FUNCTION public.investigator_directory_evidence() TO service_role;

COMMENT ON FUNCTION public.investigator_directory_evidence() IS
  'Per non-archived investigator: every RePORTER grant (slim), verified publication counts by identity method, the name-only count, and the most recent two verified / one unverified publications. One read for the directory''s source chips.';
