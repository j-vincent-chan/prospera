"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

/** Every destructive or bulk action raises one of these, with an Undo. */
export type ToastSpec = {
  message: ReactNode;
  tone?: "default" | "error";
  /** The recovery affordance. Destructive actions must supply `label: "Undo"`. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds on screen. Defaults to 6s, the system dwell time. */
  duration?: number;
};

type ActiveToast = ToastSpec & { id: number };

const ToastContext = createContext<((toast: ToastSpec) => void) | null>(null);

/** Raise a toast. Throws outside <ToastProvider>, which the app shell mounts. */
export function useToast() {
  const showToast = useContext(ToastContext);
  if (!showToast) throw new Error("useToast must be used inside <ToastProvider>");
  return showToast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (spec: ToastSpec) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...spec, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), spec.duration ?? 6000),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => showToast, [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ActiveToast[];
  onDismiss: (id: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          className={cn(
            "pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-tile py-2.5 pl-4 pr-3 text-dense text-white shadow-toast",
            toast.tone === "error" ? "bg-danger" : "bg-navy",
          )}
        >
          <span className="min-w-0">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
              className={cn(
                "inline-flex h-7 shrink-0 items-center rounded-control bg-white px-2.5 text-dense font-medium",
                toast.tone === "error" ? "text-danger" : "text-navy",
              )}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Close"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-white/70 hover:text-white"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
