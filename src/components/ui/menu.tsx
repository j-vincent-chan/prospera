"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";

type Align = "start" | "end";

/**
 * Anchored overlay used for both menus and popovers.
 *
 * `Menu` gives the roving-focus keyboard contract (Up/Down/Home/End, Esc, type
 * nothing else) over `MenuItem` children. `Popover` is the same anchoring and
 * dismissal without the item semantics, for the filter and options panels.
 */
export function Menu({
  trigger,
  children,
  label,
  align = "start",
  width,
  className,
}: {
  /** Rendered as the anchor. Receives open state so it can style itself. */
  trigger: (props: {
    open: boolean;
    toggle: () => void;
    triggerProps: {
      "aria-haspopup": "menu";
      "aria-expanded": boolean;
      "aria-controls": string;
      onKeyDown: (event: React.KeyboardEvent) => void;
    };
  }) => ReactNode;
  children: ReactNode;
  label: string;
  align?: Align;
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useOutsideDismiss(rootRef, open, () => setOpen(false));

  // Focus the first item on open so Up/Down works immediately.
  useEffect(() => {
    if (!open) return;
    const items = menuItems(listRef.current);
    items[0]?.focus({ preventScroll: true });
  }, [open]);

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const items = menuItems(listRef.current);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        items[(index + 1) % items.length].focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
        break;
      case "Home":
        event.preventDefault();
        items[0].focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1].focus();
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onFocusCapture={(event) => {
        // Remember the anchor so Esc can hand focus back to it.
        const target = event.target as HTMLElement;
        if (!listRef.current?.contains(target)) triggerRef.current = target;
      }}
    >
      {trigger({
        open,
        toggle: () => setOpen((value) => !value),
        triggerProps: {
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-controls": menuId,
          onKeyDown: onTriggerKeyDown,
        },
      })}
      {open ? (
        <div
          id={menuId}
          ref={listRef}
          role="menu"
          aria-label={label}
          onKeyDown={onListKeyDown}
          style={width ? { width } : undefined}
          className={cn(
            "absolute top-[calc(100%+6px)] z-30 flex flex-col gap-0.5 rounded-card border border-line bg-card p-1.5 shadow-menu",
            align === "end" ? "right-0" : "left-0",
            !width && "min-w-[200px]",
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  href,
  checked,
  tone = "default",
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  href?: string;
  /** Renders the teal check used by the workspace switcher. */
  checked?: boolean;
  tone?: "default" | "destructive";
  disabled?: boolean;
}) {
  const className = cn(
    "flex h-[34px] items-center gap-2.5 rounded-control px-2.5 text-dense font-medium",
    tone === "destructive" ? "text-danger" : "text-ink",
    disabled ? "cursor-not-allowed opacity-50" : "hover:bg-line-row",
  );

  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {checked ? <CheckIcon /> : null}
    </>
  );

  if (href && !disabled) {
    return (
      <Link role="menuitem" href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(className, "w-full")}
    >
      {content}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 px-2.5 pb-1 pt-1.5 text-label font-semibold uppercase text-ink-muted">
      {children}
    </p>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line-row" role="separator" />;
}

/** Anchored panel without menu-item semantics (filters, options, evidence). */
export function Popover({
  open,
  onClose,
  label,
  children,
  align = "start",
  width = 340,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  align?: Align;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideDismiss(ref, open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={{ width }}
      className={cn(
        "absolute top-[calc(100%+6px)] z-30 rounded-card border border-line bg-card p-3.5 text-left shadow-dialog",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function useOutsideDismiss(
  ref: React.RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onCloseRef.current();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, ref]);
}

function menuItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0e6b78"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
