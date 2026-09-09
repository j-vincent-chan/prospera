"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { saveGoldLabel } from "@/app/actions/fit-goldset-actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { AxisCategoryOptions } from "@/lib/fit/goldset/page-view";
import { goldReasons, TIER_LABEL_GOLD } from "@/lib/fit/goldset/reasons";
import { feedbackReason, reasonRequiredTiers, TIER_IDS, wrongResearchTypeSubreasons } from "@/lib/fit/taxonomy";
import type { Tier } from "@/lib/fit/types";
import { cn } from "@/lib/utils/cn";

const AXES = ["paradigm", "unit", "design", "materials", "objective", "topic"] as const;
type AxisId = (typeof AXES)[number];
const AXIS_LABEL: Record<AxisId, string> = { paradigm: "Paradigm", unit: "Unit of analysis", design: "Study design", materials: "Materials and data", objective: "Scientific objective", topic: "Topic" };
const isAxis = (s: string): s is AxisId => (AXES as readonly string[]).includes(s);

export type SavedLabel = { tier: Tier; reason: string | null; axis_reason: string | null };

const REASONS = goldReasons();
const PRESETS = wrongResearchTypeSubreasons();
const REQUIRED_TIERS = reasonRequiredTiers();

/** The selected tier's own fill, mirroring `pill.tsx` (calibration redesign § "Focus card"). */
const TIER_FILL: Record<Tier, string> = {
  strong: "bg-teal text-white",
  moderate: "bg-teal-tint text-teal",
  exploratory: "bg-card text-ink",
  poor: "bg-line-row text-ink-body",
};

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

/** True while the keystroke belongs to whatever the user is typing in. */
const typing = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
};

/**
 * One pair's label form for the signed-in labeler's slot (plan § PR 2.4;
 * calibration redesign § "Focus card"): the tier as four 44px buttons keyed
 * `1`–`4`, the reason (required for the tiers `taxonomy.json ›
 * feedback.reason_required_tiers` names), and for a reason that names an
 * axis ("wrong type of research") the sub-reason — a §12 quick pick from
 * `feedback.wrong_research_type_subreasons` (a pick that names only an axis
 * offers the axis's categories, optional — D34), or any axis with an
 * optional category. The sub-reason sent is `<axis>` or `<axis>:<category>`,
 * exactly what `parseAxisSubReason` accepts. The subject is the roster
 * investigator, or the fixture case (`syntheticSource`) of a synthetic pair.
 *
 * Saves through the unchanged `saveGoldLabel` server action, then refreshes
 * and advances to the next pair of the current filter — in "My queue" the
 * saved pair leaves the list, so the pair that was next simply takes its
 * place. The state resets on a pair change because the page remounts this
 * form under the pair's key.
 */
export function GoldLabelForm({
  pairId,
  investigatorId,
  syntheticSource = null,
  opportunityId,
  saved,
  options,
  prevHref = null,
  nextHref = null,
}: {
  /** `g063` — the confirmation names it, and the keyboard nav needs no id of its own. */
  pairId: string;
  investigatorId: string | null;
  syntheticSource?: string | null;
  opportunityId: string;
  saved: SavedLabel | null;
  options: AxisCategoryOptions;
  /** The neighbouring pairs in the current filter; null at either end of it. */
  prevHref?: string | null;
  nextHref?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tier, setTier] = useState<string>(saved?.tier ?? "");
  const [reason, setReason] = useState<string>(saved?.reason ?? "");
  const [preset, setPreset] = useState<string>(presetFor(saved?.axis_reason ?? null));
  const initial = splitAxis(saved?.axis_reason ?? null);
  const [axis, setAxis] = useState<AxisId>(initial.axis ?? "paradigm");
  const [category, setCategory] = useState<string>(initial.category);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

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
  const categoryAxis: AxisId | null = preset === "custom" ? axis : presetAxisOnly ? presetAxis!.axis : null;
  const canSave = !pending && Boolean(tier) && !(needsReason && !reason) && !(needsAxis && !axisReason);

  const submit = useCallback(() => {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      const r = await saveGoldLabel({ investigatorId, syntheticSource, opportunityId, tier, reason: reason || null, axisReason: axisReason || null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(r.unchanged ? `Saved ${pairId} (unchanged)` : `Saved ${pairId}`);
      // Refresh first: it drops the client router cache, so the push below
      // fetches the next pair against the label that was just written rather
      // than a payload rendered before it.
      router.refresh();
      if (nextHref) router.push(nextHref);
    });
  }, [axisReason, canSave, investigatorId, nextHref, opportunityId, pairId, reason, router, syntheticSource, tier]);

  const move = useCallback(
    (href: string | null) => {
      if (href) router.push(href);
    },
    [router],
  );

  // Window-level, so a grader never has to click into the card first; a
  // keystroke aimed at one of the selects is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const picked = TIER_IDS[Number(e.key) - 1];
      if (/^[1-9]$/.test(e.key) && picked) {
        e.preventDefault();
        setTier(picked);
        setDone(null);
        return;
      }
      const k = e.key.toLowerCase();
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "ArrowRight" || k === "j") {
        e.preventDefault();
        move(nextHref);
      } else if (e.key === "ArrowLeft" || k === "k") {
        e.preventDefault();
        move(prevHref);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, nextHref, prevHref, submit]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="mt-3 flex flex-wrap gap-2.5">
        {TIER_IDS.map((t, i) => (
          <button
            key={t}
            type="button"
            aria-pressed={tier === t}
            onClick={() => {
              setTier(t);
              setDone(null);
            }}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-control border px-[18px] text-[15px] font-semibold",
              tier === t ? cn("border-navy shadow-[0_0_0_1px_#0b1d3a]", TIER_FILL[t]) : "border-line-control bg-card text-ink-body",
            )}
          >
            <kbd className="rounded border border-current px-[5px] font-sans text-micro font-medium opacity-60">{i + 1}</kbd>
            {TIER_LABEL_GOLD[t]}
          </button>
        ))}
      </div>

      {needsReason || reason ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <label className="text-dense text-ink-body" htmlFor={`why-${pairId}`}>
            Why?
          </label>
          <Select id={`why-${pairId}`} size={32} value={reason} onChange={(e) => { setReason(e.target.value); setDone(null); }} aria-label="Reason" className="min-w-[280px]">
            <option value="">{needsReason ? "Reason (required)…" : "Reason (optional)…"}</option>
            {REASONS.map((r) => (
              <option key={r.id} value={r.id} title={r.model_use}>
                {r.label}
              </option>
            ))}
          </Select>
          {needsAxis ? (
            <>
              <Select size={32} value={preset} onChange={(e) => { setPreset(e.target.value); setCategory(""); setDone(null); }} aria-label={`${feedbackReason(reason).label} — which axis`} className="min-w-[300px]">
                <option value="">Which axis…</option>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.axis_reason})
                  </option>
                ))}
                <option value="custom">Another axis or category…</option>
              </Select>
              {categoryAxis ? (
                <>
                  {preset === "custom" ? (
                    <Select size={32} value={axis} onChange={(e) => { setAxis(e.target.value as AxisId); setCategory(""); setDone(null); }} aria-label="Axis" className="min-w-[180px]">
                      {AXES.map((a) => (
                        <option key={a} value={a}>
                          {AXIS_LABEL[a]}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  <Select size={32} value={category} onChange={(e) => { setCategory(e.target.value); setDone(null); }} aria-label={`${AXIS_LABEL[categoryAxis]} category`} className="min-w-[240px]" disabled={categoryAxis === "topic"}>
                    <option value="">{categoryAxis === "topic" ? "(whole axis)" : `${AXIS_LABEL[categoryAxis]} — whole axis, or a category…`}</option>
                    {options[categoryAxis].map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" size={36} disabled={!canSave}>
          {pending ? "Saving…" : saved ? "Update and next" : "Save and next"}
        </Button>
        <Button variant="quiet" size={36} onClick={() => move(nextHref)} disabled={!nextHref}>
          Skip for now
        </Button>
        {done ? <span className="text-dense font-medium text-success">{done}</span> : null}
      </div>
      {error ? <p className="m-0 mt-2 text-dense text-danger">{error}</p> : null}
    </form>
  );
}

const ABOUT_KEY = "prospera.calibration.about";

const readAbout = (): boolean => {
  try {
    return window.localStorage.getItem(ABOUT_KEY) === "open";
  } catch {
    return false;
  }
};

/**
 * The page header with its "How this works" disclosure (calibration redesign
 * § 1.2–1.3). `children` is the title block and `panel` the explanation, both
 * rendered on the server; only the open/closed bit is client state, kept in
 * `localStorage` so the panel stays collapsed between sessions. `useHydrated`
 * holds the first client render to the server's collapsed markup, so a
 * grader who left it open gets it back without a hydration mismatch.
 */
export function HowThisWorks({ children, panel }: { children: ReactNode; panel: ReactNode }) {
  const hydrated = useHydrated();
  const [override, setOverride] = useState<boolean | null>(null);
  const stored = useMemo(() => (hydrated ? readAbout() : false), [hydrated]);
  const open = override ?? stored;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">{children}</div>
        <Button
          variant="secondary"
          size={32}
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOverride(next);
            try {
              window.localStorage.setItem(ABOUT_KEY, next ? "open" : "closed");
            } catch {
              // A browser that refuses storage still gets the toggle.
            }
          }}
        >
          {open ? "Hide how this works" : "How this works"}
        </Button>
      </header>
      {open ? panel : null}
    </>
  );
}
