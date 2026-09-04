-- PR 0.1b · investigator_nih_grants.provenance_note (mirrors investigator_publications).
-- scripts/fit-fix-profile-ids.ts writes the reason a grant row was rejected
-- (wrong RePORTER profile id and the PI it resolves to) instead of deleting it.
ALTER TABLE public.investigator_nih_grants
  ADD COLUMN IF NOT EXISTS provenance_note TEXT;

COMMENT ON COLUMN public.investigator_nih_grants.provenance_note IS
  'Why this row has its identity_status, e.g. rejected because the profile id it was fetched with resolves to another PI.';
