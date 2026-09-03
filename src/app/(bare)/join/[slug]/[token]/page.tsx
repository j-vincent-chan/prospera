import Link from "next/link";
import { redirect } from "next/navigation";
import { joinViaLinkAction } from "@/app/actions/team-actions";
import { Button } from "@/components/ui/button";

export default async function JoinPage({ params }: { params: { slug: string; token: string } }) {
  const result = await joinViaLinkAction({ slug: params.slug, token: params.token });
  if (result.ok) redirect(result.alreadyMember ? "/home" : "/onboarding?step=waiting");

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-5">
      <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">This invite link can&apos;t be used</h1>
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
