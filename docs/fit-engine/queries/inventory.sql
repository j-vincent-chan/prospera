-- Fit engine · data inventory (PR 0.1). Read-only. Run in the Supabase SQL editor
-- or via scripts/fit-inventory.ts, and paste the results into docs/fit-engine/INVENTORY.md.
-- Numbers here drive confidence caps, cost estimates and the pilot choice (spec §14–§15).

-- 1. Directory and identity coverage
select
  count(*)                                              as investigators,
  count(*) filter (where nih_profile_id is not null)    as with_nih_profile_id,
  count(*) filter (where orcid is not null)             as with_orcid,
  count(*) filter (where profiles_url_name is not null) as with_profiles_url,
  count(*) filter (where research_community_id is not null) as in_a_community
from investigators where archived_at is null;

-- 2. Evidence per investigator (verified publications, grants, trials)
with p as (
  select investigator_id, count(*) filter (where identity_status = 'verified') as pubs_verified,
         count(*) filter (where identity_status = 'unverified') as pubs_unverified
  from investigator_publications group by 1),
g as (select investigator_id, count(*) as grants, count(*) filter (where is_active) as active_grants
      from investigator_nih_grants where identity_status <> 'rejected' group by 1),
t as (select investigator_id, count(*) as trials from investigator_clinical_trials group by 1)
select
  count(*) as investigators,
  percentile_cont(0.5) within group (order by coalesce(p.pubs_verified,0)) as median_pubs_verified,
  count(*) filter (where coalesce(p.pubs_verified,0) = 0)  as no_verified_pubs,
  count(*) filter (where coalesce(p.pubs_verified,0) >= 10) as pubs_10_plus,
  count(*) filter (where coalesce(g.grants,0) > 0)          as with_any_grant,
  count(*) filter (where coalesce(g.active_grants,0) > 0)   as with_active_grant,
  count(*) filter (where coalesce(t.trials,0) > 0)          as with_any_trial
from investigators i
left join p on p.investigator_id = i.id
left join g on g.investigator_id = i.id
left join t on t.investigator_id = i.id
where i.archived_at is null;

-- 3. Source states (biosketch, profiles, orcid, reporter, pubmed)
select source, state, count(*) from investigator_sources group by 1, 2 order by 1, 2;

-- 4. Notice corpus: open notices, NIH share, Guide coverage, clinical-trial designation from title
with open as (
  select * from funding_opportunities
  where close_date >= current_date or next_due >= current_date or expiration_date >= current_date)
select
  count(*) as open_notices,
  count(*) filter (where agency_code like 'HHS-NIH%' or opportunity_number ~ '^(PA|PAR|PAS|RFA)-') as nih_like,
  count(*) filter (where guide_fetch_status = 'ok')       as guide_ok,
  count(*) filter (where guide_fetch_status = 'ok' and guide_source = 'simpler_attachment') as guide_ok_simpler_attachment,
  -- PR 0.5: not_found split by forecasted — a forecast has no Guide page yet and is not a failure;
  -- after the 0.5 migration the sync stamps forecasts, -000 placeholders and non-Guide numbers not_applicable instead.
  count(*) filter (where guide_fetch_status = 'not_found' and not forecasted) as guide_not_found_posted,
  count(*) filter (where guide_fetch_status = 'not_found' and forecasted)     as guide_not_found_forecast,
  count(*) filter (where guide_fetch_status = 'not_applicable') as guide_not_applicable,
  count(*) filter (where guide_fetch_status = 'error')    as guide_error,
  count(*) filter (where guide_fetch_status is null)      as guide_never_fetched,
  count(*) filter (where guide_sections is not null)      as with_guide_sections,
  count(*) filter (where title ilike '%clinical trial required%')    as ct_required,
  count(*) filter (where title ilike '%clinical trial optional%')    as ct_optional,
  count(*) filter (where title ilike '%clinical trial not allowed%') as ct_not_allowed,
  count(*) filter (where title ilike '%basic experimental studies with humans%') as besh,
  count(*) filter (where clinical_trial_designation is not null and clinical_trial_designation <> 'unknown') as designation_from_guide,
  count(*) filter (where program_division is not null) as with_program_division,
  count(*) filter (where reissue_of is not null) as reissues,
  count(*) filter (where reissue_of ~ '^PA[RS]?-') as reissues_of_pa,
  count(*) filter (where activity_code is not null) as with_activity_code,
  percentile_cont(0.5) within group (order by length(coalesce(description, ''))) as median_description_chars
from open;

-- 5. Activity-code mix among open NIH notices (for the priors table)
select activity_code, count(*) from funding_opportunities
where (close_date >= current_date or next_due >= current_date or expiration_date >= current_date)
  and activity_code is not null
group by 1 order by 2 desc limit 30;

-- 6. Embedding coverage (what the current engine can see)
select
  (select count(*) from investigator_embeddings) as investigators_embedded,
  (select count(*) from opportunity_embeddings)  as notices_embedded,
  (select count(*) from evidence_embeddings)     as evidence_items_embedded,
  (select count(distinct kind) from evidence_embeddings) as evidence_kinds;

-- 7. Feedback already collected (labels the new engine can start from)
select dismissed_reason, count(*) from outreach_suggestions where status = 'dismissed' group by 1 order by 2 desc;
select status, count(*) from outreach_suggestions group by 1;
select stage, count(*) from outreach_items group by 1;
select status, count(*) from outreach_recipients where removed_at is null group by 1;

-- 8. One raw RePORTER row and one raw CT.gov row (to confirm the fields the backfills depend on)
select project_num,
       raw_json ? 'abstract_text'            as has_abstract,
       raw_json ? 'phr_text'                 as has_phr,
       raw_json ? 'spending_categories_desc' as has_rcdc,
       raw_json ? 'full_study_section'       as has_study_section,
       raw_json ? 'principal_investigators'  as has_pis,
       raw_json ? 'terms'                    as has_terms
from investigator_nih_grants order by updated_at desc limit 5;

select nct_id,
       raw_json #>> '{protocolSection,designModule,studyType}'                 as study_type,
       raw_json #>  '{protocolSection,designModule,phases}'                    as phases,
       raw_json #>> '{protocolSection,designModule,designInfo,primaryPurpose}' as primary_purpose,
       raw_json #>> '{protocolSection,designModule,designInfo,observationalModel}' as observational_model,
       raw_json #>> '{protocolSection,designModule,enrollmentInfo,count}'      as enrollment,
       jsonb_array_length(coalesce(raw_json #> '{protocolSection,contactsLocationsModule,overallOfficials}', '[]'::jsonb)) as officials
from investigator_clinical_trials order by updated_at desc limit 5;

-- 9. Communities and teams (pilot selection; feature flag lives on teams)
select c.label, c.monitored, c.active, count(i.id) as members
from pipeline_communities c left join investigators i on i.research_community_id = c.id and i.archived_at is null
group by 1, 2, 3 order by members desc;
select id, name from teams;
