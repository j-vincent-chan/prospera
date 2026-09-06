"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveGoldLabel } from "@/app/actions/fit-goldset-actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { AxisCategoryOptions } from "@/lib/fit/goldset/page-view";
import { FEEDBACK_REASONS, REASON_REQUIRED_TIERS, TIER_LABEL_GOLD, WRONG_TYPE_PRESETS } from "@/lib/fit/goldset/reasons";
import { TIER_IDS } from "@/lib/fit/taxonomy";
import type { Tier } from "@/lib/fit/types";

const AXES = ["paradigm", "unit", "design", "materials", "objective", "topic"] as const;
type AxisId = (typeof AXES)[number];
const AXIS_LABEL: Record<AxisId, string> = { paradigm: "Paradigm", unit: "Unit of analysis", design: "Study design", materials: "Materials and data", objective: "Scientific objective", topic: "Topic" };

export type SavedLabel = { tier: Tier; reason: string | null; axis_reason: string | null };

/**
 * One pair's label form for the signed-in labeler's slot (plan § PR 2.4):
 * tier, reason (required for Exploratory / Poor), and for "wrong type of
 * research" the axis sub-reason — a §12 quick pick or any axis + category
 * from the taxonomy. Saves through `saveGoldLabel`; the page refreshes so the
 * status column and progress update.
 */
export function GoldLabelForm({ investigatorId, opportunityId, saved, options }: { investigatorId: string; opportunityId: string; saved: SavedLabel | null; options: AxisCategoryOptions }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tier, setTier] = useState<string>(saved?.tier ?? "");
  const [reason, setReason] = useState<string>(saved?.reason ?? "");
  const presetFor = (axisReason: string | null) => WRONG_TYPE_PRESETS.find((p) => p.axis_reason === axisReason)?.id ?? (axisReason ? "custom" : "");
  const [preset, setPreset] = useState<string>(presetFor(saved?.axis_reason ?? null));
  const initialAxis = saved?.axis_reason?.split(":")[0] ?? "paradigm";
  const [axis, setAxis] = useState<AxisId>((AXES as readonly string[]).includes(initialAxis) ? (initialAxis as AxisId) : "paradigm");
  const [category, setCategory] = useState<string>(saved?.axis_reason?.split(":")[1] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(saved ? "Saved" : null);

  const needsReason = REASON_REQUIRED_TIERS.includes(tier as Tier);
  const wrongType = reason === "wrong_type";
  const axisReason = !wrongType ? "" : preset === "custom" ? (category ? `${axis}:${category}` : axis === "topic" ? "topic" : "") : (WRONG_TYPE_PRESETS.find((p) => p.id === preset)?.axis_reason ?? "");
  const dirty = !saved || saved.tier !== tier || (saved.reason ?? "") !== reason || (saved.axis_reason ?? "") !== axisReason;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveGoldLabel({ investigatorId, opportunityId, tier, reason: reason || null, axisReason: axisReason || null });
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
        {FEEDBACK_REASONS.map((r) => (
          <option key={r.id} value={r.id} title={r.description}>
            {r.label}
          </option>
        ))}
      </Select>
      {wrongType ? (
        <>
          <Select size={30} value={preset} onChange={(e) => { setPreset(e.target.value); setDone(null); }} aria-label="Wrong type — which axis" className="w-full">
            <option value="">Which axis…</option>
            {WRONG_TYPE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.axis_reason})
              </option>
            ))}
            <option value="custom">Another axis or category…</option>
          </Select>
          {preset === "custom" ? (
            <div className="flex gap-1.5">
              <Select size={30} value={axis} onChange={(e) => { setAxis(e.target.value as AxisId); setCategory(""); setDone(null); }} aria-label="Axis" className="w-1/2">
                {AXES.map((a) => (
                  <option key={a} value={a}>
                    {AXIS_LABEL[a]}
                  </option>
                ))}
              </Select>
              <Select size={30} value={category} onChange={(e) => { setCategory(e.target.value); setDone(null); }} aria-label="Category" className="w-1/2" disabled={axis === "topic"}>
                <option value="">{axis === "topic" ? "(whole axis)" : "Category…"}</option>
                {options[axis].map((c) => (
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
        <Button type="submit" size={28} disabled={pending || !tier || (needsReason && !reason) || (wrongType && !axisReason) || !dirty}>
          {pending ? "Saving…" : saved ? "Update" : "Save"}
        </Button>
        {done && !dirty ? <span className="text-micro font-medium text-success">{done}</span> : null}
      </div>
      {error ? <p className="m-0 text-micro text-danger">{error}</p> : null}
    </form>
  );
}
