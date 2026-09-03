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
