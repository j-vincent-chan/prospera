import type { Metadata } from "next";
import { ResponseForm } from "@/components/outreach/response-form";
import { loadResponseContext } from "@/lib/outreach/response";
import { isOutreachResponse } from "@/lib/outreach/response-types";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your reply · Prospera", robots: { index: false, follow: false } };

/**
 * /r/<token>?a=interested|pass — where the outreach email's two buttons land.
 * Public (no account), in the (public) chrome the biosketch page uses. The
 * button pre-selects the answer; nothing is recorded until the person presses
 * Send, because mail clients and link scanners open URLs on their own.
 */
export default async function OutreachResponsePage({ params, searchParams }: { params: { token: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const admin = createServiceRoleClient();
  const ctx = admin ? await loadResponseContext(admin, params.token) : null;

  if (!ctx) {
    return (
      <section className="w-full max-w-[560px] rounded-card border border-line bg-card px-6 py-8 text-center sm:px-8">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-ink">This link is no longer valid</h1>
        <p className="mx-auto mb-0 mt-2 max-w-[420px] text-body leading-normal text-ink-muted">
          It may belong to a message that was withdrawn. If you meant to answer, reply to the email you received — that reaches the same person.
        </p>
      </section>
    );
  }

  const a = typeof searchParams.a === "string" ? searchParams.a : null;
  return <ResponseForm token={params.token} ctx={ctx} initial={isOutreachResponse(a) ? a : null} />;
}
