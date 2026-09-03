import { BiosketchAuthorizeForm } from "@/components/investigators/biosketch-authorize-form";
import { loadBiosketchRequest } from "@/lib/investigators/biosketch-request";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const dynamic = "force-dynamic";

export default async function BiosketchPage({ params }: { params: { token: string } }) {
  const admin = createServiceRoleClient();
  const request = admin ? await loadBiosketchRequest(admin, params.token) : null;

  if (!request) {
    return (
      <section className="w-full max-w-[560px] rounded-card border border-line bg-card px-6 py-8 text-center sm:px-8">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-ink">This link is no longer valid</h1>
        <p className="mx-auto mb-0 mt-2 max-w-[420px] text-body leading-normal text-ink-muted">
          It may have been used already, or the request was withdrawn. If you meant to share a biosketch, reply to the email you received and the team will send a fresh link.
        </p>
      </section>
    );
  }

  return <BiosketchAuthorizeForm token={params.token} request={request} />;
}
