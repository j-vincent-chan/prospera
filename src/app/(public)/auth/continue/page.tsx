import { redirect } from "next/navigation";

/**
 * Interstitial for links sent by email (password reset, invitation, magic
 * link). UCSF mail passes through Proofpoint and Exchange Online, which open
 * links to scan them before anyone clicks; a link that verified on GET was
 * consumed by the scanner. Nothing is verified until the person presses the
 * button, which POSTs to /auth/confirm.
 */
const COPY: Record<string, { eyebrow: string; title: string; body: string; button: string }> = {
  recovery: { eyebrow: "Password reset", title: "Choose a new password for Prospera", body: "Press the button to continue to the password screen. The link works once and expires an hour after it was sent.", button: "Continue to set my password" },
  invite: { eyebrow: "Invitation", title: "Accept your Prospera invitation", body: "Press the button to accept the invitation and choose a password. The link works once.", button: "Accept invitation" },
  magiclink: { eyebrow: "Sign in", title: "Sign in to Prospera", body: "Press the button to finish signing in. The link works once and expires an hour after it was sent.", button: "Sign in" },
  email: { eyebrow: "Confirm email", title: "Confirm your email for Prospera", body: "Press the button to confirm this address.", button: "Confirm" },
};

export default function AuthContinuePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const tokenHash = typeof searchParams.token_hash === "string" ? searchParams.token_hash : "";
  const type = typeof searchParams.type === "string" ? searchParams.type : "";
  const rawNext = typeof searchParams.next === "string" ? searchParams.next : "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/home";
  if (!tokenHash || !COPY[type]) redirect("/login?error=expired");
  const copy = COPY[type]!;
  return (
    <div className="flex w-full max-w-[520px] flex-col gap-5">
      <div>
        <p className="mb-1.5 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">{copy.eyebrow}</p>
        <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">{copy.title}</h1>
        <p className="mb-0 mt-2 text-body leading-relaxed text-ink-body">{copy.body}</p>
      </div>
      <form method="post" action="/auth/confirm" className="rounded-card border border-line bg-card p-5">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="inline-flex h-11 w-full items-center justify-center rounded-control bg-navy px-4 text-body font-medium text-white hover:bg-navy-hover">{copy.button}</button>
        <p className="mb-0 mt-3 text-meta leading-normal text-ink-muted">If this wasn&apos;t you, close this page. Nothing happens until the button is pressed.</p>
      </form>
    </div>
  );
}
