"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveGoldLabel } from "@/app/actions/fit-goldset-actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { AxisCategoryOptions } from "@/lib/fit/goldset/page-view";
import { goldReasons, TIER_LABEL_GOLD } from "@/lib/fit/goldset/reasons";
import { feedbackReason, reasonRequiredTiers, TIER_IDS, wrongResearchTypeSubreasons } from "@/lib/fit/taxonomy";
import type { Tier } from "@/lib/fit/types";

const AXES = ["paradigm", "unit", "design", "materials", "objective", "topic"] as const;
type AxisId = (typeof AXES)[number];
const AXIS_LABEL: Record<AxisId, string> = { paradigm: "Paradigm", unit: "Unit of analysis", design: "Study design", materials: "Materials and data", objective: "Scientific objective", topic: "Topic" };
const isAxis = (s: string): s is AxisId => (AXES as readonly string[]).includes(s);

export type SavedLabel = { tier: Tier; reason: string | null; axis_reason: string | null };

const REASONS = goldReasons();
const PRESETS = wrongResearchTypeSubreasons();
const REQUIRED_TIERS = reasonRequiredTiers();

/** `<axis>` or `<axis>:<category>` split. */
const splitAxis = (axisReason: string | null): { axis: AxisId | null; category: string } => {
  if (!axisReason) return { axis: null, category: "" };
  const i = axisReason.indexOf(":");
  const axis = i < 0 ? axisReason : axisReason.slice(0, i);
  return { axis: isAxis(axis) ? axis : null, category: i < 0 ? "" : axisReason.slice(i + 1) };
};

/** The preset a saved sub-reason came from: an exact match, or an axis-only preset whose axis it refines; else "custom". */
const presetFor = (axisReason: string | null): string => {
  if (!axisReason) return "";
  const exact = PRESETS.find((p) => p.axis_reason === axisReason);
  if (exact) return exact.id;
  const { axis } = splitAxis(axisReason);
  const axisOnly = PRESETS.find((p) => p.axis_reason === axis);
  return axisOnly ? axisOnly.id : "custom";
};

/**
 * One pair's label form for the signed-in labeler's slot (plan § PR 2.4):
 * tier, reason (required for the tiers `taxonomy.json ›
 * feedback.reason_required_tiers` names), and for a reason that names an
 * axis ("wrong type of research") the sub-reason — a §12 quick pick from
 * `feedback.wrong_research_type_subreasons` (a pick that names only an axis
 * offers the axis's categories, optional — D34), or any axis with an
 * optional category. The sub-reason sent is `<axis>` or `<axis>:<category>`,
 * exactly what `parseAxisSubReason` accepts. The subject is the roster
 * investigator, or the fixture case (`syntheticSource`) of a synthetic pair.
 * Saves through `saveGoldLabel`; the page refreshes so the status column
 * and progress update.
 */
export function GoldLabelForm({ investigatorId, syntheticSource = null, opportunityId, saved, options }: { investigatorId: string | null; syntheticSource?: string | null; opportunityId: string; saved: SavedLabel | null; options: AxisCategoryOptions }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tier, setTier] = useState<string>(saved?.tier ?? "");
  const [reason, setReason] = useState<string>(saved?.reason ?? "");
  const [preset, setPreset] = useState<string>(presetFor(saved?.axis_reason ?? null));
  const initial = splitAxis(saved?.axis_reason ?? null);
  const [axis, setAxis] = useState<AxisId>(initial.axis ?? "paradigm");
  const [category, setCategory] = useState<string>(initial.category);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(saved ? "Saved" : null);

  const needsReason = REQUIRED_TIERS.includes(tier as Tier);
  const needsAxis = Boolean(reason) && REASONS.some((r) => r.id === reason && r.axis_required);
  const chosen = PRESETS.find((p) => p.id === preset) ?? null;
  const presetAxis = chosen ? splitAxis(chosen.axis_reason) : null;
  /** An axis-only pick ("materials") leaves the category to the labeler. */
  const presetAxisOnly = Boolean(presetAxis && presetAxis.axis && !presetAxis.category);
  const axisReason = !needsAxis
    ? ""
    : preset === "custom"
      ? category ? `${axis}:${category}` : axis
      : chosen
        ? presetAxisOnly && category ? `${chosen.axis_reason}:${category}` : chosen.axis_reason
        : "";
  const dirty = !saved || saved.tier !== tier || (saved.reason ?? "") !== reason || (saved.axis_reason ?? "") !== axisReason;
  const categoryAxis: AxisId | null = preset === "custom" ? axis : presetAxisOnly ? presetAxis!.axis : null;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveGoldLabel({ investigatorId, syntheticSource, opportunityId, tier, reason: reason || null, axisReason: axisReason || null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(r.unchanged ? "Saved (unchanged)" : `Saved as ${r.slot}`);
      router.refresh();
    });
  };

  return (
    <form
      className="flex w-full min-w-[220px] flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Select size={30} value={tier} onChange={(e) => { setTier(e.target.value); setDone(null); }} aria-label="Tier" className="w-full">
        <option value="">Tier…</option>
        {TIER_IDS.map((t) => (
          <option key={t} value={t}>
            {TIER_LABEL_GOLD[t]}
          </option>
        ))}
      </Select>
      <Select size={30} value={reason} onChange={(e) => { setReason(e.target.value); setDone(null); }} aria-label="Reason" className="w-full" disabled={!tier}>
        <option value="">{needsReason ? "Reason (required)…" : "Reason (optional)…"}</option>
        {REASONS.map((r) => (
          <option key={r.id} value={r.id} title={r.model_use}>
            {r.label}
          </option>
        ))}
      </Select>
      {needsAxis ? (
        <>
          <Select size={30} value={preset} onChange={(e) => { setPreset(e.target.value); setCategory(""); setDone(null); }} aria-label={`${feedbackReason(reason).label} — which axis`} className="w-full">
            <option value="">Which axis…</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.axis_reason})
              </option>
            ))}
            <option value="custom">Another axis or category…</option>
          </Select>
          {categoryAxis ? (
            <div className="flex gap-1.5">
              {preset === "custom" ? (
                <Select size={30} value={axis} onChange={(e) => { setAxis(e.target.value as AxisId); setCategory(""); setDone(null); }} aria-label="Axis" className="w-1/2">
                  {AXES.map((a) => (
                    <option key={a} value={a}>
                      {AXIS_LABEL[a]}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Select size={30} value={category} onChange={(e) => { setCategory(e.target.value); setDone(null); }} aria-label={`${AXIS_LABEL[categoryAxis]} category`} className={preset === "custom" ? "w-1/2" : "w-full"} disabled={categoryAxis === "topic"}>
                <option value="">{categoryAxis === "topic" ? "(whole axis)" : `${AXIS_LABEL[categoryAxis]} — whole axis, or a category…`}</option>
                {options[categoryAxis].map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size={28} disabled={pending || !tier || (needsReason && !reason) || (needsAxis && !axisReason) || !dirty}>
          {pending ? "Saving…" : saved ? "Update" : "Save"}
        </Button>
        {done && !dirty ? <span className="text-micro font-medium text-success">{done}</span> : null}
      </div>
      {error ? <p className="m-0 text-micro text-danger">{error}</p> : null}
    </form>
  );
}
