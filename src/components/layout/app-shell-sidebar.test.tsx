/**
 * @vitest-environment jsdom
 *
 * The sidebar as the server renders it (decision N2): the names, their order,
 * no Home, and the wordmark opening Discover.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShellSidebar } from "@/components/layout/app-shell-sidebar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/review" }));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { priority, alt, ...rest } = props as { priority?: boolean; alt?: string };
    void priority;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt ?? ""} {...(rest as Record<string, string>)} />;
  },
}));

const NAMES = ["Discover", "Outreach", "Calendar", "Funding Notices", "Investigators", "Communities", "Reports", "Proposal Library"];

describe("the sidebar (N2)", () => {
  const html = renderToString(<AppShellSidebar user={{ name: "Vincent Chan", email: "v@ucsf.edu" }} workspace={null} pendingCount={0} badges={{ review: 35, outreach: 10 }} />);

  it("reads Discover · Outreach · Calendar · Funding Notices, then Investigators · Communities · Reports · Proposal Library", () => {
    const at = NAMES.map((n) => html.indexOf(`>${n}<`));
    for (const [i, n] of NAMES.entries()) expect(at[i], n).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const old of [">Home<", ">PI Match<", ">PI Outreach<", ">Notice Board<", ">Library<"]) expect(html).not.toContain(old);
  });

  it("has no Home: the wordmark and every link go to Discover or a named screen", () => {
    expect(html).not.toContain('href="/home"');
    expect(html).toContain('href="/review"');
    expect(html).toContain('title="Prospera — Discover"');
  });

  it("carries the two counts: undecided on Discover, waiting on Outreach", () => {
    expect(html).toContain('aria-label="35 undecided"');
    expect(html).toContain('aria-label="10 waiting"');
  });
});
