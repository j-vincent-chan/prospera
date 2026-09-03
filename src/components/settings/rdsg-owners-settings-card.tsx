"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createRdsgOwnerAction,
  deleteRdsgOwnerAction,
  reactivateRdsgOwnerAction,
  updateRdsgOwnerAction,
} from "@/app/actions/rdsg-owners-actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type RdsgOwnerSettingsRow = {
  id: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
};

function RdsgOwnerRow({
  owner,
  onChanged,
}: {
  owner: RdsgOwnerSettingsRow;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(owner.fullName);
  const [email, setEmail] = useState(owner.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const resetFields = () => {
    setFullName(owner.fullName);
    setEmail(owner.email ?? "");
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateRdsgOwnerAction({
        id: owner.id,
        fullName,
        email,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  };

  const remove = () => {
    const ok = window.confirm(
      `Remove ${owner.fullName} from the active RDSG list? They will no longer appear in pipeline owner or alert recipient pickers.`
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteRdsgOwnerAction({ id: owner.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChanged();
    });
  };

  const restore = () => {
    setError(null);
    startTransition(async () => {
      const res = await reactivateRdsgOwnerAction({ id: owner.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChanged();
    });
  };

  if (editing) {
    return (
      <li className="rounded-xl border border-[var(--border)] bg-[var(--fo-paper)] p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`rdsg-name-${owner.id}`}>Full name</Label>
            <Input
              id={`rdsg-name-${owner.id}`}
              value={fullName}
              disabled={pending}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`rdsg-email-${owner.id}`}>Email</Label>
            <Input
              id={`rdsg-email-${owner.id}`}
              type="email"
              value={email}
              disabled={pending}
              placeholder="name@ucsf.edu"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              resetFields();
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--fo-title)]">{owner.fullName}</p>
        <p className="text-sm text-[var(--fo-ink-muted)]">
          {owner.email ? owner.email : <span className="italic">No email on file</span>}
        </p>
        {!owner.isActive ? (
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-amber-700">Inactive</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
          Edit
        </Button>
        {owner.isActive ? (
          <Button variant="destructive-outline" disabled={pending} onClick={remove}>
            Delete
          </Button>
        ) : (
          <Button variant="secondary" disabled={pending} onClick={restore}>
            Reactivate
          </Button>
        )}
      </div>
      {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
    </li>
  );
}

export function RdsgOwnersSettingsCard({ owners }: { owners: RdsgOwnerSettingsRow[] }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeOwners = owners.filter((o) => o.isActive);
  const inactiveOwners = owners.filter((o) => !o.isActive);

  const refresh = () => router.refresh();

  const addOwner = () => {
    setError(null);
    startTransition(async () => {
      const res = await createRdsgOwnerAction({ fullName, email });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFullName("");
      setEmail("");
      refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title="RDSG team"
        description="Manage Research Development Strategy Group contacts used for pipeline ownership and saved-search alert recipients."
      />
      <CardBody className="space-y-6">
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--fo-paper)] p-4">
          <p className="mb-3 text-sm font-medium text-[var(--fo-title)]">Add RDSG</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-rdsg-name">Full name</Label>
              <Input
                id="new-rdsg-name"
                value={fullName}
                disabled={pending}
                placeholder="Jane Doe, PhD"
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-rdsg-email">Email</Label>
              <Input
                id="new-rdsg-email"
                type="email"
                value={email}
                disabled={pending}
                placeholder="name@ucsf.edu"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
          <Button className="mt-3" disabled={pending || !fullName.trim()} onClick={addOwner}>
            {pending ? "Adding…" : "Add RDSG"}
          </Button>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[var(--fo-title)]">
            Active ({activeOwners.length})
          </p>
          {activeOwners.length === 0 ? (
            <p className="text-sm text-[var(--fo-ink-muted)]">No active RDSG contacts yet.</p>
          ) : (
            <ul className="space-y-2">
              {activeOwners.map((owner) => (
                <RdsgOwnerRow key={owner.id} owner={owner} onChanged={refresh} />
              ))}
            </ul>
          )}
        </div>

        {inactiveOwners.length > 0 ? (
          <div>
            <p className="mb-2 text-sm font-medium text-[var(--fo-title)]">
              Inactive ({inactiveOwners.length})
            </p>
            <ul className="space-y-2">
              {inactiveOwners.map((owner) => (
                <RdsgOwnerRow key={owner.id} owner={owner} onChanged={refresh} />
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
