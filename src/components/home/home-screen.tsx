"use client";

import Link from "next/link";
import { useEffect } from "react";
import { markHomeVisitAction } from "@/app/actions/data-source-actions";
import { Pill, type PillVariant } from "@/components/ui/pill";
import type { TodayData } from "@/lib/home/today";
import * as v from "@/lib/home/today-view";
import { cn } from "@/lib/utils/cn";

/**
 * Today (design_handoff_prospera_review_outreach README §1), at `/home` — the
 * nav label stays "Home" (R9). The date, what arrived and what it produced,
 * then three queues each with the one button that starts it, and an aside of
 * what was filed without a match. Nothing here acts: every row is a link to
 * the surface that does.
 */

const PILL: Record<v.TodayPillTone, PillVariant> = { danger: "status-overdue", good: "status-good", warn: "status-forecasted", plain: "status-plain" };

export function HomeScreen({ data }: { data: TodayData }) {
  useEffect(() => {
    // Stamp the visit after the page has rendered so "since your last visit" counts this view next time.
    const t = setTimeout(() => { void markHomeVisitAction(); }, 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={v.PAGE}>
      <h1 className={v.H1}>{data.dateLine}</h1>
      <p className={v.SUB}>{data.overnight}</p>

      {data.feedStale ? (
        <div role="status" className={v.STALE}>
          <span><span className="font-semibold">Funding feed is {data.feedStale.hours} hours old.</span> New notices and deadline changes since {data.feedStale.since} may be missing.</span>
          <Link href="/team/data-sources" className={v.STALE_LINK}>Data sources →</Link>
        </div>
      ) : null}

      <div className={v.LAYOUT}>
        <div className={v.MAIN}>
          {data.cards.map((card) => (
            <section key={card.key} className={v.CARD} aria-labelledby={`today-${card.key}`}>
              <div className={v.CARD_HEAD}>
                <h2 id={`today-${card.key}`} className={v.CARD_TITLE}>
                  {card.title} <span className={v.CARD_SUB}>{card.sub}</span>
                </h2>
                <Link href={card.cta.href} className={v.CTA[card.cta.kind]}>{card.cta.label}</Link>
              </div>
              {card.items.length ? (
                card.items.map((it) => (
                  <div key={it.key} className={v.ROW}>
                    <div className={v.ROW_BODY}>
                      <Link href={it.href} className={v.ROW_TITLE}>{it.title}</Link>
                      <p className={v.ROW_META}>{it.meta}</p>
                    </div>
                    {it.pill ? <Pill variant={PILL[it.pill.tone]}>{it.pill.text}</Pill> : <span />}
                  </div>
                ))
              ) : (
                <p className={v.EMPTY}>{card.empty}</p>
              )}
            </section>
          ))}
        </div>

        <aside className={v.ASIDE}>
          <section className={v.ASIDE_CARD} aria-labelledby="today-filed">
            <h2 id="today-filed" className={v.EYEBROW}>Filed without a match</h2>
            <p className={v.ASIDE_LINE}>{data.filed.line}</p>
            {data.filed.items.length ? (
              <div className={v.FILED_LIST}>
                {data.filed.items.map((n) => (
                  <div key={n.id} className={v.FILED_ITEM}>
                    <Link href={n.href} className={v.FILED_TITLE}>{n.title}</Link>
                    <p className={v.FILED_REASON_LINE}>{n.reason}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {data.filed.count > 0 ? <Link href={data.filed.href} className={v.SEE_ALL}>{v.seeAllLabel(data.filed.count)}</Link> : null}
          </section>

          {data.also.length ? (
            <section className={v.ASIDE_CARD} aria-labelledby="today-also">
              <h2 id="today-also" className={v.EYEBROW}>Also waiting</h2>
              <div className={v.FILED_LIST}>
                {data.also.map((a) => (
                  <div key={a.key} className={v.ALSO_ITEM}>
                    <div className={v.ROW_BODY}>
                      <Link href={a.href} className={v.ALSO_TITLE}>{a.title}</Link>
                      <p className={v.ALSO_META}>{a.meta}</p>
                    </div>
                    <span className={cn(v.ALSO_WHEN, v.ALSO_WHEN_TONE[a.whenTone])}>{a.when}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
