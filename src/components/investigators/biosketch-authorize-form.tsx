"use client";

import { useState, useTransition } from "react";
import { declineBiosketchAction, submitBiosketchAction, withdrawBiosketchAction } from "@/app/actions/biosketch-public-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { BiosketchRequest } from "@/lib/investigators/biosketch-request";
import { fmtMonYear } from "@/lib/investigators/sources";

/**
 * The page an investigator lands on from the biosketch request email. One
 * decision, three outcomes: share (upload + authorize), decline, or — if a
 * document is already on file — withdraw the authorization.
 */
export function BiosketchAuthorizeForm({ token, request }: { token: string; request: BiosketchRequest }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"shared" | "declined" | "withdrawn" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorize, setAuthorize] = useState(false);
  const who = request.strategistName ? `${request.strategistName} (${request.teamName})` : request.teamName;

  const card = "w-full max-w-[560px] rounded-card border border-line bg-card px-6 py-7 sm:px-8";

  if (done === "shared") {
    return (
      <section className={card}>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-ink">Thank you, {request.investigatorName.split(" ")[0]}</h1>
        <p className="mb-0 mt-2 text-body leading-normal text-ink-body">Your biosketch is on file with {request.teamName}. It&apos;s used only to match you with funding notices and to draft outreach to you.</p>
        <p className="mb-0 mt-3 text-dense text-ink-muted">To withdraw the authorization later, open the link from your email again.</p>
      </section>
    );
  }
  if (done === "declined") {
    return (
      <section className={card}>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-ink">Noted — no biosketch</h1>
        <p className="mb-0 mt-2 text-body leading-normal text-ink-body">{request.teamName} won&apos;t ask again. Missing biosketches never lower how well you match a notice.</p>
      </section>
    );
  }
  if (done === "withdrawn") {
    return (
      <section className={card}>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-ink">Authorization withdrawn</h1>
        <p className="mb-0 mt-2 text-body leading-normal text-ink-body">The document is no longer used for matching. {request.teamName} can ask again only by contacting you directly.</p>
      </section>
    );
  }

  if (request.state === "on_file") {
    return (
      <section className={card}>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-ink">Your biosketch is on file</h1>
        <p className="mb-0 mt-2 text-body leading-normal text-ink-body">
          {request.teamName} holds a biosketch{request.documentDate ? ` dated ${fmtMonYear(request.documentDate)}` : ""}. Upload a newer one below, or withdraw the authorization.
        </p>
        <ShareForm token={token} request={request} pending={pending} error={error} authorize={authorize} setAuthorize={setAuthorize} onSubmit={(fd) => startTransition(async () => { setError(null); const r = await submitBiosketchAction(fd); if (!r.ok) return setError(r.error); setDone("shared"); })} label="Replace with this document" />
        <div className="mt-4 border-t border-line-row pt-4">
          <Button variant="destructive-outline" size={32} disabled={pending} onClick={() => startTransition(async () => { setError(null); const r = await withdrawBiosketchAction(token); if (!r.ok) return setError(r.error); setDone("withdrawn"); })}>
            Withdraw authorization
          </Button>
        </div>
      </section>
    );
  }

  if (request.state === "declined") {
    return (
      <section className={card}>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-ink">You declined earlier</h1>
        <p className="mb-0 mt-2 text-body leading-normal text-ink-body">Changed your mind? You can share a biosketch now; otherwise there&apos;s nothing to do.</p>
        <ShareForm token={token} request={request} pending={pending} error={error} authorize={authorize} setAuthorize={setAuthorize} onSubmit={(fd) => startTransition(async () => { setError(null); const r = await submitBiosketchAction(fd); if (!r.ok) return setError(r.error); setDone("shared"); })} label="Share my biosketch" />
      </section>
    );
  }

  return (
    <section className={card}>
      <p className="m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Biosketch request</p>
      <h1 className="mb-0 mt-1.5 text-[22px] font-semibold tracking-[-0.01em] text-ink">{who} is asking for your NIH biosketch</h1>
      <p className="mb-0 mt-2 text-body leading-normal text-ink-body">
        Dear {request.investigatorName}, a biosketch is the best description of your expertise in your own words. It&apos;s used only to match you with funding notices and to draft outreach to you, never shared outside the team, and you can withdraw it at any time from this page.
      </p>
      <ShareForm token={token} request={request} pending={pending} error={error} authorize={authorize} setAuthorize={setAuthorize} onSubmit={(fd) => startTransition(async () => { setError(null); const r = await submitBiosketchAction(fd); if (!r.ok) return setError(r.error); setDone("shared"); })} label="Share my biosketch" />
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-row pt-4">
        <p className="m-0 text-dense text-ink-muted">Prefer not to? Nobody will ask again.</p>
        <Button variant="secondary" size={32} disabled={pending} onClick={() => startTransition(async () => { setError(null); const r = await declineBiosketchAction(token); if (!r.ok) return setError(r.error); setDone("declined"); })}>
          Decline
        </Button>
      </div>
    </section>
  );
}

function ShareForm({ token, request, pending, error, authorize, setAuthorize, onSubmit, label }: { token: string; request: BiosketchRequest; pending: boolean; error: string | null; authorize: boolean; setAuthorize: (v: boolean) => void; onSubmit: (fd: FormData) => void; label: string }) {
  return (
    <form
      className="mt-5 flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
    >
      <input type="hidden" name="token" value={token} />
      <Field label="Biosketch (PDF, up to 10 MB)" labelSize={12}>
        {({ id }) => <input id={id} name="file" type="file" accept="application/pdf,.pdf" required className="block w-full text-dense text-ink file:mr-3 file:h-8 file:rounded-control file:border file:border-line-control file:bg-card file:px-3 file:text-dense file:font-medium file:text-ink" />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Document written in" labelSize={12}>{({ id }) => <Input id={id} name="documentDate" type="month" required />}</Field>
        <Field label="Written for (optional)" labelSize={12} help="e.g. an R01 renewal">{({ id }) => <Input id={id} name="writtenFor" placeholder="an R01 renewal" />}</Field>
      </div>
      <label className="flex items-start gap-2.5 rounded-tile bg-canvas px-3.5 py-3 text-dense leading-normal text-ink-body">
        <Checkbox name="authorize" checked={authorize} onChange={(e) => setAuthorize(e.target.checked)} className="mt-0.5" />
        <span>I authorize {request.teamName} to use this biosketch to match me with funding notices and to draft outreach to me. I can withdraw this at any time.</span>
      </label>
      {error ? <p className="m-0 text-meta text-danger" role="alert">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending || !authorize}>{pending ? "Uploading…" : label}</Button>
      </div>
    </form>
  );
}
