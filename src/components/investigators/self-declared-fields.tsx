"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  MATERIALS_GROUPS,
  MATERIALS_LABEL,
  SELF_DECLARED_FAMILY_ROWS,
  SELF_DECLARED_RATINGS,
  type MaterialsKind,
  type ParadigmFamily,
  type SelfDeclaredFormValue,
  type SelfDeclaredRating,
} from "@/lib/fit/self-declared";

/**
 * "How do you do research?" (PR 0.7, D5 wording): the seven-family rating
 * grid, the materials checklist and "Directions I'm moving toward". Shared by
 * the onboarding step and the edit-investigator sheet; the sheet also shows
 * the do-not-suggest list. An unrated row stores nothing, so "Not my work" is
 * an answer, not a default.
 */
export function SelfDeclaredFields({
  value,
  onChange,
  showDoNotSuggest = false,
  labelSize = 13,
}: {
  value: SelfDeclaredFormValue;
  onChange: (next: SelfDeclaredFormValue) => void;
  showDoNotSuggest?: boolean;
  labelSize?: 13 | 12;
}) {
  const uid = useId();
  const setRating = (family: ParadigmFamily, rating: SelfDeclaredRating) => onChange({ ...value, paradigm: { ...value.paradigm, [family]: rating } });
  const toggleMaterial = (kind: MaterialsKind, on: boolean) =>
    onChange({ ...value, materials: on ? [...value.materials, kind] : value.materials.filter((k) => k !== kind) });
  const toggleExclude = (family: ParadigmFamily, on: boolean) =>
    onChange({ ...value, do_not_suggest: on ? [...value.do_not_suggest, family] : value.do_not_suggest.filter((f) => f !== family) });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1 mt-0 text-dense font-medium text-ink">How you do research</p>
        <p className="mb-2 mt-0 text-meta leading-normal text-ink-muted">
          Rate each way of working. Suggestions are gated on this; leave a row blank if you&apos;d rather not say.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-dense">
            <thead>
              <tr className="text-left text-meta text-ink-muted">
                <th className="py-1.5 pr-3 font-medium">Way of working</th>
                {SELF_DECLARED_RATINGS.map((r) => (
                  <th key={r.value} className="w-[84px] py-1.5 text-center font-medium">{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SELF_DECLARED_FAMILY_ROWS.map((row) => (
                <tr key={row.family} className="border-t border-line-row">
                  <td className="py-2 pr-3 align-top">
                    <span className="block text-ink">{row.label}</span>
                    <span className="block text-meta leading-normal text-ink-muted">{row.hint}</span>
                  </td>
                  {SELF_DECLARED_RATINGS.map((r) => (
                    <td key={r.value} className="py-2 text-center align-top">
                      <input
                        type="radio"
                        name={`${uid}-${row.family}`}
                        value={r.value}
                        checked={value.paradigm[row.family] === r.value}
                        onChange={() => setRating(row.family, r.value)}
                        aria-label={`${row.label}: ${r.label}`}
                        className="mt-1 accent-navy"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="mb-1 mt-0 text-dense font-medium text-ink">Materials and data you work with</p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {MATERIALS_GROUPS.map((g) => (
            <fieldset key={g.key} className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-1 text-meta font-medium uppercase text-ink-muted">{g.label}</legend>
              <div className="flex flex-col gap-1">
                {g.kinds.map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-dense text-ink-body">
                    <Checkbox checked={value.materials.includes(kind)} onChange={(e) => toggleMaterial(kind, e.target.checked)} />
                    {MATERIALS_LABEL[kind]}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>

      <Field
        label="Directions I'm moving toward"
        labelSize={labelSize}
        help="One per line. Opens Exploratory suggestions in that direction; it never raises a tier on its own."
      >
        {({ id }) => (
          <Textarea
            id={id}
            value={value.aspirations}
            onChange={(e) => onChange({ ...value, aspirations: e.target.value })}
            className="min-h-[72px]"
            placeholder={"implementation science\nhuman tissue work in IBD"}
          />
        )}
      </Field>

      {showDoNotSuggest ? (
        <div>
          <p className="mb-1 mt-0 text-dense font-medium text-ink">Don&apos;t suggest</p>
          <p className="mb-2 mt-0 text-meta leading-normal text-ink-muted">Notices that are mainly about these are excluded outright.</p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {SELF_DECLARED_FAMILY_ROWS.map((row) => (
              <label key={row.family} className="flex items-center gap-2 text-dense text-ink-body">
                <Checkbox checked={value.do_not_suggest.includes(row.family)} onChange={(e) => toggleExclude(row.family, e.target.checked)} />
                {row.label}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
