"use client";

import { useEffect, useState, useTransition } from "react";
import { requestBiosketchAction, updateIdentifiersAction } from "@/app/actions/investigator-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { SourceActionKind } from "@/lib/investigators/sources";

/**
 * The small dialogs behind the source-chip actions: add an identifier
 * (profile ID, email, ORCID iD, Profiles link) and send a biosketch request.
 * Shared by the directory table and the profile page.
 */

export type IdentifierKind = Extract<SourceActionKind, "add_profile_id" | "add_email" | "add_orcid" | "connect_profiles">;

const IDENTIFIER_COPY: Record<IdentifierKind, { title: string; label: string; placeholder: string; help: string; mono: boolean }> = {
  add_profile_id: {
    title: "Add RePORTER profile ID",
    label: "NIH RePORTER profile ID",
    placeholder: "e.g. 8033726",
    help: "The numeric PI profile ID from a RePORTER project page. Awards are matched by this ID only, never by name, so an unrelated namesake can't slip in.",
    mono: true,
  },
  add_email: {
    title: "Add email",
    label: "UCSF email",
    placeholder: "name@ucsf.edu",
    help: "Needed for outreach, reply tracking and biosketch requests.",
    mono: false,
  },
  add_orcid: {
    title: "Add ORCID iD",
    label: "ORCID iD",
    placeholder: "0000-0000-0000-0000",
    help: "Works on the ORCID record verify name-only PubMed matches.",
    mono: true,
  },
  connect_profiles: {
    title: "Connect UCSF Profiles",
    label: "profiles.ucsf.edu link",
    placeholder: "https://profiles.ucsf.edu/first.last",
    help: "Prospera guesses first.last from the name; paste the link if the guess is wrong.",
    mono: false,
  },
};

export function IdentifierDialog({
  kind,
  investigatorId,
  investigatorName,
  initialValue,
  onClose,
  onSaved,
}: {
  kind: IdentifierKind | null;
  investigatorId: string;
  investigatorName: string;
  initialValue?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(initialValue ?? "");
    setError(null);
  }, [kind, initialValue]);
  if (!kind) return null;
  const copy = IDENTIFIER_COPY[kind];

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const patch =
        kind === "add_profile_id" ? { nihProfileId: value } : kind === "add_email" ? { email: value } : kind === "add_orcid" ? { orcid: value } : { profilesUrlName: value };
      const refresh = kind === "add_profile_id" ? ["reporter" as const] : kind === "add_orcid" ? ["orcid" as const, "pubmed" as const] : kind === "connect_profiles" ? ["profiles" as const] : [];
      const r = await updateIdentifiersAction(investigatorId, patch, { refresh });
      if (!r.ok) return setError(r.error);
      toast({ message: r.summary ? `Saved for ${investigatorName}. ${r.summary}` : `Saved for ${investigatorName}.` });
      onSaved();
    });

  return (
    <Dialog
      open={Boolean(kind)}
      onClose={onClose}
      title={copy.title}
      description={investigatorName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={pending || !value.trim()}>{pending ? "Saving…" : kind === "add_email" ? "Save email" : "Save and fetch"}</Button>
        </>
      }
    >
      <div className="py-2">
        <Field label={copy.label} labelSize={12} error={error ?? undefined} help={error ? undefined : copy.help}>
          {({ id, invalid }) => (
            <Input id={id} invalid={invalid} value={value} onChange={(e) => setValue(e.target.value)} placeholder={copy.placeholder} autoFocus className={copy.mono ? "font-mono text-dense" : undefined} inputMode={kind === "add_profile_id" ? "numeric" : undefined} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export type BiosketchRequestKind = "request" | "reminder" | "update";

export function BiosketchRequestDialog({
  kind,
  investigatorId,
  investigatorName,
  email,
  onClose,
  onSent,
}: {
  kind: BiosketchRequestKind | null;
  investigatorId: string;
  investigatorName: string;
  email: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!kind) return null;
  const title = kind === "reminder" ? "Send a reminder" : kind === "update" ? "Request an updated biosketch" : "Request a biosketch";

  const send = () =>
    startTransition(async () => {
      setError(null);
      const r = await requestBiosketchAction(investigatorId, kind);
      if (!r.ok) return setError(r.error);
      toast({ message: `${kind === "reminder" ? "Reminder" : "Request"} sent to ${r.sentTo}.` });
      onSent();
    });

  return (
    <Dialog
      open={Boolean(kind)}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={send} disabled={pending || !email}>{pending ? "Sending…" : kind === "reminder" ? "Send reminder" : "Send request"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 py-2 text-dense leading-normal text-ink-body">
        <p className="m-0">
          Prospera emails <span className="font-medium text-ink">{investigatorName}</span> at <span className="font-medium text-ink">{email ?? "— no email on file —"}</span> with a one-time link. They upload the PDF, date it and authorize its use, or decline. Whatever they choose shows up here.
        </p>
        <p className="m-0 text-meta text-ink-muted">Missing biosketches never lower a match tier. Declines are recorded so nobody asks twice.</p>
        {error ? <p className="m-0 text-meta text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}
