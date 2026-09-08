/**
 * @vitest-environment jsdom
 *
 * **A panel that is open on the first render has to survive hydration.**
 *
 * `SlideOver` renders a `createPortal`, and a portal cannot exist in server
 * HTML. That is invisible for a panel opened by a click — there is no server
 * render to disagree with — but `outreach/page.tsx` reads `?item=` from
 * `searchParams` and server-renders the workspace *already open*, so a direct
 * load of `/outreach?item=<id>` used to hydrate a portal the server never
 * emitted:
 *
 *     Warning: Expected server HTML to contain a matching <div> in <div>
 *     Error: Hydration failed because the initial UI does not match…
 *     Error: There was an error while hydrating this Suspense boundary.
 *
 * — on every bookmarked or shared `?item=` link. So this file does the real
 * thing rather than grepping the source: it server-renders an open panel with
 * `renderToString`, hydrates that exact markup with `hydrateRoot`, and asserts
 * React reported no recoverable error. `onRecoverableError` is the hook React
 * calls for precisely this class of failure, so the assertion is the bug.
 *
 * Checked against the unfixed component: three of these five fail. They fail
 * with a *different message* than the browser gives, and it is worth knowing
 * why — under jsdom `document` exists during `renderToString`, so the old
 * `typeof document === "undefined"` guard does not fire and the server render
 * throws "Portals are not currently supported by the server renderer" instead
 * of quietly emitting nothing. Same cause, caught one step earlier.
 *
 * What this cannot cover: Next's streaming SSR and the App Router's Suspense
 * boundaries. The third console error above comes from that boundary, not from
 * `SlideOver`, and it goes away only because its cause does. That end of it was
 * checked by loading the page.
 */
import { act, useState, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlideOver } from "@/components/ui/slide-over";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const fn of teardown.splice(0)) fn();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

/** Server-render `ui`, hydrate that markup, and report what React said about it. */
async function hydrate(ui: ReactNode) {
  const html = renderToString(ui);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  const recoverable: Error[] = [];
  await act(async () => {
    const root = hydrateRoot(container, ui, {
      onRecoverableError: (error) => recoverable.push(error as Error),
    });
    teardown.push(() => act(() => root.unmount()));
  });
  return { html, container, recoverable };
}

const panel = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Workspace"]');

describe("SlideOver hydrates a panel that is already open", () => {
  it("server-renders nothing and hydrates it without a mismatch", async () => {
    const { html, recoverable } = await hydrate(
      <SlideOver open onClose={() => {}} label="Workspace">
        <p>Body</p>
      </SlideOver>,
    );

    // A portal has no server markup to hydrate against. The fix is that the
    // *client's* first render agrees — it also renders nothing — rather than
    // the client rendering a portal into HTML that never had one.
    expect(html).toBe("");
    expect(recoverable.map((e) => e.message)).toEqual([]);
  });

  it("moves the panel into the portal in the commit after hydration", async () => {
    await hydrate(
      <SlideOver open onClose={() => {}} label="Workspace">
        <p>Body</p>
      </SlideOver>,
    );

    // Agreeing with the server would be worthless if the panel then never
    // appeared: it has to be in `document.body`, not in the hydrated container.
    const el = panel();
    expect(el).not.toBeNull();
    expect(el?.parentElement).toBe(document.body);
    expect(el?.textContent).toContain("Body");
  });

  it("keeps the modal contract on a panel that opened by hydration", async () => {
    const onClose = vi.fn();
    await hydrate(
      <SlideOver open onClose={onClose} label="Workspace">
        <p>Body</p>
      </SlideOver>,
    );

    // `useModal` keys off the same gate as the render. Were it still keyed off
    // `open`, its effect would run one commit early, find `panelRef.current`
    // null, and never move focus in — the trap would be installed around
    // nothing.
    const el = panel();
    expect(el?.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.querySelector<HTMLElement>(".bg-scrim")?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing at all while closed, so no page flashes a panel", async () => {
    const { html, recoverable } = await hydrate(
      <SlideOver open={false} onClose={() => {}} label="Workspace">
        <p>Body</p>
      </SlideOver>,
    );

    expect(html).toBe("");
    expect(recoverable).toEqual([]);
    expect(panel()).toBeNull();
    // The scroll lock belongs to an open panel only.
    expect(document.body.style.overflow).toBe("");
  });

  it("opens on a later click without waiting for anything", async () => {
    // The click-opened callers — investigator form, opportunity peek, library —
    // are the reason the gate is `useSyncExternalStore` and not a mounted flag:
    // React takes the server snapshot only while hydrating, so an instance that
    // is closed through hydration and opened afterwards portals immediately.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open workspace
          </button>
          <SlideOver open={open} onClose={() => setOpen(false)} label="Workspace">
            <p>Body</p>
          </SlideOver>
        </>
      );
    }

    const { container, recoverable } = await hydrate(<Harness />);
    expect(recoverable).toEqual([]);
    expect(panel()).toBeNull();

    const opener = container.querySelector<HTMLElement>("button");
    opener?.focus();
    await act(async () => {
      opener?.click();
    });
    expect(panel()).not.toBeNull();

    // Focus returns to the opener on close.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
