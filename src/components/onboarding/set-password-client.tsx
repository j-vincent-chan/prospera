"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setInitialPasswordAction } from "@/app/actions/settings-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function SetPasswordClient({ next }: { next: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    startTransition(async () => {
      setError(null);
      const result = await setInitialPasswordAction({ password });
      if (!result.ok) return setError(result.error);
      router.replace(next);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex max-w-[420px] flex-col gap-4">
      <Field label="Password" help="At least 10 characters." error={error ?? undefined}>
        {({ id, invalid }) => (
          <Input id={id} invalid={invalid} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        )}
      </Field>
      <Field label="Confirm password" error={mismatch ? "Passwords don't match." : undefined}>
        {({ id, invalid }) => (
          <Input id={id} invalid={invalid} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        )}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={pending || password.length < 10 || mismatch}>
          {pending ? "Saving…" : "Set password and continue"}
        </Button>
      </div>
    </form>
  );
}
