"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { InvestigatorCsvForm } from "@/components/investigators/investigator-csv-form";
import { InvestigatorManualEntryForm } from "@/components/investigators/investigator-manual-entry-form";
import { InvestigatorSignalImportForm } from "@/components/investigators/investigator-signal-import-form";
import { Button } from "@/components/ui/button";

type CommunityOption = { id: string; label: string };

type AddTab = "manual" | "csv" | "signal";

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-[var(--fo-border)] bg-[var(--fo-paper)] px-3.5 py-2.5 text-sm text-[var(--fo-title)] shadow-sm placeholder:text-[var(--fo-ink-faint)] focus:border-[var(--fo-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--fo-focus-ring)]";

function StatChip({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[var(--fo-border)] bg-[var(--fo-paper)] px-3.5 py-2.5 shadow-sm">
      <p className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[var(--fo-ink-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-[var(--fo-display)]">{value}</p>
    </div>
  );
}

export function InvestigatorsPageChrome({
  q,
  tag,
  stats,
  researchCommunities,
  children,
}: {
  q: string;
  tag: string;
  stats: {
    showing: number;
    total: number;
    withEmail: number;
    withReporter: number;
    withCommunity: number;
  };
  researchCommunities: CommunityOption[];
  children: ReactNode;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<AddTab>("manual");
  const filtersActive = Boolean(q || tag);

  const tabClass = (tab: AddTab) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      addTab === tab
        ? "bg-[var(--fo-paper)] text-[var(--fo-title)] shadow-sm ring-1 ring-[var(--fo-border)]"
        : "text-[var(--fo-ink-muted)] hover:text-[var(--fo-title)]"
    }`;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="app-page-title">People</h1>
          <p className="app-page-description max-w-2xl">
            Investigator directory for outreach, community tagging, and NIH opportunity matching.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={() => setAddOpen((o) => !o)}>
            {addOpen ? "Close" : "Add person"}
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatChip label="In directory" value={stats.total} />
        <StatChip label="Showing" value={stats.showing} />
        <StatChip label="With email" value={stats.withEmail} />
        <StatChip label="RePORTER linked" value={stats.withReporter} />
      </div>

      {addOpen ? (
        <section className="overflow-hidden rounded-2xl border border-[var(--fo-border)] bg-[var(--card)] shadow-soft">
          <div className="border-b border-[var(--fo-divider)] bg-[var(--fo-paper-2)]/70 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--fo-display)]">Add to directory</h2>
                <p className="mt-0.5 text-xs text-[var(--fo-ink-muted)]">
                  Enter one person, upload a CSV, or sync from Signal.
                </p>
              </div>
              <div className="inline-flex rounded-xl border border-[var(--fo-border)] bg-[var(--fo-inset)] p-1">
                <button type="button" className={tabClass("manual")} onClick={() => setAddTab("manual")}>
                  Manual entry
                </button>
                <button type="button" className={tabClass("csv")} onClick={() => setAddTab("csv")}>
                  CSV import
                </button>
                <button type="button" className={tabClass("signal")} onClick={() => setAddTab("signal")}>
                  Signal sync
                </button>
              </div>
            </div>
          </div>
          <div className="px-5 py-5">
            {addTab === "manual" ? (
              <InvestigatorManualEntryForm communities={researchCommunities} variant="page" />
            ) : null}
            {addTab === "csv" ? (
              <div className="max-w-2xl space-y-3">
                <p className="text-xs leading-relaxed text-[var(--fo-ink-muted)]">
                  Columns: first_name, last_name, email, home_department, division, rank, affiliations,
                  primary_research_area, and related profile fields.
                </p>
                <InvestigatorCsvForm />
              </div>
            ) : null}
            {addTab === "signal" ? (
              <div className="max-w-3xl">
                <InvestigatorSignalImportForm />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-[var(--fo-border)] bg-[var(--card)] shadow-soft">
        <div className="border-b border-[var(--fo-divider)] bg-[var(--fo-paper-2)]/70 px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--fo-display)]">Directory</h2>
              <p className="mt-0.5 text-xs text-[var(--fo-ink-muted)]">
                {filtersActive
                  ? `${stats.showing} match${stats.showing === 1 ? "" : "es"} with current filters`
                  : `${stats.total} investigator${stats.total === 1 ? "" : "s"} · ${stats.withCommunity} assigned to a research community`}
              </p>
            </div>
            <form className="flex w-full flex-col gap-3 sm:flex-row sm:items-end lg:max-w-2xl" method="get">
              <label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--fo-ink-muted)]">
                Search name
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="e.g. Chen"
                  className={fieldClass}
                />
              </label>
              <label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--fo-ink-muted)]">
                Tag
                <input
                  name="tag"
                  defaultValue={tag}
                  placeholder="e.g. tumor_immunology"
                  className={fieldClass}
                />
              </label>
              <div className="flex shrink-0 gap-2">
                <Button type="submit" variant="secondary">
                  Apply
                </Button>
                {filtersActive ? (
                  <Link href="/investigators">
                    <Button type="button" variant="ghost" className="text-xs">
                      Clear
                    </Button>
                  </Link>
                ) : null}
              </div>
            </form>
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}
