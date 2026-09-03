"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  setNotificationPreferenceAction,
  updateDigestSettingsAction,
  updatePasswordAction,
  updateProfileAction,
} from "@/app/actions/settings-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import type { DigestTime, NotificationEventType, NotificationPreference, Profile } from "@/lib/team/types";

const EVENT_COPY: Record<NotificationEventType, { title: string; note?: string }> = {
  pi_reply: { title: "PI replies to a brief or message", note: "Interested, Maybe, Not this cycle" },
  access_requests: { title: "Access requests and invitations", note: "Owners and admins only" },
  saved_search_matches: { title: "New matches in saved searches" },
  watched_forecasts: { title: "Watched forecasts post or change dates" },
  next_actions_due: { title: "My next actions due or overdue" },
  data_source_failing: { title: "Data source failing", note: "Owners and admins only" },
};

export function SettingsClient({
  profile,
  roleLabel,
  teamName,
  preferences,
  passwordAccount,
  passwordReset,
}: {
  profile: Profile;
  /** Team role label, or "Admin"/"Staff" from the legacy flag when there is no team. */
  roleLabel: string;
  teamName: string | null;
  preferences: NotificationPreference[];
  /** True when the user signs in with a password (external collaborator). */
  passwordAccount: boolean;
  /** Arrived from a password-reset email. */
  passwordReset: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile.fullName ?? "");
  const [title, setTitle] = useState(profile.title ?? "");
  const [department, setDepartment] = useState(profile.department ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);

  const [prefs, setPrefs] = useState(preferences);
  const [digestTime, setDigestTime] = useState<DigestTime>(profile.digestTime);
  const [weekdaysOnly, setWeekdaysOnly] = useState(profile.digestWeekdaysOnly);

  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const saveProfile = () =>
    startTransition(async () => {
      setProfileError(null);
      const result = await updateProfileAction({ fullName, title, department });
      if (!result.ok) return setProfileError(result.error);
      setEditing(false);
      toast({ message: "Profile saved" });
      router.refresh();
    });

  const togglePref = (eventType: NotificationEventType, channel: "immediate" | "digest", enabled: boolean) => {
    setPrefs((current) => current.map((p) => (p.eventType === eventType ? { ...p, [channel]: enabled } : p)));
    startTransition(async () => {
      const result = await setNotificationPreferenceAction({ eventType, channel, enabled });
      if (!result.ok) {
        setPrefs((current) => current.map((p) => (p.eventType === eventType ? { ...p, [channel]: !enabled } : p)));
        toast({ tone: "error", message: result.error });
      }
    });
  };

  const saveDigest = (next: { digestTime?: DigestTime; weekdaysOnly?: boolean }) => {
    const time = next.digestTime ?? digestTime;
    const weekdays = next.weekdaysOnly ?? weekdaysOnly;
    setDigestTime(time);
    setWeekdaysOnly(weekdays);
    startTransition(async () => {
      const result = await updateDigestSettingsAction({ digestTime: time, weekdaysOnly: weekdays });
      if (!result.ok) toast({ tone: "error", message: result.error });
    });
  };

  const savePassword = () =>
    startTransition(async () => {
      setPasswordError(null);
      const result = await updatePasswordAction({ password });
      if (!result.ok) return setPasswordError(result.error);
      setPassword("");
      toast({ message: "Password updated" });
    });

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 mt-0 text-label font-semibold uppercase text-ink-muted">Personal · applies to you in every team</p>
          <h1 className="m-0 text-h1 font-semibold text-ink">Settings</h1>
        </div>
        {teamName ? (
          <Link href="/team" className="shrink-0">
            <Button variant="secondary">Team settings · {teamName} →</Button>
          </Link>
        ) : (
          <Link href="/onboarding" className="shrink-0">
            <Button variant="secondary">Create or join a team →</Button>
          </Link>
        )}
      </header>

      <Tabs
        active="profile"
        items={[
          { key: "profile", label: "Profile" },
          { key: "team", label: "Team", href: teamName ? "/team" : "/onboarding" },
          { key: "data", label: "Data & AI", href: "/team/data-sources" },
        ]}
      />

      <section className="rounded-card border border-line bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="m-0 text-[15px] font-semibold text-ink">Profile</h2>
          {editing ? null : (
            <Button variant="secondary" size={28} onClick={() => setEditing(true)}>Edit</Button>
          )}
        </div>
        {editing ? (
          <div className="flex max-w-[480px] flex-col gap-3.5">
            <Field label="Name" error={profileError ?? undefined}>
              {({ id, invalid }) => <Input id={id} invalid={invalid} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
            </Field>
            <Field label="Title" hint="(shown on access requests and outreach signatures)">
              {({ id }) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Research Development Strategist" />}
            </Field>
            <Field label="Department">
              {({ id }) => <Input id={id} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Office of Collaborative Research" />}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size={32} onClick={() => { setEditing(false); setFullName(profile.fullName ?? ""); setTitle(profile.title ?? ""); setDepartment(profile.department ?? ""); }} disabled={pending}>Cancel</Button>
              <Button variant="primary" size={32} onClick={saveProfile} disabled={pending}>Save</Button>
            </div>
          </div>
        ) : (
          <dl className="m-0 grid grid-cols-[160px_1fr] gap-x-4 gap-y-3 text-body">
            <dt className="text-ink-muted">Name</dt>
            <dd className="m-0 text-ink">{profile.fullName ?? "—"}</dd>
            <dt className="text-ink-muted">Email</dt>
            <dd className="m-0 text-ink">{profile.email ?? "—"}</dd>
            <dt className="text-ink-muted">Title</dt>
            <dd className="m-0 text-ink">{profile.title ?? "—"}</dd>
            <dt className="text-ink-muted">Department</dt>
            <dd className="m-0 text-ink">{profile.department ?? "—"}</dd>
            <dt className="text-ink-muted">Role</dt>
            <dd className="m-0"><Pill variant="status-closed">{roleLabel}</Pill></dd>
          </dl>
        )}
      </section>

      {passwordAccount ? (
        <section className="rounded-card border border-line bg-card p-5">
          <h2 className="m-0 text-[15px] font-semibold text-ink">Password</h2>
          <p className="mb-3.5 mt-0.5 text-meta text-ink-muted">
            {passwordReset ? "Set a new password to finish resetting it." : "External collaborators sign in with a password. UCSF staff use MyAccess and can ignore this."}
          </p>
          <div className="flex max-w-[480px] items-end gap-2">
            <Field label="New password" labelSize={12} error={passwordError ?? undefined} className="flex-1">
              {({ id, invalid }) => <Input id={id} invalid={invalid} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Button variant="secondary" onClick={savePassword} disabled={pending || password.length < 10} className={passwordError ? "mb-6" : ""}>Update password</Button>
          </div>
        </section>
      ) : null}

      <section className="rounded-card border border-line bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="m-0 text-section font-semibold uppercase text-ink">Notifications</h2>
          <span className="text-meta text-ink-muted">Everything also appears on Home as it happens</span>
        </div>
        <div className="flex flex-col px-5 pb-3.5 pt-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-4 border-b border-line-row py-2 text-label font-semibold uppercase text-ink-muted">
            <span /><span>Immediately</span><span>Daily digest</span>
          </div>
          {prefs.map((p, i) => (
            <div key={p.eventType} className={`grid grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-4 py-2.5 text-body ${i < prefs.length - 1 ? "border-b border-line-row" : ""}`}>
              <span>
                {EVENT_COPY[p.eventType].title}
                {EVENT_COPY[p.eventType].note ? <span className="block text-meta text-ink-muted">{EVENT_COPY[p.eventType].note}</span> : null}
              </span>
              <Checkbox aria-label={`${EVENT_COPY[p.eventType].title} · immediately`} checked={p.immediate} onChange={(e) => togglePref(p.eventType, "immediate", e.target.checked)} />
              <Checkbox aria-label={`${EVENT_COPY[p.eventType].title} · daily digest`} checked={p.digest} onChange={(e) => togglePref(p.eventType, "digest", e.target.checked)} />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-3 text-dense text-ink-body">
            Digest arrives at
            <Select size={32} aria-label="Digest time" value={digestTime} onChange={(e) => saveDigest({ digestTime: e.target.value as DigestTime })}>
              <option value="07:30">7:30 AM</option>
              <option value="12:00">12:00 PM</option>
              <option value="17:00">5:00 PM</option>
            </Select>
            Pacific, weekdays only
            <Checkbox aria-label="Weekdays only" className="ml-2" checked={weekdaysOnly} onChange={(e) => saveDigest({ weekdaysOnly: e.target.checked })} />
          </div>
        </div>
      </section>
    </div>
  );
}
