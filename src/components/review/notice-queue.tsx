"use client";

import type { ReviewFilter } from "@/lib/review/calls";
import Link from "next/link";
import type { NoticeCounts, QueueNotice } from "@/lib/review/queue";
import { dueUrgent, dueWords, matchLine, progressPercent } from "@/lib/review/queue";
import { ASIDE, ASIDE_LABEL, QUEUE_BAR, QUEUE_BAR_FILL, QUEUE_DUE, QUEUE_DUE_TONE, QUEUE_ITEM, QUEUE_ITEM_IDLE, QUEUE_ITEM_SELECTED, QUEUE_LINE, QUEUE_NUMBER, QUEUE_TITLE } from "@/components/review/review-view";
import { cn } from "@/lib/utils/cn";

/**
 * "Notices in this queue" (README §2 "Notice queue item"): number and due on
 * line one, the title, "4 suggested · 1 decided", and a 3px bar. The selected
 * notice carries the teal left rail. Each item is a link to `?notice=<id>`,
 * so the queue is the URL and a decision that moves to the next notice is an
 * ordinary navigation.
 *
 * `counts` overrides the selected notice's numbers with what the page has
 * decided since the server rendered them, so the bar moves under the cursor.
 */
export function NoticeQueue({ notices, selectedId, counts, filter = "all" }: { notices: readonly QueueNotice[]; selectedId: string | null; counts?: NoticeCounts | null; /** R35: kept in every item's link. */ filter?: ReviewFilter }) {
  return (
    <aside className={ASIDE} aria-label="Notices in this queue">
      <p className={ASIDE_LABEL}>Notices in this queue</p>
      {notices.map((n) => {
        const selected = n.id === selectedId;
        const c = selected && counts ? counts : n.counts;
        const pct = progressPercent(c);
        return (
          <Link key={n.id} href={`/review?notice=${n.id}${filter !== "all" ? `&filter=${filter}` : ""}`} aria-current={selected ? "true" : undefined} className={cn(QUEUE_ITEM, selected ? QUEUE_ITEM_SELECTED : QUEUE_ITEM_IDLE)}>
            <span className="flex items-baseline justify-between gap-2">
              <span className={QUEUE_NUMBER}>{n.number ?? "—"}</span>
              <span className={cn(QUEUE_DUE, dueUrgent(n.dueDays) ? QUEUE_DUE_TONE.urgent : QUEUE_DUE_TONE.normal)}>{dueWords(n.dueDays)}</span>
            </span>
            <span className={QUEUE_TITLE}>{n.title}</span>
            <span className={QUEUE_LINE}>{matchLine(c)}</span>
            <span className={QUEUE_BAR} aria-hidden>
              <span className={pct >= 100 ? QUEUE_BAR_FILL.done : QUEUE_BAR_FILL.partial} style={{ width: `${pct}%` }} />
            </span>
          </Link>
        );
      })}
    </aside>
  );
}
