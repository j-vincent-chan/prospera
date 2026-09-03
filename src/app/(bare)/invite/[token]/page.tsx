import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutTo } from "@/app/actions/auth";
import { acceptInvitationAction } from "@/app/actions/team-actions";
import { InviteSignInClient } from "@/components/onboarding/invite-sign-in-client";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";
import { createClient } from "@/lib/supabase/server";
import { fmtShort } from "@/lib/team/format";
import { ROLE_LABEL, teamInitials, type InviteRole } from "@/lib/team/types";

type InvitationLanding = {
  email: string;
  role: InviteRole;
  expiresAt: string;
  createdAt: string;
  accepted: boolean;
  closed: boolean;
  teamName: string;
  teamDescription: string | null;
  inviterName: string | null;
};

async function loadInvitation(token: string): Promise<InvitationLanding | null> {
  const admin = createServiceRoleClient();
  if (!admin) return null;
  const { data } = await admin
    .from("team_invitations")
    .select("email, role, expires_at, created_at, accepted_at, revoked_at, declined_at, teams:team_id (name, description, archived_at), inviter:invited_by (full_name)")
    .eq("token", token)
    .maybeSingle();
  const r = data as
    | {
        email: string;
        role: InviteRole;
        expires_at: string;
        created_at: string;
        accepted_at: string | null;
        revoked_at: string | null;
        declined_at: string | null;
        teams: { name: string; description: string | null; archived_at: string | null } | null;
        inviter: { full_name: string | null } | null;
      }
    | null;
  if (!r) return null;
  return {
    email: r.email,
    role: r.role,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    accepted: Boolean(r.accepted_at),
    closed: Boolean(r.revoked_at || r.declined_at || r.teams?.archived_at),
    teamName: r.teams?.name ?? "the team",
    teamDescription: r.teams?.description ?? null,
    inviterName: r.inviter?.full_name?.trim() || null,
  };
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-[640px] flex-col gap-5">
      <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">{title}</h1>
      <section className="rounded-card border border-line bg-card p-5">{children}</section>
    </div>
  );
}

export default async function InvitePage({ params }: { params: { token: string } }) {
  const invitation = await loadInvitation(params.token);
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const here = `/invite/${params.token}`;

  if (!invitation || invitation.closed) {
    return (
      <Card title="This invitation can&apos;t be used">
        <p className="m-0 text-body leading-relaxed text-ink-body">This invitation is no longer valid. Ask the team to send a new one.</p>
        <div className="mt-4">
          <Link href={user ? "/onboarding" : "/login"}>
            <Button variant="primary">{user ? "Find or create a team" : "Sign in"}</Button>
          </Link>
        </div>
      </Card>
    );
  }

  if (invitation.accepted) {
    return (
      <Card title="This invitation was already used">
        <p className="m-0 text-body leading-relaxed text-ink-body">
          {invitation.email} already joined {invitation.teamName}. {user ? "" : "Sign in to open the workspace."}
        </p>
        <div className="mt-4">
          <Link href={user ? "/home" : `/login?next=${encodeURIComponent("/home")}`}>
            <Button variant="primary">{user ? "Go to Home" : "Sign in"}</Button>
          </Link>
        </div>
      </Card>
    );
  }

  const expired = new Date(invitation.expiresAt).getTime() < Date.now();
  if (expired) {
    return (
      <Card title="This invitation has expired">
        <p className="m-0 text-body leading-relaxed text-ink-body">
          The invitation to {invitation.teamName} for {invitation.email} expired on {fmtShort(invitation.expiresAt)}. Ask a team owner to resend it.
        </p>
      </Card>
    );
  }

  const userEmail = user?.email?.toLowerCase() ?? null;

  // Signed in with the invited address: join straight away.
  if (user && userEmail === invitation.email) {
    const result = await acceptInvitationAction({ token: params.token });
    if (result.ok) redirect(`/onboarding?step=invited&team=${result.teamId}`);
    return (
      <Card title="This invitation can&apos;t be used">
        <p className="m-0 text-body leading-relaxed text-ink-body">{result.error}</p>
        <div className="mt-4">
          <Link href="/onboarding">
            <Button variant="primary">Find or create a team</Button>
          </Link>
        </div>
      </Card>
    );
  }

  // Signed in as someone else.
  if (user) {
    return (
      <Card title="This invitation is for a different account">
        <p className="m-0 text-body leading-relaxed text-ink-body">
          It was sent to <span className="font-medium text-ink">{invitation.email}</span>, but you&apos;re signed in as{" "}
          <span className="font-medium text-ink">{userEmail}</span>. Sign out and open the link again to accept it as {invitation.email}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={signOutTo}>
            <input type="hidden" name="next" value={here} />
            <Button type="submit" variant="primary">Sign out and use this link</Button>
          </form>
          <Link href="/home">
            <Button variant="secondary">Stay signed in as {userEmail}</Button>
          </Link>
        </div>
      </Card>
    );
  }

  // Signed out: offer a one-time sign-in link (creates the account for new people).
  return (
    <div className="flex w-full max-w-[640px] flex-col gap-5">
      <div>
        <p className="mb-1.5 mt-0 text-label font-semibold uppercase text-ink-muted">Team invitation</p>
        <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">You&apos;re invited to {invitation.teamName}</h1>
        <p className="mb-0 mt-2 text-body leading-relaxed text-ink-body">
          {invitation.inviterName ?? "A team owner"} invited <span className="font-medium text-ink">{invitation.email}</span> to join as{" "}
          {ROLE_LABEL[invitation.role] === "Admin" ? "an Admin" : "a Member"}. Prospera is where the team scans funding notices, matches investigators and runs outreach.
        </p>
      </div>
      <section className="rounded-card border border-line bg-card">
        <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3.5 px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-tile bg-navy text-micro font-semibold text-white">{teamInitials(invitation.teamName)}</span>
          <div className="min-w-0">
            <p className="m-0 text-body font-medium text-ink">{invitation.teamName}</p>
            <p className="mb-0 mt-0.5 text-meta text-ink-muted">
              {invitation.teamDescription ? `${invitation.teamDescription} · ` : ""}Invited {fmtShort(invitation.createdAt)} · expires {fmtShort(invitation.expiresAt)}
            </p>
          </div>
          <Pill variant="tag-selected">{ROLE_LABEL[invitation.role]}</Pill>
        </div>
        <div className="border-t border-line-row px-5 py-4">
          <InviteSignInClient token={params.token} email={invitation.email} teamName={invitation.teamName} />
        </div>
        <div className="border-t border-line-row px-5 py-3 text-meta leading-normal text-ink-muted">
          Already have a password?{" "}
          <Link href={`/login?next=${encodeURIComponent(here)}`} className="font-medium text-teal hover:text-navy">
            Sign in with it
          </Link>{" "}
          and you&apos;ll come straight back here. UCSF MyAccess sign-in arrives when single sign-on is connected.
        </div>
      </section>
    </div>
  );
}
