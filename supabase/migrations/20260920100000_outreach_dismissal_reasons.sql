-- PR 3.2 · Dismissal reasons that name the fit engine's axes (spec §12).
--
-- Two things on public.outreach_suggestions:
--
--   dismissed_reason     gains a CHECK. The column never had one: the legacy
--                        Outreach vocabulary (not_relevant, wrong_area,
--                        wrong_person, already_aware, do_not_contact) was
--                        enforced in code only. The set below is that
--                        vocabulary plus the two spec §12 reasons the fit
--                        engine learns from — `wrong_research_type` ("wrong
--                        type of research", the strongest signal: it names
--                        the axis and trains the gate) and `not_eligible`
--                        ("wrong career stage / not eligible", an eligibility
--                        rule audit). The code's accepted set
--                        (src/lib/fit/feedback/dismissal.ts DISMISS_REASONS)
--                        is tested against this constraint's list.
--
--   axis_reason          TEXT, the sub-reason of a `wrong_research_type`
--                        dismissal in the shape the inspector's flags and the
--                        gold labels already use: `<axis>` or
--                        `<axis>:<category>` (paradigm:clinical_trials,
--                        materials, materials:animal_mouse …). The taxonomy
--                        (src/lib/fit/taxonomy.json › feedback) is the source
--                        of the presets; the code validates the axis and the
--                        category against it. A dismissal that names a
--                        category is what proposes a fit_corrections row
--                        (the one-click confirmation).
--
-- Written, never applied by a script (CLAUDE.md); the coordinator applies it
-- before the merge deploys. Every statement is idempotent. Until it is applied
-- the dismissal action stores the reason without the sub-reason and tells the
-- caller so; nothing else changes.

ALTER TABLE public.outreach_suggestions
  ADD COLUMN IF NOT EXISTS axis_reason TEXT;

-- The reason vocabulary. INVENTORY.md (2026-09-04) found no dismissal rows, so
-- the constraint validates immediately; a database that has taken a value
-- outside the list will refuse it and name the row — fix the row, not the list.
ALTER TABLE public.outreach_suggestions
  DROP CONSTRAINT IF EXISTS outreach_suggestions_dismissed_reason_check;
ALTER TABLE public.outreach_suggestions
  ADD CONSTRAINT outreach_suggestions_dismissed_reason_check
  CHECK (dismissed_reason IS NULL OR dismissed_reason IN (
    'not_relevant', 'wrong_area', 'wrong_person', 'already_aware', 'do_not_contact',
    'wrong_research_type', 'not_eligible'
  ));

-- `<axis>` or `<axis>:<category>`; the code checks the ids against the taxonomy.
ALTER TABLE public.outreach_suggestions
  DROP CONSTRAINT IF EXISTS outreach_suggestions_axis_reason_check;
ALTER TABLE public.outreach_suggestions
  ADD CONSTRAINT outreach_suggestions_axis_reason_check
  CHECK (axis_reason IS NULL OR axis_reason ~ '^[a-z_]+(:[A-Za-z0-9_]+)?$');

COMMENT ON COLUMN public.outreach_suggestions.dismissed_reason IS
  'Why a person dismissed the suggestion: the legacy Outreach reasons (not_relevant, wrong_area, wrong_person, already_aware, do_not_contact) and, from PR 3.2 (spec §12), wrong_research_type (names an axis in axis_reason; proposes a fit_corrections row) and not_eligible (wrong career stage or not eligible; an eligibility rule audit). NULL for a dismissal without a reason.';
COMMENT ON COLUMN public.outreach_suggestions.axis_reason IS
  'The sub-reason of a wrong_research_type dismissal: <axis> or <axis>:<category> (paradigm:clinical_trials, materials:animal_mouse, materials …) — the shape fit_labels.axis_reason uses; presets in src/lib/fit/taxonomy.json › feedback.wrong_research_type_subreasons. A value naming a category is what the one-click profile-correction confirmation turns into a fit_corrections row.';
