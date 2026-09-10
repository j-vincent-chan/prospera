"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { RadioCard } from "@/components/ui/radio-card";
import { Select } from "@/components/ui/select";
import { AXES, type Axis } from "@/lib/fit/classify/contracts";
import { axisCategoryOptions } from "@/lib/fit/goldset/page-view";
import { subreasonOf } from "@/lib/fit/feedback/dismissal";
import { axisLabel } from "@/lib/fit/inspect/labels";
import { wrongResearchTypeSubreasons } from "@/lib/fit/taxonomy";

const PRESETS = wrongResearchTypeSubreasons();
const OPTIONS = axisCategoryOptions();
const CUSTOM = "custom";

/**
 * The "wrong type of research" sub-reason (plan § PR 3.2; spec §12): the
 * taxonomy's quick picks ("I don't run trials" → paradigm:clinical_trials …)
 * as radio cards; a pick that names only an axis (materials) offers that
 * axis's categories — optional for the dismissal, needed to propose a profile
 * correction — and "another axis or category" opens the picker over the five
 * structured axes. Topic is not offered: topic never gates, so a topical
 * complaint is the "Wrong subject (what they study)" reason, not a wrong type
 * of research. What is sent is `<axis>` or `<axis>:<category>`, exactly what the
 * action validates.
 */
export function DismissDialog({ name, open, onClose, onSubmit, pending }: { name: string; open: boolean; onClose: () => void; onSubmit: (axisReason: string) => void; pending: boolean }) {
  const [preset, setPreset] = useState<string>(PRESETS[0]?.id ?? CUSTOM);
  const [axis, setAxis] = useState<Axis>("paradigm");
  const [category, setCategory] = useState("");
  const chosen = PRESETS.find((p) => p.id === preset) ?? null;
  const presetParts = chosen ? subreasonOf(chosen.axis_reason) : null;
  const presetAxisOnly = Boolean(presetParts?.axis && !presetParts.category);
  const categoryAxis: Axis | null = preset === CUSTOM ? axis : presetAxisOnly ? (presetParts!.axis as Axis) : null;
  const axisReason = preset === CUSTOM ? (category ? `${axis}:${category}` : axis) : chosen ? (presetAxisOnly && category ? `${chosen.axis_reason}:${category}` : chosen.axis_reason) : "";
  const proposes = axisReason.includes(":");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Wrong type of research"
      description={`Which axis makes ${name} the wrong type of research for this notice? The dismissal is recorded against that axis; a pick that names a category also proposes a profile correction you confirm next. If they work this way but on a different subject, that is “Wrong subject”, not this.`}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={pending || !axisReason} onClick={() => onSubmit(axisReason)}>
            {pending ? "Dismissing…" : proposes ? "Dismiss and propose correction" : "Dismiss"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5 py-1">
        {PRESETS.map((p) => (
          <RadioCard key={p.id} name="wrong-type" title={p.label} suffix={`· ${p.axis_reason}`} checked={preset === p.id} onChange={() => { setPreset(p.id); setCategory(""); }} />
        ))}
        <RadioCard name="wrong-type" title="Another axis or category…" checked={preset === CUSTOM} onChange={() => { setPreset(CUSTOM); setCategory(""); }} />
        {categoryAxis ? (
          <div className="mt-1 flex gap-1.5">
            {preset === CUSTOM ? (
              <Select size={30} value={axis} onChange={(e) => { setAxis(e.target.value as Axis); setCategory(""); }} aria-label="Axis" className="w-1/2">
                {AXES.map((a) => (
                  <option key={a} value={a}>
                    {axisLabel(a)}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select size={30} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={`${axisLabel(categoryAxis)} category`} className={preset === CUSTOM ? "w-1/2" : "w-full"}>
              <option value="">{`${axisLabel(categoryAxis)} — which kind? (needed to propose a correction)`}</option>
              {OPTIONS[categoryAxis].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <p className="mb-0 mt-1 text-meta leading-normal text-ink-muted">
          Sub-reason sent: <code className="font-mono">{axisReason || "—"}</code>. {proposes ? "This names a category, so a one-click profile correction follows." : "No category named: recorded as a label; no profile correction is proposed."}
        </p>
      </div>
    </Dialog>
  );
}
