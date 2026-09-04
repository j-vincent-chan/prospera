"use client";

import { useEffect, useState, useTransition } from "react";
import { saveSearchV2Action } from "@/app/actions/opportunity-actions";
import { listCommunitiesAction } from "@/app/actions/community-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

export function SaveSearchDialog({ open, onClose, defaultName, filterSummary, listState, onSaved }: { open: boolean; onClose: () => void; defaultName: string; filterSummary: string; listState: unknown; onSaved: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(defaultName);
  const [visibility, setVisibility] = useState<"personal" | "team">("team");
  const [alerts, setAlerts] = useState<"weekly" | "daily" | "none">("weekly");
  const [forecasted, setForecasted] = useState(true);
  const [communityId, setCommunityId] = useState("");
  const [communities, setCommunities] = useState<Array<{ id: string; label: string; active: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);
  useEffect(() => {
    if (!open) return;
    void listCommunitiesAction().then((r) => setCommunities(r.ok ? r.communities : []));
  }, [open]);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await saveSearchV2Action({ name, state: listState, visibility, alerts, includeForecasted: forecasted, communityId: communityId || null });
      if (!result.ok) return setError(result.error);
      toast({ message: `Saved search “${name.trim()}”` });
      onSaved();
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save this search"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={pending || !name.trim()}>{pending ? "Saving…" : "Save search"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5 py-2">
        <Field label="Name" labelSize={12} error={error ?? undefined}>
          {({ id, invalid }) => <Input id={id} invalid={invalid} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <div className="rounded-tile bg-canvas px-3 py-2.5 text-meta leading-normal text-ink-body">
          <span className="font-medium text-ink">Filters:</span> {filterSummary}
        </div>
        <Field label="Visibility" labelSize={12}>
          {({ id }) => (
            <Select id={id} value={visibility} onChange={(e) => setVisibility(e.target.value as "personal" | "team")} className="w-full">
              <option value="team">Whole team (shared)</option>
              <option value="personal">Just me</option>
            </Select>
          )}
        </Field>
        <Field label="Community" labelSize={12} hint="optional" help="Shows the search's new matches on that community's overview.">
          {({ id }) => (
            <Select id={id} value={communityId} onChange={(e) => setCommunityId(e.target.value)} className="w-full">
              <option value="">Not linked to a community</option>
              {communities.map((c) => <option key={c.id} value={c.id}>{c.label}{c.active ? "" : " (inactive)"}</option>)}
            </Select>
          )}
        </Field>
        <div>
          <p className="mb-2 mt-0 text-meta font-medium text-ink-body">Alerts</p>
          <div className="flex flex-col gap-2 text-dense">
            {([
              ["weekly", "Weekly digest (Monday morning)"],
              ["daily", "Daily, only when there are new matches"],
              ["none", "No email — show on Home only"],
            ] as const).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="alerts" checked={alerts === v} onChange={() => setAlerts(v)} className="m-0 accent-navy" />
                {label}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-dense text-ink-body">
          <Checkbox checked={forecasted} onChange={(e) => setForecasted(e.target.checked)} />
          Include forecasted notices and alert me when they post
        </label>
      </div>
    </Dialog>
  );
}
