"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  acceptInvitationAction,
  cancelAccessRequestAction,
  createTeamAction,
  declineInvitationAction,
  findSimilarTeamsAction,
  requestToJoinAction,
  sendInvitationsAction,
} from "@/app/actions/team-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { RadioCard } from "@/components/ui/radio-card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { inviteLinkUrl } from "@/lib/team/urls";
import { fmtShort } from "@/lib/team/format";
import { ROLE_LABEL, slugify, teamInitials, type AccessRequestRow, type DiscoverableTeam, type InvitationRow, type TeamRole } from "@/lib/team/types";
import { cn } from "@/lib/utils/cn";

export type OnboardingStep = "chooser" | "create" | "invite" | "waiting" | "invited";

type LandedTeam = { id: string; name: string; slug: string; role: TeamRole; inviteToken: string | null };

const TILE_TONES = [
  "bg-navy text-white",
  "bg-teal-tint text-teal",
  "bg-navy-tint text-navy",
  "bg-success-tint text-success",
];

function TeamTile({ name, index, size = 32 }: { name: string; index: number; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn("flex shrink-0 items-center justify-center rounded-tile text-micro font-semibold", TILE_TONES[index % TILE_TONES.length])}
    >
      {teamInitials(name)}
    </span>
  );
}

export function OnboardingClient({
  viewer,
  initialStep,
  discoverable,
  requests,
  invitations,
  hasTeam,
  landedTeam,
  catalogCount,
}: {
  viewer: { firstName: string; email: string | null; domain: string };
  initialStep: OnboardingStep;
  discoverable: DiscoverableTeam[];
  requests: AccessRequestRow[];
  invitations: InvitationRow[];
  hasTeam: boolean;
  landedTeam: LandedTeam | null;
  catalogCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [created, setCreated] = useState<LandedTeam | null>(landedTeam && landedTeam.role === "owner" ? landedTeam : null);
  const [landed, setLanded] = useState<LandedTeam | null>(landedTeam);
  const [viaInvite, setViaInvite] = useState(Boolean(landedTeam && landedTeam.role !== "owner"));
  const [query, setQuery] = useState("");
  const [requestedTeamIds, setRequestedTeamIds] = useState<Set<string>>(new Set(requests.map((r) => r.teamId)));

  useEffect(() => {
    setRequestedTeamIds(new Set(requests.map((r) => r.teamId)));
  }, [requests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return discoverable;
    return discoverable.filter((t) => `${t.name} ${t.description ?? ""}`.toLowerCase().includes(q));
  }, [discoverable, query]);

  const request = (team: DiscoverableTeam) =>
    startTransition(async () => {
      const result = await requestToJoinAction({ teamId: team.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      setRequestedTeamIds((s) => new Set(s).add(team.id));
      toast({ message: `Request sent to ${team.name} · the owner has been notified` });
      router.refresh();
    });

  const cancel = (teamId: string, teamName: string) => {
    const req = requests.find((r) => r.teamId === teamId && r.status === "pending");
    if (!req) return;
    startTransition(async () => {
      const result = await cancelAccessRequestAction({ requestId: req.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      setRequestedTeamIds((s) => {
        const next = new Set(s);
        next.delete(teamId);
        return next;
      });
      toast({ message: `Request to ${teamName} cancelled` });
      router.refresh();
    });
  };

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const hasPending = pendingRequests.length > 0 || invitations.length > 0;

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-5">
      {step === "chooser" ? (
        <>
          <div>
            <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">Welcome, {viewer.firstName}</h1>
            <p className="mb-0 mt-2 text-body leading-relaxed text-ink-body">
              Prospera work lives in team workspaces. Join the team you work with, or start a new one. Someone who invited you? Open the link in their email and you&apos;ll land straight in the workspace.
            </p>
          </div>

          <section className="rounded-card border border-line bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 className="m-0 text-section font-semibold uppercase text-ink">Teams at {viewer.domain} you can request to join</h2>
              <span className="text-meta text-ink-muted">Only teams that chose to be discoverable</span>
            </div>
            <div className="border-b border-line-row px-5 py-3">
              <Input
                aria-label="Search teams"
                placeholder="Search teams by name or department…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {filtered.length === 0 ? (
              <div className="px-5 py-6 text-center text-dense text-ink-muted">
                {discoverable.length === 0 ? "No discoverable teams yet." : "No teams match that search."}
              </div>
            ) : null}
            {filtered.map((t, i) => {
              const requested = requestedTeamIds.has(t.id);
              return (
                <div key={t.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-5 py-3.5">
                  <TeamTile name={t.name} index={i} />
                  <div className="min-w-0">
                    <p className="m-0 text-body font-medium text-ink">{t.name}</p>
                    <p className="mb-0 mt-0.5 text-meta text-ink-muted">
                      {t.memberCount} member{t.memberCount === 1 ? "" : "s"}
                      {t.ownerName ? ` · owner ${t.ownerName}` : ""}
                      {t.description ? ` · ${t.description}` : ""}
                    </p>
                  </div>
                  {requested ? (
                    <span className="inline-flex items-center gap-2 whitespace-nowrap text-meta text-ink-muted">
                      Requested · waiting
                      <button type="button" onClick={() => cancel(t.id, t.name)} disabled={pending} className="text-meta font-medium text-teal hover:text-navy">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <Button variant="primary" size={32} onClick={() => request(t)} disabled={pending}>
                      Request to join
                    </Button>
                  )}
                </div>
              );
            })}
            <div className="border-t border-line-row px-5 py-3 text-meta leading-normal text-ink-muted">
              Don&apos;t see your team? It may be invite-only. Ask a team owner to invite you by email, or create a new team below.
            </div>
          </section>

          <section className="flex items-center justify-between gap-4 rounded-card border border-line bg-card px-5 py-4">
            <div>
              <p className="m-0 text-body font-medium text-ink">Start a new team</p>
              <p className="mb-0 mt-0.5 text-dense leading-normal text-ink-muted">
                You become the owner, invite colleagues, and set up monitored communities and investigators.
              </p>
            </div>
            <Button variant="secondary" onClick={() => setStep("create")}>Create a team</Button>
          </section>

          {hasPending ? (
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setStep("waiting")}>Continue</Button>
            </div>
          ) : hasTeam ? (
            <div className="flex justify-end">
              <Link href="/home">
                <Button variant="secondary">Back to Home</Button>
              </Link>
            </div>
          ) : null}
        </>
      ) : null}

      {step === "create" ? (
        <CreateStep
          domain={viewer.domain}
          onBack={() => setStep("chooser")}
          onCreated={(team) => {
            setCreated(team);
            setLanded(team);
            setViaInvite(false);
            setStep("invite");
          }}
        />
      ) : null}

      {step === "invite" && created ? (
        <InviteStep
          team={created}
          onBack={() => setStep("create")}
          onDone={() => {
            setStep("invited");
            router.refresh();
          }}
        />
      ) : null}

      {step === "waiting" ? (
        <WaitingStep
          requests={pendingRequests}
          invitations={invitations}
          catalogCount={catalogCount}
          onChooser={() => setStep("chooser")}
          onAccepted={(team) => {
            setLanded(team);
            setViaInvite(true);
            setStep("invited");
          }}
        />
      ) : null}

      {step === "invited" && landed ? <LandedStep team={landed} viaInvite={viaInvite && !created} /> : null}
    </div>
  );
}

function CreateStep({
  domain,
  onBack,
  onCreated,
}: {
  domain: string;
  onBack: () => void;
  onCreated: (team: LandedTeam) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discoverability, setDiscoverability] = useState<"invite_only" | "domain">("invite_only");
  const [similar, setSimilar] = useState<Array<{ id: string; name: string; memberCount: number; discoverable: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 4) {
      setSimilar([]);
      return;
    }
    const handle = setTimeout(async () => {
      const result = await findSimilarTeamsAction({ name: trimmed });
      if (result.ok) setSimilar(result.teams);
    }, 350);
    return () => clearTimeout(handle);
  }, [name]);

  const slug = slugify(name) || "your-team";

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createTeamAction({ name, description, discoverability });
      if (!result.ok) return setError(result.error);
      onCreated({ id: result.teamId, name: name.trim(), slug: result.slug, role: "owner", inviteToken: result.inviteToken });
    });

  return (
    <>
      <button type="button" onClick={onBack} className="self-start text-dense text-ink-muted hover:text-ink">← Back</button>
      <div>
        <p className="mb-1.5 mt-0 text-label font-semibold uppercase text-ink-muted">Step 1 of 3 · Team details</p>
        <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">Create a team</h1>
      </div>
      <section className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
        <Field label="Team name" error={error ?? undefined} help={<>Workspace address: <span className="font-mono text-ink">prospera.ucsf.edu/t/{slug}</span></>}>
          {({ id, invalid }) => (
            <Input id={id} invalid={invalid} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pediatrics Research Development" className="h-[38px]" />
          )}
        </Field>
        {similar.length > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-tile border border-warning-border bg-warning-tint px-3 py-2.5 text-dense leading-normal text-warning-dark">
            <span>
              A similar team already exists at {domain}: <span className="font-medium">{similar[0].name}</span> ({similar[0].memberCount} member{similar[0].memberCount === 1 ? "" : "s"}). Duplicate teams split the same work.
            </span>
            {similar[0].discoverable ? (
              <button type="button" onClick={onBack} className="h-7 shrink-0 whitespace-nowrap rounded-control border border-warning-border bg-card px-2.5 text-dense font-medium text-warning-dark">
                Request to join instead
              </button>
            ) : null}
          </div>
        ) : null}
        <Field label="Description" hint="(shown to people who find the team)">
          {({ id }) => (
            <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Research development for the Department of Pediatrics: funding scans, PI matching and outreach." />
          )}
        </Field>
        <div>
          <p className="mb-2 mt-0 text-dense font-medium text-ink">Who can find this team</p>
          <div className="flex flex-col gap-2">
            <RadioCard
              name="disc"
              checked={discoverability === "invite_only"}
              onChange={() => setDiscoverability("invite_only")}
              title="Invite only"
              suffix="· recommended"
              description="Hidden from search. People join through your invitations."
            />
            <RadioCard
              name="disc"
              checked={discoverability === "domain"}
              onChange={() => setDiscoverability("domain")}
              title={`Anyone at ${domain} can find and request to join`}
              description={`You approve every request. Nobody outside ${domain} can see the team.`}
            />
          </div>
        </div>
      </section>
      <div className="flex items-center justify-between gap-4">
        <span className="text-meta text-ink-muted">Next: invite members, then import communities and investigators. Both can be skipped.</span>
        <Button variant="primary" onClick={submit} disabled={pending || name.trim().length < 3}>
          {pending ? "Creating…" : "Create team"}
        </Button>
      </div>
    </>
  );
}

function InviteStep({ team, onBack, onDone }: { team: LandedTeam; onBack: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [emailsText, setEmailsText] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const emails = useMemo(() => Array.from(new Set(emailsText.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))), [emailsText]);
  const link = team.inviteToken ? inviteLinkUrl(team.slug, team.inviteToken) : null;

  const send = () =>
    startTransition(async () => {
      const result = await sendInvitationsAction({ teamId: team.id, emails, role });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      const skipped = result.skipped.length ? ` · ${result.skipped.length} skipped` : "";
      toast({ message: `Sent ${result.sent} invitation${result.sent === 1 ? "" : "s"}${skipped}` });
      if (result.warnings[0]) toast({ tone: "error", message: result.warnings[0] });
      onDone();
    });

  return (
    <>
      <div>
        <p className="mb-1.5 mt-0 text-label font-semibold uppercase text-ink-muted">Step 2 of 3 · Invite members</p>
        <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">{team.name} is ready</h1>
        <p className="mb-0 mt-2 text-body leading-relaxed text-ink-body">
          You&apos;re the owner. Invited people sign in with UCSF MyAccess and land directly in the workspace; no approval step.
        </p>
      </div>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-card p-5">
        <Field label="Email addresses" help="Paste a list; commas, spaces or new lines all work. Invitations expire after 30 days.">
          {({ id }) => <Textarea id={id} value={emailsText} onChange={(e) => setEmailsText(e.target.value)} className="min-h-[72px]" placeholder="jordan.kim@ucsf.edu, alex.romero@ucsf.edu" />}
        </Field>
        <div className="flex items-center gap-3">
          <label htmlFor="invite-role" className="text-dense font-medium text-ink">Invite as</label>
          <Select id="invite-role" size={32} value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
            <option value="member">Member — triage, edit, send outreach</option>
            <option value="admin">Admin — also manage members and settings</option>
          </Select>
        </div>
        {link ? (
          <div className="rounded-tile border border-line bg-canvas px-3 py-2.5 text-dense leading-normal text-ink-body">
            Or share an invite link: <span className="font-mono text-meta text-ink">{link}</span> · people at ucsf.edu who open it become a pending request you approve · expires in 7 days ·{" "}
            <button
              type="button"
              className="font-medium text-teal hover:text-navy"
              onClick={() => navigator.clipboard.writeText(link).then(() => toast({ message: "Invite link copied" }))}
            >
              Copy
            </button>
          </div>
        ) : null}
      </section>
      <div className="flex items-center justify-between">
        <button type="button" onClick={onDone} className="text-dense font-medium text-ink-muted hover:text-ink">Skip for now</button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button variant="primary" onClick={send} disabled={pending || emails.length === 0}>
            {pending ? "Sending…" : `Send ${emails.length || ""} invitation${emails.length === 1 ? "" : "s"}`.replace("  ", " ")}
          </Button>
        </div>
      </div>
    </>
  );
}

function WaitingStep({
  requests,
  invitations,
  catalogCount,
  onChooser,
  onAccepted,
}: {
  requests: AccessRequestRow[];
  invitations: InvitationRow[];
  catalogCount: number;
  onChooser: () => void;
  onAccepted: (team: LandedTeam) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const cancel = (r: AccessRequestRow) =>
    startTransition(async () => {
      const result = await cancelAccessRequestAction({ requestId: r.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      setHidden((s) => new Set(s).add(r.id));
      toast({ message: `Request to ${r.teamName} cancelled` });
      router.refresh();
    });
  const accept = (i: InvitationRow) =>
    startTransition(async () => {
      const result = await acceptInvitationAction({ invitationId: i.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      onAccepted({ id: result.teamId, name: result.teamName, slug: "", role: i.role, inviteToken: null });
      router.refresh();
    });
  const decline = (i: InvitationRow) =>
    startTransition(async () => {
      const result = await declineInvitationAction({ invitationId: i.id });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      setHidden((s) => new Set(s).add(i.id));
      toast({ message: "Invitation declined" });
      router.refresh();
    });

  const rows = [
    ...requests.filter((r) => !hidden.has(r.id)).map((r) => ({ kind: "request" as const, r })),
    ...invitations.filter((i) => !hidden.has(i.id)).map((i) => ({ kind: "invite" as const, i })),
  ];

  return (
    <>
      <div>
        <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">Waiting for approval</h1>
        <p className="mb-0 mt-2 text-body leading-relaxed text-ink-body">
          A team owner has to approve your request before you can see the team&apos;s shared work. You&apos;ll get an email when they do. Meanwhile, the funding catalog is open to you.
        </p>
      </div>
      <section className="rounded-card border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="m-0 text-section font-semibold uppercase text-ink">Your requests and invitations</h2>
        </div>
        {rows.map((row, i) =>
          row.kind === "request" ? (
            <div key={row.r.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-5 py-3.5">
              <TeamTile name={row.r.teamName} index={i} />
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-2 text-body font-medium text-ink">
                  {row.r.teamName} <Pill variant="status-needs-review">Request pending</Pill>
                </p>
                <p className="mb-0 mt-0.5 text-meta text-ink-muted">Requested {fmtShort(row.r.requestedAt)} · waiting for a team owner</p>
              </div>
              <Button variant="secondary" size={32} onClick={() => cancel(row.r)} disabled={pending}>Cancel request</Button>
            </div>
          ) : (
            <div key={row.i.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-5 py-3.5">
              <TeamTile name={row.i.teamName} index={i} />
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-2 text-body font-medium text-ink">
                  {row.i.teamName} <Pill variant="tag-selected">Invitation</Pill>
                </p>
                <p className="mb-0 mt-0.5 text-meta text-ink-muted">
                  Invited by {row.i.invitedByName ?? "a team owner"} · {fmtShort(row.i.createdAt)} · as {ROLE_LABEL[row.i.role]} · expires {fmtShort(row.i.expiresAt)}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button variant="primary" size={32} onClick={() => accept(row.i)} disabled={pending}>Accept</Button>
                <Button variant="secondary" size={32} onClick={() => decline(row.i)} disabled={pending}>Decline</Button>
              </div>
            </div>
          ),
        )}
        {rows.length === 0 ? (
          <div className="p-5 text-center text-dense text-ink-muted">
            Nothing pending.{" "}
            <button type="button" onClick={onChooser} className="font-medium text-teal hover:text-navy">Find or create a team</button>
          </div>
        ) : null}
      </section>
      <section className="flex items-center justify-between gap-4 rounded-card border border-line bg-card px-5 py-4">
        <div>
          <p className="m-0 text-body font-medium text-ink">Browse the funding catalog</p>
          <p className="mb-0 mt-0.5 text-dense leading-normal text-ink-muted">
            {catalogCount.toLocaleString()} notices from Simpler.Grants.gov, read-only. Saving, tagging and outreach unlock when you join a team.
          </p>
        </div>
        <Link href="/opportunities">
          <Button variant="secondary">Open catalog</Button>
        </Link>
      </section>
      <div className="flex items-center justify-between text-dense text-ink-muted">
        <span>Requests expire after 30 days. One open request per team.</span>
        <button type="button" onClick={onChooser} className="font-medium text-teal hover:text-navy">Request another team or create one</button>
      </div>
    </>
  );
}

function LandedStep({ team, viaInvite }: { team: LandedTeam; viaInvite: boolean }) {
  const orientation = viaInvite
    ? [
        { n: "1", title: "Communities the team monitors", detail: "Suggestions and routing depend on the communities the team monitors.", cta: "See communities", href: "/communities" },
        { n: "2", title: "What's in play right now", detail: "Opportunities in outreach, next actions and PIs waiting for a follow-up.", cta: "Open Outreach", href: "/outreach" },
        { n: "3", title: "Your assignments", detail: "Nothing assigned to you yet. Owners and admins can assign items to you from any opportunity.", cta: "Go to Home", href: "/home" },
      ]
    : [
        { n: "1", title: "Add the communities you monitor", detail: "Each needs a mission, focus areas and keywords for suggestions to work.", cta: "Add communities", href: "/communities" },
        { n: "2", title: "Import your investigators", detail: "CSV import with column mapping; PubMed and RePORTER fill in the rest overnight.", cta: "Import", href: "/investigators" },
        { n: "3", title: "Save your first opportunities", detail: "Search the catalog, save a search, and Prospera starts suggesting recipients.", cta: "Open catalog", href: "/opportunities" },
      ];

  return (
    <>
      <div>
        <p className="mb-1.5 mt-0 text-label font-semibold uppercase text-ink-muted">{viaInvite ? "Invitation accepted" : "Step 3 of 3 · Set up the workspace"}</p>
        <h1 className="m-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">You&apos;re in {team.name}</h1>
        <p className="mb-0 mt-2 text-body leading-relaxed text-ink-body">
          {viaInvite
            ? `You joined as ${ROLE_LABEL[team.role] === "Owner" ? "an Owner" : ROLE_LABEL[team.role] === "Admin" ? "an Admin" : "a Member"}. Three things worth knowing before you start.`
            : "The workspace is empty until you add what the team monitors. Each step is optional and can be done later from Settings."}
        </p>
      </div>
      <section className="rounded-card border border-line bg-card">
        {orientation.map((o) => (
          <Link key={o.n} href={o.href} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-5 py-3.5 text-ink first:border-t-0 hover:bg-canvas">
            <span className="flex h-7 w-7 items-center justify-center rounded-control bg-teal-tint text-meta font-semibold text-teal">{o.n}</span>
            <div className="min-w-0">
              <p className="m-0 text-body font-medium text-ink">{o.title}</p>
              <p className="mb-0 mt-0.5 text-meta leading-normal text-ink-muted">{o.detail}</p>
            </div>
            <span className="whitespace-nowrap text-dense font-medium text-teal">{o.cta} →</span>
          </Link>
        ))}
      </section>
      <div className="flex justify-end">
        <Link href="/home">
          <Button variant="primary">Go to Home</Button>
        </Link>
      </div>
    </>
  );
}
