import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInvitationAction } from "@/app/actions/team-actions";
import { Button } from "@/components/ui/button";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const result = await acceptInvitationAction({ token: params.token });
  if (result.ok) redirect(`/onboarding?step=invited&team=${result.teamId}`);

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-5">
      <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">This invitation can&apos;t be used</h1>
      <section className="rounded-card border border-line bg-card p-5">
        <p className="m-0 text-body leading-relaxed text-ink-body">{result.error}</p>
        <div className="mt-4 flex gap-2">
          <Link href="/onboarding">
            <Button variant="primary">Find or create a team</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
