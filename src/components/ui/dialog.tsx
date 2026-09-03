"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";
import { useModal } from "@/components/ui/use-modal";

/**
 * Centred modal dialog. Esc closes, scrim click closes, focus is trapped and
 * returned to the trigger. Footer actions are right-aligned, primary last.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModal(panelRef, open, onClose);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[55] bg-scrim"
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width }}
        className={cn(
          "fixed left-1/2 top-1/2 z-[56] max-h-[calc(100vh-64px)] max-w-[calc(100vw-32px)]",
          "-translate-x-1/2 -translate-y-1/2 flex flex-col",
          "rounded-card border border-line bg-card shadow-dialog outline-none",
        )}
      >
        <div className="px-5 pb-2 pt-5">
          <h2 className="m-0 text-[16px] font-semibold leading-tight text-ink">{title}</h2>
          {description ? (
            <div className="mt-2 text-dense text-ink-body">{description}</div>
          ) : null}
        </div>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div> : null}
        {footer ? (
          <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-4">{footer}</div>
        ) : null}
      </div>
    </>,
    document.body,
  );
}
