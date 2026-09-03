import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { ToastProvider } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/team/queries";

/**
 * Chrome for onboarding and invitation landings: brand bar with the signed-in
 * identity, no sidebar (Onboarding v2). Auth required; team membership not.
 */
export default async function BareLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const profile = await getProfile(supabase, user.id);

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-canvas">
        <header className="flex items-center justify-between border-b border-line bg-card px-8 py-5">
          <Link href="/home" className="flex items-center gap-2.5" title="Prospera">
            <Image src="/brand/prospera-app-icon.png" alt="" width={180} height={198} priority className="h-[30px] w-auto" />
            <Image src="/brand/prospera-wordmark.png" alt="Prospera" width={555} height={115} priority className="h-[18px] w-auto" />
          </Link>
          <div className="flex items-center gap-3.5 text-dense text-ink-muted">
            <span>
              Signed in as <span className="font-medium text-ink">{profile?.fullName ?? profile?.email ?? user.email}</span>
              {profile?.fullName && (profile.email ?? user.email) ? ` · ${profile.email ?? user.email}` : ""}
            </span>
            <form action={signOut}>
              <button type="submit" className="text-dense font-medium text-teal hover:text-navy">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex flex-1 flex-col items-center px-6 pb-16 pt-12">{children}</main>
      </div>
    </ToastProvider>
  );
}
