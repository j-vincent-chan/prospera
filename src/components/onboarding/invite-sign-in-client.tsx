"use client";

import { useState, useTransition } from "react";
import { requestInvitationSignInLinkAction } from "@/app/actions/team-actions";
import { Button } from "@/components/ui/button";

/**
 * Signed-out invitation landing: one button that emails a one-time sign-in
 * link. Supabase creates the account for new people on the way in.
 */
export function InviteSignInClient({ token, email, teamName }: { token: string; email: string; teamName: string }) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = () =>
    startTransition(async () => {
      setError(null);
      const result = await requestInvitationSignInLinkAction({ token });
      if (!result.ok) return setError(result.error);
      setSent(true);
    });

  if (sent) {
    return (
      <div role="status" className="rounded-tile border border-success-tint bg-success-tint px-3.5 py-3 text-dense leading-normal text-success">
        <span className="font-medium">Check {email}.</span> The sign-in link works once and expires in an hour; it drops you straight into {teamName}.
        <button type="button" onClick={request} disabled={pending} className="ml-2 font-medium text-teal hover:text-navy disabled:opacity-60">
          Send again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-body leading-relaxed text-ink">
        Continue as <span className="font-medium">{email}</span>. We&apos;ll email you a one-time sign-in link — no password needed to get started.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={request} disabled={pending} className="h-10">
          {pending ? "Sending…" : "Email me a sign-in link"}
        </Button>
        {error ? (
          <p role="alert" className="m-0 text-dense text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
