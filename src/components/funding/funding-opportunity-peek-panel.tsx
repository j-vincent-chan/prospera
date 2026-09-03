"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { loadFundingOpportunityPeekAction } from "@/app/actions/funding-search-saves";
import { FundingOpportunityDetailView } from "@/components/funding/funding-opportunity-detail-view";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import type { FundingOpportunityPeekData } from "@/lib/funding-opportunities/funding-opportunity-peek";
import { FUNDING_PEEK_PARAM } from "@/lib/funding-opportunities/funding-list-url";

type PeekContextValue = {
  peekId: string | null;
  openPeek: (id: string) => void;
  closePeek: () => void;
};

const PeekContext = createContext<PeekContextValue | null>(null);

function readPeekFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(FUNDING_PEEK_PARAM);
}

function writePeekToUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(FUNDING_PEEK_PARAM, id);
  else url.searchParams.delete(FUNDING_PEEK_PARAM);
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, "", next);
}

export function useFundingPeekNavigation(): PeekContextValue {
  const ctx = useContext(PeekContext);
  if (!ctx) {
    throw new Error("FundingOpportunityPeekProvider is required.");
  }
  return ctx;
}

export function FundingOpportunityPeekProvider({ children }: { children: ReactNode }) {
  const [peekId, setPeekId] = useState<string | null>(null);

  useEffect(() => {
    setPeekId(readPeekFromUrl());
    const onPopState = () => setPeekId(readPeekFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openPeek = useCallback((id: string) => {
    setPeekId(id);
    writePeekToUrl(id);
  }, []);

  const closePeek = useCallback(() => {
    setPeekId(null);
    writePeekToUrl(null);
  }, []);

  return <PeekContext.Provider value={{ peekId, openPeek, closePeek }}>{children}</PeekContext.Provider>;
}

export function FundingOpportunityPeekLink({
  opportunityId,
  children,
  className,
  title,
}: {
  opportunityId: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const { openPeek } = useFundingPeekNavigation();

  return (
    <a
      href={`/funding-opportunities/${opportunityId}`}
      title={title}
      className={className}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        openPeek(opportunityId);
      }}
    >
      {children}
    </a>
  );
}

export function FundingOpportunityPeekPanel({ loggedIn }: { loggedIn: boolean }) {
  const { peekId, closePeek } = useFundingPeekNavigation();
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<FundingOpportunityPeekData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, FundingOpportunityPeekData>>(new Map());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!peekId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cached = cacheRef.current.get(peekId);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    loadFundingOpportunityPeekAction(peekId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          setData(null);
          return;
        }
        cacheRef.current.set(peekId, result.data);
        setData(result.data);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load this grant.");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [peekId]);

  useEffect(() => {
    if (!peekId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePeek();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePeek, peekId]);

  useEffect(() => {
    if (!peekId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [peekId]);

  if (!mounted || !peekId) return null;

  return createPortal(
    <div>
      <button
        type="button"
        aria-label="Close grant details"
        className="fixed inset-0 z-[55] bg-[rgba(11,29,58,0.32)]"
        onClick={closePeek}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Grant details"
        className="fo-peek-panel fixed right-0 top-0 z-[60] flex h-[100dvh] w-[min(100vw,32rem)] max-w-full flex-col border-l border-[#c5d2de] bg-white shadow-[-16px_0_48px_rgba(11,29,58,0.18)]"
      >
        {loading ? (
          <PageLoadingState
            message="Loading grant details…"
            fill
            className="bg-white px-6"
          />
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-white px-6 text-center">
            <p className="text-sm font-medium text-red-700/90">{error}</p>
            <button
              type="button"
              onClick={closePeek}
              className="rounded-lg border border-[var(--fo-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--fo-ink-body)] hover:bg-[var(--fo-row-hover)]"
            >
              Close
            </button>
          </div>
        ) : data ? (
          <FundingOpportunityDetailView
            data={data}
            loggedIn={loggedIn}
            variant="peek"
            onClose={closePeek}
            onDismissed={closePeek}
          />
        ) : null}
      </aside>
    </div>,
    document.body
  );
}
