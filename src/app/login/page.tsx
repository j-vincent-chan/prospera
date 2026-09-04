"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const SSO_DOMAIN = process.env.NEXT_PUBLIC_SSO_DOMAIN?.trim() || "ucsf.edu";

function safeNext(): string {
  if (typeof window === "undefined") return "/home";
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sso" | "password" | "reset" | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("error");
    if (flag !== "auth" && flag !== "expired") return;
    // Supabase reports why a link failed in the URL fragment, which survives the
    // redirect through /auth/callback. Without it every failure reads "expired".
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const code = hash.get("error_code");
    if (code === "otp_expired") {
      setError("That link has already been used or has expired. Links work once and last an hour — choose Forgot password to get a new one.");
    } else if (code === "access_denied") {
      setError("That link was refused. Request a new one with Forgot password, or sign in with your password below.");
    } else if (flag === "expired") {
      setError("That sign-in link has expired. Open your invitation again to request a new one, or sign in with your password.");
    } else {
      setError("That link didn't work. It may already have been used — choose Forgot password to get a new one.");
    }
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function signInWithSso() {
    setError(null);
    setNotice(null);
    setBusy("sso");
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext())}`;
    const { data, error: ssoErr } = await supabase.auth.signInWithSSO({
      domain: SSO_DOMAIN,
      options: { redirectTo },
    });
    if (ssoErr || !data?.url) {
      setBusy(null);
      setError(
        /provider|sso|domain/i.test(ssoErr?.message ?? "")
          ? "UCSF MyAccess isn't connected to Prospera yet. Sign in with your password below, or ask a team owner."
          : (ssoErr?.message ?? "Could not start single sign-on."),
      );
      return;
    }
    window.location.assign(data.url);
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy("password");
    const supabase = createClient();
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(null);
    if (signErr) {
      setError(signErr.message);
      return;
    }
    router.replace(safeNext());
    router.refresh();
  }

  async function forgotPassword() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email address first, then choose Forgot password.");
      return;
    }
    setBusy("reset");
    const supabase = createClient();
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/settings?password=reset")}`,
    });
    setBusy(null);
    if (resetErr) {
      setError(resetErr.message);
      return;
    }
    setNotice(`If ${email.trim()} is a Prospera account, a reset link is on its way. It works once and expires in an hour.`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-canvas px-4 py-10">
      <div className="flex flex-col items-center gap-3">
        <Image src="/brand/prospera-app-icon.png" alt="" width={180} height={198} priority className="h-14 w-auto" />
        <Image src="/brand/prospera-wordmark.png" alt="Prospera" width={555} height={115} priority className="h-[26px] w-auto" />
        <p className="m-0 text-dense text-ink-muted">Funding opportunities for UCSF research development</p>
      </div>

      <form
        onSubmit={signInWithPassword}
        className="flex w-full max-w-[380px] flex-col gap-4 rounded-card border border-line bg-card p-7"
      >
        <h1 className="sr-only">Sign in to Prospera</h1>

        <Button
          type="button"
          variant="primary"
          onClick={signInWithSso}
          disabled={busy !== null}
          className="h-10 w-full gap-2"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          }
        >
          {busy === "sso" ? "Opening UCSF MyAccess…" : "Sign in with UCSF MyAccess"}
        </Button>
        <p className="m-0 text-center text-meta text-ink-muted">Single sign-on for UCSF faculty and staff</p>

        <div className="flex items-center gap-3 text-meta text-ink-muted">
          <span className="h-px flex-1 bg-line" />
          External collaborators
          <span className="h-px flex-1 bg-line" />
        </div>

        <Field label="Email" labelSize={12}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              placeholder="you@ucsf.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Password"
          labelSize={12}
          labelAside={
            <button
              type="button"
              onClick={forgotPassword}
              disabled={busy !== null}
              className="text-meta font-normal text-teal hover:text-navy disabled:opacity-60"
            >
              {busy === "reset" ? "Sending…" : "Forgot password?"}
            </button>
          }
        >
          {({ id }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        {error ? (
          <p role="alert" className="m-0 text-dense leading-normal text-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="m-0 text-dense leading-normal text-success">
            {notice}
          </p>
        ) : null}

        <Button type="submit" variant="secondary" disabled={busy !== null || !email || !password} className="w-full">
          {busy === "password" ? "Signing in…" : "Sign in with password"}
        </Button>
      </form>

      <p className="m-0 text-meta text-ink-muted">
        © 2026 Office of Collaborative Research, UCSF ·{" "}
        <a href="#" className="text-ink-muted underline-offset-2 hover:text-navy">
          Privacy
        </a>{" "}
        ·{" "}
        <a href="#" className="text-ink-muted underline-offset-2 hover:text-navy">
          Help
        </a>
      </p>
    </div>
  );
}
