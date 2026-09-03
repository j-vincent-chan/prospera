"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import {
  approveAccessRequestAction,
  archiveTeamAction,
  deleteTeamAction,
  denyAccessRequestAction,
  leaveTeamAction,
  reinstateMemberAction,
  removeMemberAction,
  removeTeamLogoAction,
  reopenAccessRequestAction,
  resendInvitationAction,
  resetInviteLinkAction,
  restoreInvitationAction,
  restoreTeamAction,
  restoreTeamLogoAction,
  revokeInvitationAction,
  sendInvitationsAction,
  setLogoOnBriefsAction,
  setMemberRoleAction,
  undoApproveAccessRequestAction,
  updateTeamGeneralAction,
  updateTeamOutreachAction,
  uploadTeamLogoAction,
} from "@/app/actions/team-actions";
import { TeamTile } from "@/components/layout/app-shell-sidebar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Menu, MenuItem } from "@/components/ui/menu";
import { RadioCard } from "@/components/ui/radio-card";
import { Select } from "@/components/ui/select";
import { SegmentTabs, Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { inviteLinkUrl } from "@/lib/email/send-team-emails";
import { expiresLabel, fmtMonthYear, fmtShort, initialsOf, isPast } from "@/lib/team/format";
import {
  ROLE_LABEL,
  teamInitials,
  teamLogoUrl,
  type AccessRequestRow,
  type FormerMemberRow,
  type InvitationRow,
  type InviteLink,
  type MemberRow,
  type Team,
  type TeamRole,
} from "@/lib/team/types";
import { cn } from "@/lib/utils/cn";

export type TopTab = "general" | "members" | "outreach";
export type SubTab = "members" | "requests" | "invites";

type Props = {
  team: Team;
  viewerId: string;
  viewerRole: TeamRole;
  members: MemberRow[];
  formerMembers: FormerMemberRow[];
  requests: AccessRequestRow[];
  invitations: InvitationRow[];
  inviteLink: InviteLink | null;
  initialTab: TopTab;
  initialSub: SubTab;
};

const roleArticle = (r: TeamRole) => (r === "member" ? "a Member" : r === "admin" ? "an Admin" : "an Owner");

function Section({ title, children, tone = "default", className }: { title?: ReactNode; children: ReactNode; tone?: "default" | "danger"; className?: string }) {
  return (
    <section className={cn("rounded-card border bg-card", tone === "danger" ? "border-danger-border" : "border-line", className)}>
      {title ? (
        <div className={cn("border-b px-5 py-3.5", tone === "danger" ? "border-danger-tint" : "border-line")}>
          <h2 className={cn("m-0 text-section font-semibold uppercase", tone === "danger" ? "text-danger-dark" : "text-ink")}>{title}</h2>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function TeamSettingsClient(props: Props) {
  const { team, viewerRole } = props;
  const [tab, setTab] = useState<TopTab>(props.initialTab);
  const isAdmin = viewerRole === "owner" || viewerRole === "admin";

  return (
    <div className="flex max-w-[1040px] flex-col gap-5">
      <header>
        <p className="mb-1 mt-0 text-label font-semibold uppercase text-ink-muted">
          {team.name} · you are {roleArticle(viewerRole)}
        </p>
        <h1 className="m-0 text-h1 font-semibold text-ink">Team settings</h1>
      </header>

      <Tabs
        active={tab}
        items={[
          { key: "general", label: "General", onSelect: () => setTab("general") },
          { key: "members", label: "Members", onSelect: () => setTab("members") },
          { key: "communities", label: "Communities", disabled: true },
          { key: "data-sources", label: "Data sources", href: "/team/data-sources" },
          { key: "outreach", label: "Outreach", onSelect: () => setTab("outreach") },
        ]}
        aside={
          <Link href="/settings" className="whitespace-nowrap text-dense font-medium text-teal hover:text-navy">
            Personal settings →
          </Link>
        }
      />

      {tab === "general" ? <GeneralTab {...props} canEdit={isAdmin} /> : null}
      {tab === "members" ? <MembersArea {...props} canEdit={isAdmin} /> : null}
      {tab === "outreach" ? <OutreachTab {...props} canEdit={isAdmin} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

function GeneralTab({ team, viewerRole, canEdit }: Props & { canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoPath, setLogoPath] = useState(team.logoPath);
  const [logoOnBriefs, setLogoOnBriefs] = useState(team.logoOnBriefs);

  const [name, setName] = useState(team.name);
  const [slug, setSlug] = useState(team.slug);
  const [description, setDescription] = useState(team.description ?? "");
  const [routingDays, setRoutingDays] = useState(team.routingDays);
  const [routingDayType, setRoutingDayType] = useState(team.routingDayType);
  const [holidays, setHolidays] = useState(team.routingHolidayCalendar);
  const [discoverability, setDiscoverability] = useState(team.discoverability);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(team.name);
    setSlug(team.slug);
    setDescription(team.description ?? "");
    setRoutingDays(team.routingDays);
    setRoutingDayType(team.routingDayType);
    setHolidays(team.routingHolidayCalendar);
    setDiscoverability(team.discoverability);
    setError(null);
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await updateTeamGeneralAction({
        teamId: team.id,
        name,
        slug,
        description,
        discoverability,
        routingDays,
        routingDayType,
        routingHolidayCalendar: holidays,
      });
      if (!result.ok) return setError(result.error);
      toast({ message: "Team details saved" });
      router.refresh();
    });

  const upload = (file: File) =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("teamId", team.id);
      fd.set("file", file);
      const result = await uploadTeamLogoAction(fd);
      if (!result.ok) return toast({ tone: "error", message: result.error });
      setLogoPath(result.logoPath);
      toast({ message: "Logo updated" });
      router.refresh();
    });

  const removeLogo = () =>
    startTransition(async () => {
      const result = await removeTeamLogoAction({ teamId: team.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      const previous = result.previousPath;
      setLogoPath(null);
      toast({
        message: "Logo removed · showing initials",
        action: previous
          ? {
              label: "Undo",
              onClick: () =>
                startTransition(async () => {
                  const r = await restoreTeamLogoAction({ teamId: team.id, logoPath: previous });
                  if (r.ok) setLogoPath(previous);
                  router.refresh();
                }),
            }
          : undefined,
      });
      router.refresh();
    });

  const tile = { name: team.name, initials: teamInitials(name || team.name), logoUrl: teamLogoUrl(logoPath) };
  const roleLabel = ROLE_LABEL[viewerRole];

  return (
    <>
      <Section title="Team logo">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-6 p-5">
          <div className="flex flex-col items-center gap-2.5">
            <TeamTile team={tile} size={96} />
            <span className="text-micro text-ink-muted">{logoPath ? "Custom" : "Default · initials"}</span>
          </div>
          <div className="flex flex-col gap-3">
            <p className="m-0 text-body leading-relaxed text-ink">
              Shown in the workspace switcher, on the team&apos;s join page, and on briefs and outreach emails sent from this team. Without a logo Prospera shows the team&apos;s initials.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/svg+xml"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                }}
              />
              {logoPath ? (
                <Button variant="secondary" size={32} onClick={removeLogo} disabled={!canEdit || pending}>Remove · use initials</Button>
              ) : (
                <Button variant="primary" size={32} onClick={() => fileRef.current?.click()} disabled={!canEdit || pending}>Upload logo</Button>
              )}
              {logoPath ? (
                <Button variant="secondary" size={32} onClick={() => fileRef.current?.click()} disabled={!canEdit || pending}>Replace</Button>
              ) : null}
              <label className="inline-flex h-8 items-center gap-2 text-dense text-ink-body">
                <Checkbox
                  checked={logoOnBriefs}
                  disabled={!canEdit || pending}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setLogoOnBriefs(enabled);
                    startTransition(async () => {
                      const r = await setLogoOnBriefsAction({ teamId: team.id, enabled });
                      if (!r.ok) {
                        setLogoOnBriefs(!enabled);
                        toast({ tone: "error", message: r.error });
                      }
                    });
                  }}
                />
                Also use on PI-facing briefs and emails
              </label>
            </div>
            <p className="m-0 text-meta leading-normal text-ink-muted">
              Square PNG or SVG, at least 256 × 256, under 1 MB. Prospera crops to a rounded square; keep marks clear of the corners. The Prospera and OCR marks stay in the footer regardless.
            </p>
            <div className="flex items-center gap-4 rounded-tile border border-line bg-canvas px-3.5 py-3">
              <span className="whitespace-nowrap text-label font-semibold uppercase text-ink-muted">Preview</span>
              <span className="flex h-[46px] w-[216px] items-center gap-2.5 rounded-tile border border-line bg-card px-2">
                <TeamTile team={tile} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-dense font-semibold text-ink">{name || team.name}</span>
                  <span className="block text-micro text-ink-muted">Team workspace · {roleLabel}</span>
                </span>
              </span>
              <span className="text-meta text-ink-muted">Workspace switcher</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Team details">
        <div className="flex max-w-[640px] flex-col gap-4 p-5">
          <Field label="Team name">
            {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="h-[38px]" />}
          </Field>
          <Field label="Workspace address" help="Changing it breaks links teammates have shared. Old addresses redirect for 90 days." error={error && /address/i.test(error) ? error : undefined}>
            {({ id, invalid }) => (
              <div className={cn("flex h-[38px] items-center overflow-hidden rounded-control border", invalid ? "border-danger" : "border-line-control")}>
                <span className="flex h-full items-center whitespace-nowrap border-r border-line-control bg-canvas px-3 text-dense text-ink-muted">prospera.ucsf.edu/t/</span>
                <input id={id} value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!canEdit} className="h-full flex-1 border-0 bg-card px-3 font-mono text-body text-ink outline-none disabled:text-ink-muted" />
              </div>
            )}
          </Field>
          <Field label="Description">
            {({ id }) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />}
          </Field>
          <div>
            <p className="mb-1.5 mt-0 text-dense font-medium text-ink">Internal routing deadline</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-dense text-ink-body">Sponsor due date minus</span>
              <Input type="number" min={0} max={60} value={routingDays} onChange={(e) => setRoutingDays(Number(e.target.value))} disabled={!canEdit} className="w-14 text-center" />
              <Select value={routingDayType} onChange={(e) => setRoutingDayType(e.target.value as Team["routingDayType"])} disabled={!canEdit}>
                <option value="business">business days</option>
                <option value="calendar">calendar days</option>
              </Select>
              <span className="text-dense text-ink-body">· skip</span>
              <Select value={holidays} onChange={(e) => setHolidays(e.target.value as Team["routingHolidayCalendar"])} disabled={!canEdit}>
                <option value="ucsf">UCSF holiday calendar</option>
                <option value="us_federal">US federal holidays</option>
                <option value="none">No holidays</option>
              </Select>
            </div>
            <p className="mb-0 mt-1.5 text-meta leading-normal text-ink-muted">
              Drives every “internal routing” date in Prospera and the Calendar. Change it when OSR policy changes; existing dates recompute.
            </p>
          </div>
          <div>
            <p className="mb-2 mt-0 text-dense font-medium text-ink">Who can find this team</p>
            <div className="flex flex-col gap-2">
              <RadioCard name="disc" checked={discoverability === "invite_only"} disabled={!canEdit} onChange={() => setDiscoverability("invite_only")} title="Invite only" suffix="· default" description="Hidden from search. People join through invitations." />
              <RadioCard name="disc" checked={discoverability === "domain"} disabled={!canEdit} onChange={() => setDiscoverability("domain")} title={`Anyone at ${team.domain} can find and request to join`} description={`You approve every request. Nobody outside ${team.domain} can see the team.`} />
            </div>
          </div>
          {error && !/address/i.test(error) ? <p role="alert" className="m-0 text-dense text-danger">{error}</p> : null}
          {canEdit ? (
            <div className="flex justify-end gap-2 border-t border-line-row pt-3">
              <Button variant="secondary" size={32} onClick={reset} disabled={pending}>Cancel</Button>
              <Button variant="primary" size={32} onClick={save} disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
            </div>
          ) : null}
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Members · Requests · Invitations
// ---------------------------------------------------------------------------

type DialogKind = { kind: "leave" } | { kind: "remove"; member: MemberRow } | { kind: "archive" } | { kind: "delete" } | { kind: "deny"; request: AccessRequestRow } | null;

function MembersArea(props: Props & { canEdit: boolean }) {
  const { team, viewerId, viewerRole, canEdit } = props;
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [sub, setSub] = useState<SubTab>(props.initialSub);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [confirmText, setConfirmText] = useState("");
  const [denyNote, setDenyNote] = useState("");

  const members = props.members;
  const owners = members.filter((m) => m.role === "owner").length;
  const soleOwner = (m: MemberRow) => m.role === "owner" && owners === 1;

  const invite = () =>
    startTransition(async () => {
      const result = await sendInvitationsAction({ teamId: team.id, emails: [inviteEmail], role: inviteRole });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      if (result.skipped[0]) toast({ tone: "error", message: `Skipped ${result.skipped[0]}` });
      else toast({ message: result.warnings[0] ?? "Invitation sent · expires in 30 days" });
      setInviteEmail("");
      setSub("invites");
      router.refresh();
    });

  const setRole = (m: MemberRow, role: TeamRole) =>
    startTransition(async () => {
      const result = await setMemberRoleAction({ teamId: team.id, userId: m.userId, role });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      const previous = result.previousRole;
      toast({
        message: `${m.fullName} is now ${roleArticle(role)}`,
        action: { label: "Undo", onClick: () => startTransition(async () => { await setMemberRoleAction({ teamId: team.id, userId: m.userId, role: previous }); router.refresh(); }) },
      });
      router.refresh();
    });

  const confirmDialog = () =>
    startTransition(async () => {
      if (!dialog) return;
      if (dialog.kind === "remove") {
        const m = dialog.member;
        const result = await removeMemberAction({ teamId: team.id, userId: m.userId });
        if (!result.ok) return toast({ tone: "error", message: result.error });
        setDialog(null);
        toast({
          message: `Removed ${m.fullName}`,
          action: { label: "Undo", onClick: () => startTransition(async () => { const r = await reinstateMemberAction({ teamId: team.id, userId: m.userId, role: m.role }); if (!r.ok) toast({ tone: "error", message: r.error }); router.refresh(); }) },
        });
      } else if (dialog.kind === "leave") {
        const result = await leaveTeamAction({ teamId: team.id });
        if (!result.ok) return toast({ tone: "error", message: result.error });
        setDialog(null);
        router.push("/onboarding");
        return;
      } else if (dialog.kind === "archive") {
        const result = await archiveTeamAction({ teamId: team.id, confirmName: confirmText });
        if (!result.ok) return toast({ tone: "error", message: result.error });
        setDialog(null);
        toast({ message: "Team archived · read-only for 90 days" });
      } else if (dialog.kind === "delete") {
        const result = await deleteTeamAction({ teamId: team.id, confirmName: confirmText });
        if (!result.ok) return toast({ tone: "error", message: result.error });
        setDialog(null);
        router.push("/onboarding");
        return;
      } else if (dialog.kind === "deny") {
        const r = dialog.request;
        const result = await denyAccessRequestAction({ requestId: r.id, note: denyNote });
        if (!result.ok) return toast({ tone: "error", message: result.error });
        setDialog(null);
        setDenyNote("");
        toast({
          message: `Denied ${r.fullName}'s request`,
          action: { label: "Undo", onClick: () => startTransition(async () => { await reopenAccessRequestAction({ requestId: r.id }); router.refresh(); }) },
        });
      }
      setConfirmText("");
      router.refresh();
    });

  const restore = () =>
    startTransition(async () => {
      const result = await restoreTeamAction({ teamId: team.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      toast({ message: "Team restored" });
      router.refresh();
    });

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <SegmentTabs
          active={sub}
          items={[
            { key: "members", label: "Members", count: members.length, onSelect: () => setSub("members") },
            { key: "requests", label: "Requests", badge: props.requests.length, onSelect: () => setSub("requests") },
            { key: "invites", label: "Invitations", count: props.invitations.length, onSelect: () => setSub("invites") },
          ]}
        />
        {canEdit ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (inviteEmail.trim()) invite();
            }}
          >
            <Input aria-label="Invite by email" placeholder="Invite by email…" type="email" size={32} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="h-[34px] w-[260px]" />
            <Select aria-label="Invite role" size={32} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "member" | "admin")} className="h-[34px]">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
            <Button type="submit" variant="primary" size={32} disabled={pending || !inviteEmail.trim()} className="h-[34px]">Invite</Button>
          </form>
        ) : null}
      </div>

      {sub === "members" ? (
        <>
          <Section>
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_150px_110px_40px] gap-4 border-b border-line px-5 py-2.5 text-label font-semibold uppercase text-ink-muted">
              <span>Person</span><span>Department</span><span>Role</span><span>Joined</span><span />
            </div>
            {members.map((m) => {
              const locked = soleOwner(m);
              const canChange = canEdit && !locked && !(m.role === "owner" && viewerRole !== "owner") && !(viewerRole === "admin" && m.userId === viewerId && false);
              return (
                <div key={m.userId} className="relative grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_150px_110px_40px] items-center gap-4 border-t border-line-row px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-teal-tint text-micro font-semibold text-teal">{initialsOf(m.fullName)}</span>
                    <div className="min-w-0">
                      <p className="m-0 flex items-center gap-1.5 whitespace-nowrap text-body font-medium text-ink">
                        {m.fullName}
                        {m.isYou ? <span className="text-micro font-normal text-ink-muted">(you)</span> : null}
                      </p>
                      <p className="m-0 truncate text-meta text-ink-muted">{m.email}</p>
                    </div>
                  </div>
                  <span className="truncate text-dense text-ink-body">{m.department ?? "—"}</span>
                  {canChange ? (
                    <Select size={30} aria-label={`Role for ${m.fullName}`} value={m.role} disabled={pending} onChange={(e) => setRole(m, e.target.value as TeamRole)}>
                      {viewerRole === "owner" ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </Select>
                  ) : (
                    <span className="inline-flex h-[30px] items-center gap-1.5 text-dense font-medium text-ink" title={locked ? "The only owner. Make someone else an Owner first." : undefined}>
                      {ROLE_LABEL[m.role]}
                      {locked ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      ) : null}
                    </span>
                  )}
                  <span className="whitespace-nowrap text-dense text-ink-body">{fmtMonthYear(m.joinedAt)}</span>
                  <Menu
                    label={`Actions for ${m.fullName}`}
                    align="end"
                    width={220}
                    trigger={({ toggle, triggerProps }) => (
                      <button type="button" onClick={toggle} aria-label={`Actions for ${m.fullName}`} {...triggerProps} className="inline-flex h-7 w-7 items-center justify-center rounded-control border border-transparent text-ink-muted hover:border-line-control hover:text-ink">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
                      </button>
                    )}
                  >
                    {m.isYou ? <MenuItem onSelect={() => setDialog({ kind: "leave" })}>Leave team…</MenuItem> : null}
                    {canEdit && !m.isYou && !locked && !(m.role === "owner" && viewerRole !== "owner") ? (
                      <MenuItem tone="destructive" onSelect={() => setDialog({ kind: "remove", member: m })}>Remove from team…</MenuItem>
                    ) : null}
                    {!m.isYou && !(canEdit && !locked && !(m.role === "owner" && viewerRole !== "owner")) ? (
                      <MenuItem disabled>No actions available</MenuItem>
                    ) : null}
                  </Menu>
                </div>
              );
            })}
            <div className="border-t border-line-row px-5 py-3 text-meta leading-normal text-ink-muted">
              Owners can do everything, including archiving the team; a team always keeps at least one. Admins manage members, communities and settings. Members do all day-to-day work: triage, edit, tag, send outreach. Transferring ownership is just making someone else an Owner, then changing your own role.
            </div>
          </Section>

          <Section title="Former members">
            {props.formerMembers.length === 0 ? (
              <div className="px-5 py-4 text-dense text-ink-muted">No former members.</div>
            ) : (
              props.formerMembers.map((f) => (
                <div key={f.id} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] items-center gap-4 border-t border-line-row px-5 py-3 text-dense first:border-t-0">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-line-row text-micro font-semibold text-ink-muted">{initialsOf(f.fullName)}</span>
                    <div>
                      <p className="m-0 text-body font-medium text-ink-body">{f.fullName}</p>
                      <p className="m-0 text-meta text-ink-muted">
                        {f.reason === "removed" ? "Removed" : "Left"} {fmtShort(f.leftAt)} · notes and outreach records stay, attributed to “{f.fullName} · former member”
                      </p>
                    </div>
                  </div>
                  <span />
                  <span />
                </div>
              ))
            )}
          </Section>

          {viewerRole === "owner" ? (
            <Section title="Team lifecycle" tone="danger">
              <div className="flex items-center justify-between gap-4 border-b border-line-row px-5 py-3.5">
                <div>
                  <p className="m-0 text-body font-medium text-ink">{team.archivedAt ? "Restore team" : "Archive team"}</p>
                  <p className="mb-0 mt-0.5 text-dense leading-normal text-ink-muted">
                    {team.archivedAt
                      ? `Archived ${fmtShort(team.archivedAt)}. Restoring makes the workspace editable again for everyone.`
                      : "Read-only for everyone for 90 days, restorable by an owner, then deleted. Members are notified."}
                  </p>
                </div>
                {team.archivedAt ? (
                  <Button variant="primary" size={32} onClick={restore} disabled={pending}>Restore</Button>
                ) : (
                  <Button variant="secondary" size={32} onClick={() => setDialog({ kind: "archive" })}>Archive…</Button>
                )}
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div>
                  <p className="m-0 text-body font-medium text-ink">Delete team</p>
                  <p className="mb-0 mt-0.5 text-dense leading-normal text-ink-muted">Removes all shared work permanently. You must type the team name.</p>
                </div>
                <Button variant="destructive-outline" size={32} onClick={() => setDialog({ kind: "delete" })} className="border-danger-border">Delete…</Button>
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      {sub === "requests" ? (
        <RequestsTab {...props} onDeny={(r) => setDialog({ kind: "deny", request: r })} />
      ) : null}

      {sub === "invites" ? <InvitesTab {...props} /> : null}

      <Dialog
        open={dialog?.kind === "leave"}
        onClose={() => setDialog(null)}
        title={`Leave ${team.name}?`}
        description="Your access ends immediately. Shared work stays with the team."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDialog} disabled={pending || (viewerRole === "owner" && owners === 1)}>Leave team</Button>
          </>
        }
      >
        <ul className="m-0 list-disc pl-[18px] text-dense leading-relaxed text-ink">
          <li>Your notes and sent outreach records stay, attributed to “{members.find((m) => m.isYou)?.fullName ?? "you"} · former member”.</li>
          <li>Anything assigned to you becomes Unassigned; the remaining owners are notified.</li>
          <li>Saved searches you created stay with the team; personal alert settings are removed.</li>
        </ul>
        {viewerRole === "owner" && owners === 1 ? (
          <div className="mt-2.5 rounded-tile border border-warning-border bg-warning-tint px-3 py-2.5 text-dense leading-normal text-warning-dark">
            You&apos;re the only Owner. Make someone else an Owner before leaving.
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={dialog?.kind === "remove"}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "remove" ? `Remove ${dialog.member.fullName} from the team?` : ""}
        description="Their access ends immediately. Shared work stays with the team."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDialog} disabled={pending}>Remove</Button>
          </>
        }
      >
        <ul className="m-0 list-disc pl-[18px] text-dense leading-relaxed text-ink">
          <li>Notes and outreach records stay, attributed to “{dialog?.kind === "remove" ? dialog.member.fullName : ""} · former member”.</li>
          <li>Their assigned next actions become Unassigned and appear on your Home as items to reassign.</li>
          <li>They can request to join again; you can block repeat requests.</li>
        </ul>
      </Dialog>

      <Dialog
        open={dialog?.kind === "archive" || dialog?.kind === "delete"}
        onClose={() => { setDialog(null); setConfirmText(""); }}
        title={dialog?.kind === "delete" ? `Delete ${team.name}?` : `Archive ${team.name}?`}
        description={dialog?.kind === "delete" ? "This removes the team and all of its shared work. It can't be undone." : `Nothing is deleted yet. The workspace becomes read-only for all ${members.length} member${members.length === 1 ? "" : "s"}.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setDialog(null); setConfirmText(""); }}>Cancel</Button>
            <Button variant={dialog?.kind === "delete" ? "destructive" : "primary"} onClick={confirmDialog} disabled={pending || confirmText.trim() !== team.name}>
              {dialog?.kind === "delete" ? "Delete team" : "Archive team"}
            </Button>
          </>
        }
      >
        {dialog?.kind === "archive" ? (
          <ul className="m-0 mb-2.5 list-disc pl-[18px] text-dense leading-relaxed text-ink">
            <li>Members are emailed and see an archived banner; saving, tagging and outreach are disabled.</li>
            <li>Any Owner can restore the team within 90 days.</li>
            <li>After 90 days the team and its shared work are deleted.</li>
          </ul>
        ) : null}
        <Field label="Type the team name to confirm" labelSize={12}>
          {({ id }) => <Input id={id} placeholder={team.name} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />}
        </Field>
      </Dialog>

      <Dialog
        open={dialog?.kind === "deny"}
        onClose={() => { setDialog(null); setDenyNote(""); }}
        title={dialog?.kind === "deny" ? `Deny ${dialog.request.fullName}'s request?` : ""}
        description="They'll be emailed. They can request again after 14 days."
        footer={
          <>
            <Button variant="secondary" onClick={() => { setDialog(null); setDenyNote(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDialog} disabled={pending}>Deny request</Button>
          </>
        }
      >
        <Field label="Note" hint="(optional, included in the email)" labelSize={12}>
          {({ id }) => <Textarea id={id} value={denyNote} onChange={(e) => setDenyNote(e.target.value)} />}
        </Field>
      </Dialog>
    </>
  );
}

function RequestsTab({ team, requests, canEdit, onDeny }: Props & { canEdit: boolean; onDeny: (r: AccessRequestRow) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [roles, setRoles] = useState<Record<string, "member" | "admin">>({});

  const approve = (r: AccessRequestRow) =>
    startTransition(async () => {
      const role = roles[r.id] ?? "member";
      const result = await approveAccessRequestAction({ requestId: r.id, role });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      toast({
        message: `Approved ${r.fullName} as ${roleArticle(role)} · they've been emailed`,
        action: { label: "Undo", onClick: () => startTransition(async () => { await undoApproveAccessRequestAction({ requestId: r.id }); router.refresh(); }) },
      });
      router.refresh();
    });

  return (
    <Section>
      {requests.map((r) => (
        <div key={r.id} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3.5 border-t border-line-row px-5 py-4 first:border-t-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-tint text-meta font-semibold text-teal">{initialsOf(r.fullName)}</span>
          <div className="min-w-0">
            <p className="m-0 text-body font-medium text-ink">
              {r.fullName} <span className="font-normal text-ink-muted">· {r.email}</span>
            </p>
            <p className="mb-0 mt-0.5 text-dense text-ink-body">
              {r.title ? `${r.title} · ` : ""}
              {r.source === "link" ? "via invite link · " : ""}requested {fmtShort(r.requestedAt)}
            </p>
            {r.note ? <blockquote className="mb-0 mt-2 border-l-2 border-line-control bg-canvas px-3 py-2 text-dense leading-normal text-ink-on-tint">“{r.note}”</blockquote> : null}
          </div>
          {canEdit ? (
            <div className="flex items-center gap-1.5">
              <Select aria-label="Approve as" size={32} value={roles[r.id] ?? "member"} onChange={(e) => setRoles((s) => ({ ...s, [r.id]: e.target.value as "member" | "admin" }))}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
              <Button variant="primary" size={32} onClick={() => approve(r)} disabled={pending}>Approve</Button>
              <Button variant="secondary" size={32} onClick={() => onDeny(r)} disabled={pending}>Deny…</Button>
            </div>
          ) : null}
        </div>
      ))}
      {requests.length === 0 ? (
        <div className="p-8 text-center">
          <p className="m-0 text-body font-medium text-ink">No pending requests</p>
          <p className="mb-0 mt-1 text-dense text-ink-muted">People who find the team and ask to join appear here. Requests expire after 30 days.</p>
        </div>
      ) : null}
      <div className="border-t border-line-row px-5 py-3 text-meta leading-normal text-ink-muted">
        Approving adds the person immediately and emails them. Denying can include a short note; the person can request again after 14 days.
        {team.discoverability === "invite_only" ? " This team is invite-only, so requests only come from the invite link." : ""}
      </div>
    </Section>
  );
}

function InvitesTab({ team, invitations, inviteLink, canEdit }: Props & { canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const link = inviteLink ? inviteLinkUrl(team.slug, inviteLink.token) : null;

  const resend = (i: InvitationRow) =>
    startTransition(async () => {
      const result = await resendInvitationAction({ invitationId: i.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      toast({ message: result.warning ?? `Invitation re-sent to ${i.email}` });
      router.refresh();
    });
  const revoke = (i: InvitationRow) =>
    startTransition(async () => {
      const result = await revokeInvitationAction({ invitationId: i.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      toast({
        message: `Revoked invitation to ${i.email}`,
        action: { label: "Undo", onClick: () => startTransition(async () => { const r = await restoreInvitationAction({ invitationId: i.id }); if (!r.ok) toast({ tone: "error", message: r.error }); router.refresh(); }) },
      });
      router.refresh();
    });
  const resetLink = () =>
    startTransition(async () => {
      const result = await resetInviteLinkAction({ teamId: team.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      toast({ message: "Invite link reset · the old link no longer works" });
      router.refresh();
    });

  return (
    <Section>
      <div className="grid grid-cols-[minmax(0,1.6fr)_120px_150px_auto] gap-4 border-b border-line px-5 py-2.5 text-label font-semibold uppercase text-ink-muted">
        <span>Email</span><span>Role</span><span>Sent</span><span />
      </div>
      {invitations.map((i) => {
        const warn = i.bounced || isPast(i.expiresAt);
        return (
          <div key={i.id} className="grid grid-cols-[minmax(0,1.6fr)_120px_150px_auto] items-center gap-4 border-t border-line-row px-5 py-3 text-dense">
            <div className="min-w-0">
              <p className="m-0 truncate text-body font-medium text-ink">{i.email}</p>
              <p className="m-0 text-meta text-ink-muted">
                Invited by {i.invitedByName ?? "a team owner"}
                {i.bounced ? " · bounced" : ""}
              </p>
            </div>
            <span>{ROLE_LABEL[i.role]}</span>
            <span className={cn("whitespace-nowrap", warn ? "text-danger" : "text-ink-body")}>
              {i.lastSentAt ? fmtShort(i.lastSentAt) : fmtShort(i.createdAt)} · {expiresLabel(i.expiresAt)}
            </span>
            {canEdit ? (
              <div className="flex justify-end gap-1.5">
                <Button variant="secondary" size={32} onClick={() => resend(i)} disabled={pending}>Resend</Button>
                <Button variant="secondary" size={32} onClick={() => revoke(i)} disabled={pending}>Revoke</Button>
              </div>
            ) : <span />}
          </div>
        );
      })}
      {invitations.length === 0 ? (
        <div className="p-8 text-center">
          <p className="m-0 text-body font-medium text-ink">No open invitations</p>
          <p className="mb-0 mt-1 text-dense text-ink-muted">Invite by email above, or share the team&apos;s invite link.</p>
        </div>
      ) : null}
      {link ? (
        <div className="flex items-center justify-between gap-3 border-t border-line-row px-5 py-3 text-meta leading-normal text-ink-muted">
          <span>
            Invite link: <span className="font-mono text-ink">{link}</span> · people at {team.domain} who open it become a <span className="font-medium text-ink">pending request</span> you approve · {expiresLabel(inviteLink!.expiresAt)} · rotates when reset
          </span>
          {canEdit ? (
            <div className="flex gap-2.5">
              <button type="button" className="font-medium text-teal hover:text-navy" onClick={() => navigator.clipboard.writeText(link).then(() => toast({ message: "Invite link copied" }))}>Copy</button>
              <button type="button" className="font-medium text-teal hover:text-navy" onClick={resetLink} disabled={pending}>Reset link</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Outreach
// ---------------------------------------------------------------------------

function OutreachTab({ team, canEdit, members, viewerId }: Props & { canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [identity, setIdentity] = useState(team.sendingIdentity);
  const [sendingAddress, setSendingAddress] = useState(team.sendingAddress ?? "");
  const [replyTo, setReplyTo] = useState(team.replyToEmail ?? "");
  const [limit, setLimit] = useState(team.perInvestigatorLimit);
  const [signature, setSignature] = useState(team.signature ?? "{sender name}\n{sender title} · Office of Collaborative Research, UCSF\nReplies to this message reach the team.");
  const [error, setError] = useState<string | null>(null);
  const me = members.find((m) => m.userId === viewerId)?.fullName ?? "Your name";

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await updateTeamOutreachAction({ teamId: team.id, sendingIdentity: identity, sendingAddress, replyToEmail: replyTo, perInvestigatorLimit: limit, signature });
      if (!result.ok) return setError(result.error);
      toast({ message: "Outreach settings saved" });
      router.refresh();
    });

  return (
    <>
      <Section title="Sending identity">
        <div className="flex max-w-[680px] flex-col gap-3.5 p-5">
          <div className="flex flex-col gap-2">
            <RadioCard name="sender" checked={identity === "strategist_via_prospera"} disabled={!canEdit} onChange={() => setIdentity("strategist_via_prospera")} title="Strategist’s name via Prospera" description={`“${me} via Prospera” <outreach@prospera.ucsf.edu>. Recipients see who wrote it; delivery stays on the verified domain.`} />
            <RadioCard name="sender" checked={identity === "team_address"} disabled={!canEdit} onChange={() => setIdentity("team_address")} title="Team address" description={`“${team.name}” <${sendingAddress || "team@ucsf.edu"}>. Impersonal, but survives staff turnover completely.`} />
          </div>
          {identity === "team_address" ? (
            <Field label="Team address" labelSize={13}>
              {({ id }) => <Input id={id} type="email" value={sendingAddress} onChange={(e) => setSendingAddress(e.target.value)} disabled={!canEdit} placeholder="research.dev@ucsf.edu" />}
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Reply-to inbox" help="Replies are matched to the opportunity and recorded in Notes & activity, then forwarded to the sender.">
              {({ id }) => <Input id={id} type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} disabled={!canEdit} placeholder="ocr-outreach@ucsf.edu" />}
            </Field>
            <Field label="Per-investigator limit" help="Compose warns at the limit; owners can override per message.">
              {({ id }) => (
                <div className="flex items-center gap-2">
                  <Input id={id} type="number" min={0} max={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} disabled={!canEdit} className="w-16 text-center" />
                  <span className="text-dense text-ink-body">messages per quarter, across the team</span>
                </div>
              )}
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-tile border border-line bg-canvas px-3.5 py-3 text-dense">
            <span><span className="font-medium">Domain status:</span> not verified yet · the sending domain is checked when email delivery is connected (Data sources)</span>
            <Link href="/team/data-sources" className="whitespace-nowrap font-medium text-teal hover:text-navy">Data sources →</Link>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-tile border border-line px-3.5 py-3 text-dense">
            <span><span className="font-medium">Do-not-contact list:</span> only owners and admins can add or remove</span>
            <Link href="/investigators" className="whitespace-nowrap font-medium text-teal hover:text-navy">Manage →</Link>
          </div>
        </div>
      </Section>
      <Section title="Signature">
        <div className="max-w-[680px] p-5">
          <Textarea value={signature} onChange={(e) => setSignature(e.target.value)} disabled={!canEdit} className="min-h-[88px]" />
          <p className="mb-0 mt-1.5 text-meta text-ink-muted">Appended to every outreach message. {"{sender name}"} and {"{sender title}"} fill from the sender’s profile.</p>
          {error ? <p role="alert" className="mb-0 mt-2 text-dense text-danger">{error}</p> : null}
          {canEdit ? (
            <div className="mt-4 flex justify-end">
              <Button variant="primary" size={32} onClick={save} disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
            </div>
          ) : null}
        </div>
      </Section>
    </>
  );
}
