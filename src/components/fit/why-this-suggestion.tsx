import Link from "next/link";
import type { ReactNode } from "react";
import { ComponentBars } from "@/components/fit/component-bars";
import { EvidenceChips, type EvidenceChip } from "@/components/fit/evidence-chips";
import { fmtMonDYear } from "@/lib/investigators/sources";
import type { PairDetail } from "@/lib/fit/pair-detail";
import { cn } from "@/lib/utils/cn";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">{title}</p>
      {children}
    </section>
  );
}

function Tags({ items, mono }: { items: readonly string[]; mono?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <span key={`${t}-${i}`} className={cn("inline-flex h-[22px] items-center rounded-full bg-line-row px-2 text-meta text-ink-body", mono && "font-mono")}>
          {t}
        </span>
      ))}
    </span>
  );
}

/**
 * "Why this suggestion" (plan § PR 3.2, follow-up "3.2b"): the disclosure a fit row carries in
 * place of the nine-component rationale it used to print. Everything here is
 * the engine's own record of the pair — components against the floors of the
 * tier above, the caps that held the tier, the paradigm and unit pairs, the
 * required designs with no support, the coded topic matches with their MeSH
 * tree depth, methods, mechanisms held, and the eligibility rules Prospera
 * could not check, quoted in the notice's words.
 *
 * The layout is the admin inspector's (`/investigators/[id]/fit`): labelled
 * blocks, a weight bar with its number, tags for coded values, a quote for
 * notice text. Closed by default and rendered server-side, so a board of
 * seventy-six rows costs seventy-six summary lines to read, not seventy-six
 * paragraphs.
 *
 * `collaboratorNames` resolves `provenance.collaborators` — the engine stores
 * investigator ids there, and an id is not an answer to "who could carry
 * this". A surface that cannot resolve them says how many there are.
 */
export function WhyThisSuggestion({
  detail,
  evidence,
  collaboratorNames,
  label = "Why this suggestion",
  className,
}: {
  detail: PairDetail;
  /** The items the rationale cites, already resolved by the surface. */
  evidence?: readonly EvidenceChip[];
  collaboratorNames?: ReadonlyMap<string, string>;
  label?: string;
  className?: string;
}) {
  const d = detail;
  const hasDesign = d.design.unmet.length > 0 || d.design.prohibited !== null;
  const hasMethods = d.methods.met.length > 0 || d.methods.missing.length > 0;
  const hasTrack = d.track.held.length > 0 || d.track.activityCode !== null;
  return (
    <details className={cn("group mt-1.5", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-meta font-medium text-teal hover:text-navy">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
        {label}
      </summary>
      <div className="mt-2 flex flex-col gap-3 rounded-card border border-line bg-footer-bar px-3.5 py-3">
        <p className="m-0 text-meta text-ink-muted">
          {d.tierWord} · S {d.score.toFixed(0)} · scored {fmtMonDYear(d.computedAt)} · <span className="font-mono">{d.engineVersion}</span>
        </p>

        <Block title="Components">
          <ComponentBars rows={d.components} against={d.measuredAgainst} />
        </Block>

        {d.floorsMissed.length || d.caps.length ? (
          <Block title={d.measuredAgainst ? `What stands between this and ${d.measuredAgainst === "strong" ? "Strong" : d.measuredAgainst === "moderate" ? "Moderate" : "Exploratory"}` : "What held the tier"}>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-dense leading-normal text-ink-body">
              {d.floorsMissed.map((f) => (
                <li key={f.key}>
                  {f.label} is {f.value.toFixed(2)}; the floor is {f.floor.toFixed(2)}.
                </li>
              ))}
              {d.caps.map((c, i) => (
                <li key={`cap-${i}`}>{c}.</li>
              ))}
            </ul>
          </Block>
        ) : null}

        {d.flags.length ? (
          <Block title="Worth knowing">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-dense leading-normal text-warning-dark">
              {d.flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </Block>
        ) : null}

        {d.paradigm.pair || d.unit || d.paradigm.excluded || d.paradigm.exception ? (
          <Block title="Paradigm and unit">
            <dl className="m-0 grid grid-cols-[minmax(96px,140px)_minmax(0,1fr)] gap-x-3 gap-y-1 text-dense">
              {d.paradigm.pair ? (
                <div className="contents">
                  <dt className="text-ink-muted">Best pair</dt>
                  <dd className="m-0">
                    {d.paradigm.pair}
                    {d.paradigm.view ? <span className="text-ink-muted"> · scored on {d.paradigm.view}</span> : null}
                  </dd>
                </div>
              ) : null}
              {d.unit ? (
                <div className="contents">
                  <dt className="text-ink-muted">Unit</dt>
                  <dd className="m-0">{d.unit}</dd>
                </div>
              ) : null}
              {d.paradigm.excluded ? (
                <div className="contents">
                  <dt className="text-ink-muted">Excluded</dt>
                  <dd className="m-0 text-danger">The notice excludes {d.paradigm.excluded}.</dd>
                </div>
              ) : null}
              {d.paradigm.exception ? (
                <div className="contents">
                  <dt className="text-ink-muted">Gate relaxed by</dt>
                  <dd className="m-0">the {d.paradigm.exception} — Exploratory at most</dd>
                </div>
              ) : null}
            </dl>
          </Block>
        ) : null}

        {hasDesign ? (
          <Block title="Study design">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-dense leading-normal text-ink-body">
              {d.design.unmet.map((g) => (
                <li key={g}>{g} — required, and nothing in the evidence supports it.</li>
              ))}
              {d.design.prohibited ? <li>The notice prohibits {d.design.prohibited}, which dominates the design evidence. The application is constrained, not the person.</li> : null}
            </ul>
          </Block>
        ) : null}

        {d.topic.codes.length ? (
          <Block title={`Coded topic matches · ${d.topic.codes.length}`}>
            <Tags mono items={d.topic.codes.map((m) => `${m.code} · depth ${m.depth}`)} />
            <p className="mb-0 mt-1 text-meta leading-normal text-ink-muted">MeSH tree numbers shared by the notice and the evidence; a deeper code is a more specific agreement.</p>
          </Block>
        ) : null}

        {hasMethods ? (
          <Block title="Methods the notice names">
            <div className="flex flex-col gap-1 text-dense text-ink-body">
              {d.methods.met.length ? (
                <p className="m-0">
                  <span className="text-ink-muted">Met · </span>
                  {d.methods.met.join(", ")}
                </p>
              ) : null}
              {d.methods.missing.length ? (
                <p className="m-0">
                  <span className="text-ink-muted">Missing · </span>
                  {d.methods.missing.join(", ")}
                </p>
              ) : null}
            </div>
          </Block>
        ) : null}

        {hasTrack ? (
          <Block title="Track record">
            <p className="m-0 text-dense leading-normal text-ink-body">
              {d.track.held.length ? `Has held ${d.track.held.join(", ")} as PI` : "No NIH mechanism held as PI"}
              {d.track.activityCode ? `; this notice is ${/^[AEFHILMNORSX]/i.test(d.track.activityCode) ? "an" : "a"} ${d.track.activityCode}.` : "; the notice names no activity code."}
            </p>
          </Block>
        ) : null}

        {d.eligibility.length ? (
          <Block title="Eligibility">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {d.eligibility.map((e, i) => (
                <li key={i} className="text-dense leading-normal">
                  <span className={cn("mr-1.5 inline-flex h-[18px] items-center rounded-[4px] px-1.5 align-middle text-micro font-medium", e.kind === "failed" ? "bg-danger-tint text-danger-dark" : "bg-line-row text-ink-body")}>
                    {e.kind === "failed" ? "Fails" : "Not checked"}
                  </span>
                  <span className="text-ink-body">{e.text}</span>
                </li>
              ))}
            </ul>
            <p className="mb-0 mt-1 text-meta leading-normal text-ink-muted">A rule Prospera cannot evaluate never fails a pair; it holds the tier down and is quoted here in the notice&apos;s words so a person can settle it.</p>
          </Block>
        ) : null}

        {d.collaborators.length ? (
          <Block title="Who could carry the gap">
            {collaboratorNames?.size ? (
              <p className="m-0 flex flex-wrap gap-x-2 gap-y-1 text-dense">
                {d.collaborators.map((id) => (
                  <Link key={id} href={`/investigators/${id}`} className="font-medium text-ink hover:text-teal">
                    {collaboratorNames.get(id) ?? "A collaborator in the directory"}
                  </Link>
                ))}
              </p>
            ) : (
              <p className="m-0 text-dense text-ink-body">
                {d.collaborators.length} {d.collaborators.length === 1 ? "collaborator" : "collaborators"} in the directory work in the field the notice requires.
              </p>
            )}
          </Block>
        ) : null}

        {evidence?.length ? (
          <Block title="Evidence behind the match">
            <EvidenceChips items={evidence} prefix={null} className="mt-0" />
          </Block>
        ) : null}
      </div>
    </details>
  );
}
