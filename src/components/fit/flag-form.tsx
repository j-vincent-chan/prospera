"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { flagFitProfile } from "@/app/actions/fit-inspector-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { axisReasonOf, FLAG_REASON_MAX, type FlagTarget } from "@/lib/fit/inspect/flags";
import { axisLabel, type InspectAxis } from "@/lib/fit/inspect/labels";

/**
 * "Flag as wrong" (plan § PR 1.6): a button that opens a small inline form
 * and submits to `flagFitProfile`. Three placements share it:
 *   - a category row: `axis` + `category` fixed, only the reason is asked;
 *   - an axis card: `axis` + `categories` — a select picks the category or
 *     "the whole axis";
 *   - the whole profile: no axis; the reason is required.
 * The server action validates and writes; on success the page refreshes so
 * the flag appears in the list.
 */
export function FlagButton({
  target,
  axis,
  category,
  categoryLabel,
  categories,
  label = "Flag as wrong",
  size = 28,
  variant = "ghost",
}: {
  target: FlagTarget;
  axis?: InspectAxis;
  category?: string;
  /** Display label for `category` (the form shows it; the action stores the id). */
  categoryLabel?: string;
  categories?: Array<{ id: string; label: string }>;
  label?: string;
  size?: 28 | 32;
  variant?: "ghost" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [picked, setPicked] = useState<string>(category ?? "");
  const [reason, setReason] = useState("");

  const scope = axis ? (category ? `${axisLabel(axis)} · ${categoryLabel ?? category}` : axisLabel(axis)) : "whole profile";
  const needsReason = !axis;

  if (done) return <span className="text-meta font-medium text-success">Flagged</span>;

  if (!open) {
    return (
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} aria-label={`${label}: ${scope}`}>
        {label}
      </Button>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const axisReason = axisReasonOf(axis ?? null, category ?? (picked || null));
      const r = await flagFitProfile({ ...target, axisReason, reason });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  return (
    <form
      className="flex w-full max-w-[520px] flex-col gap-2.5 rounded-card border border-line-control bg-canvas p-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="m-0 text-dense font-medium text-ink">
        Flag as wrong — <span className="font-normal text-ink-muted">{scope}</span>
      </p>
      {axis && !category && categories?.length ? (
        <Field label="Which category is wrong?" labelSize={12}>
          {({ id }) => (
            <Select id={id} size={32} value={picked} onChange={(e) => setPicked(e.target.value)} className="w-full">
              <option value="">The whole {axisLabel(axis).toLowerCase()} axis</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <Field label={needsReason ? "What is wrong?" : "Why?"} hint={needsReason ? undefined : "(optional)"} labelSize={12} error={error} help={`${reason.length} / ${FLAG_REASON_MAX}`}>
        {({ id, invalid }) => (
          <Textarea
            id={id}
            invalid={invalid}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={FLAG_REASON_MAX}
            rows={3}
            placeholder={needsReason ? "e.g. the recent view says translational but every recent paper is mouse mechanism" : "e.g. these are review articles, not trials"}
            autoFocus
          />
        )}
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size={28} disabled={pending || (needsReason && !reason.trim())}>
          {pending ? "Flagging…" : "Flag"}
        </Button>
        <Button type="button" variant="ghost" size={28} onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
