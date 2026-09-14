/**
 * @vitest-environment jsdom
 *
 * The phone tab bar as the server renders it (decision N2): four tabs and
 * More, no Home.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";

vi.mock("next/navigation", () => ({ usePathname: () => "/review" }));

describe("the tab bar (N2)", () => {
  const html = renderToString(<MobileTabBar badges={{ review: 35, outreach: 0 }} />);

  it("is Discover · Outreach · Funding Notices · More, on four columns", () => {
    for (const label of ["Discover", "Outreach", "Funding Notices", "More"]) expect(html).toContain(label);
    expect(html).toContain("grid-cols-4");
    expect(html).not.toContain("grid-cols-5");
    expect(html).not.toContain('href="/home"');
    expect(html).not.toContain(">Home<");
  });

  it("shows the undecided count on Discover and marks it current", () => {
    expect(html).toContain('aria-label="35 undecided"');
    expect(html).toContain('aria-current="page" href="/review"');
  });
});
