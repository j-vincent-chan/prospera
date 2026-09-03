import { redirect } from "next/navigation";
import { SetPasswordClient } from "@/components/onboarding/set-password-client";
import { createClient } from "@/lib/supabase/server";

/** First stop for accounts created from an invitation: choose a password, then continue. */
export default async function SetPasswordPage({ searchParams }: { searchParams: { next?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const next = searchParams.next && searchParams.next.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : "/home";
  if (!user.user_metadata?.password_pending) redirect(next);

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-5">
      <div>
        <p className="mb-1.5 mt-0 text-label font-semibold uppercase text-ink-muted">Almost there</p>
        <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">Set a password for {user.email}</h1>
        <p className="mb-0 mt-2 text-body leading-relaxed text-ink-body">
          Your account was just created from the invitation. Choose a password so you can sign in next time; you can change it later in Settings.
        </p>
      </div>
      <section className="rounded-card border border-line bg-card p-5">
        <SetPasswordClient next={next} />
      </section>
    </div>
  );
}
