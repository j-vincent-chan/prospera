"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { ProsperaLogo } from "@/components/layout/prospera-logo";
import { PoweredByOcr } from "@/components/layout/powered-by-ocr";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signErr) {
      setError(signErr.message);
      return;
    }
    router.replace("/funding-opportunities");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--fo-canvas)] px-4 pb-10 pt-8">
      <div className="mb-6 w-full max-w-md">
        <ProsperaLogo variant="login" linked={false} />
      </div>
      <Card className="w-full max-w-md border-l-[4px] border-l-[color-mix(in_srgb,var(--fo-accent)_80%,var(--fo-border))] shadow-lift">
        <div className="border-b border-[var(--border)] bg-[var(--fo-paper-2)] px-4 py-4">
          <h1 className="sr-only">Prospera</h1>
          <p className="text-sm text-[var(--fo-ink-body)]">Sign in with your institutional email.</p>
        </div>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardBody>
      </Card>
      <PoweredByOcr variant="centered" />
    </div>
  );
}
