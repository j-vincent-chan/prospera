"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveInvestigatorAction, type InvestigatorFormInput } from "@/app/actions/investigator-actions";
import { SelfDeclaredFields } from "@/components/investigators/self-declared-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SlideOver } from "@/components/ui/slide-over";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { EMPTY_SELF_DECLARED_FORM, selfDeclaredFormToInput, type SelfDeclaredFormValue } from "@/lib/fit/self-declared";
import type { CommunityOption } from "@/lib/investigators/directory";
import { ORCID_PROBLEM, parseOrcid } from "@/lib/investigators/orcid";

/**
 * "Add investigator" sheet from Investigator Import v2 (480px). The same form
 * edits an existing person from their profile page. PR 0.7 adds the
 * self-declared axes ("How you do research", materials, directions,
 * do-not-suggest), title series, degrees, and a validated ORCID iD.
 */

export type InvestigatorFormValues = {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  home_department: string;
  division: string;
  research_community_id: string;
  research_focus: string;
  orcid: string;
  nih_profile_id: string;
  profiles_url_name: string;
  title_series: string;
  /** "MD, PhD" as typed. */
  degrees: string;
  research: SelfDeclaredFormValue;
};

export const EMPTY_FORM: InvestigatorFormValues = {
  first_name: "",
  last_name: "",
  email: "",
  home_department: "",
  division: "",
  research_community_id: "",
  research_focus: "",
  orcid: "",
  nih_profile_id: "",
  profiles_url_name: "",
  title_series: "",
  degrees: "",
  research: EMPTY_SELF_DECLARED_FORM,
};

export function InvestigatorFormSheet({
  open,
  onClose,
  communities,
  initial,
  defaultCommunityId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  communities: CommunityOption[];
  initial?: InvestigatorFormValues | null;
  defaultCommunityId?: string | null;
  /** Called after a successful save; default navigates to the profile. */
  onSaved?: (result: { id: string; fullName: string; created: boolean }) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(initial?.id);
  const [v, setV] = useState<InvestigatorFormValues>(initial ?? { ...EMPTY_FORM, research_community_id: defaultCommunityId ?? "" });
  const [fetchAfter, setFetchAfter] = useState(true);
  const [showIds, setShowIds] = useState(Boolean(initial?.nih_profile_id || initial?.profiles_url_name));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setV(initial ?? { ...EMPTY_FORM, research_community_id: defaultCommunityId ?? "" });
      setShowIds(Boolean(initial?.nih_profile_id || initial?.profiles_url_name));
      setError(null);
    }
  }, [open, initial, defaultCommunityId]);

  const set = (k: keyof InvestigatorFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  // Validated as typed so a mistyped digit is caught before the save.
  const orcidCheck = v.orcid.trim() ? parseOrcid(v.orcid) : null;
  const orcidError = orcidCheck && !orcidCheck.ok ? ORCID_PROBLEM[orcidCheck.reason] : undefined;

  const submit = () =>
    startTransition(async () => {
      setError(null);
      if (orcidError) return setError(orcidError);
      const input: InvestigatorFormInput & { id?: string } = {
        id: v.id,
        first_name: v.first_name,
        last_name: v.last_name,
        email: v.email,
        home_department: v.home_department,
        division: v.division,
        research_community_id: v.research_community_id || null,
        research_focus: v.research_focus,
        orcid: v.orcid,
        nih_profile_id: v.nih_profile_id,
        profiles_url_name: v.profiles_url_name,
        title_series: v.title_series,
        degrees: v.degrees,
        research: selfDeclaredFormToInput(v.research),
      };
      const r = await saveInvestigatorAction(input, { fetchAfter: !editing && fetchAfter });
      if (!r.ok) return setError(r.error);
      toast({ message: r.created ? `Added ${r.fullName}.${r.refreshSummary ? ` ${r.refreshSummary}` : ""}` : `Saved ${r.fullName}.` });
      if (onSaved) onSaved({ id: r.id, fullName: r.fullName, created: r.created });
      else router.push(`/investigators/${r.id}`);
    });

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      label={editing ? "Edit investigator" : "Add investigator"}
      width={480}
      header={<h2 className="m-0 text-[18px] font-semibold tracking-[-0.01em] text-ink">{editing ? "Edit investigator" : "Add investigator"}</h2>}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={pending || !v.first_name.trim() || !v.last_name.trim() || Boolean(orcidError)}>
            {pending ? (editing ? "Saving…" : fetchAfter ? "Adding and fetching…" : "Adding…") : editing ? "Save changes" : "Add investigator"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5 px-6 py-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" labelSize={12}>{({ id }) => <Input id={id} value={v.first_name} onChange={set("first_name")} autoFocus={!editing} />}</Field>
          <Field label="Last name" labelSize={12}>{({ id }) => <Input id={id} value={v.last_name} onChange={set("last_name")} />}</Field>
        </div>
        <Field label="UCSF email" labelSize={12} help="Needed for outreach and reply tracking.">
          {({ id }) => <Input id={id} type="email" value={v.email} onChange={set("email")} placeholder="name@ucsf.edu" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department" labelSize={12}>{({ id }) => <Input id={id} value={v.home_department} onChange={set("home_department")} />}</Field>
          <Field label="Community" labelSize={12}>
            {({ id }) => (
              <Select id={id} value={v.research_community_id} onChange={set("research_community_id")} className="w-full">
                {communities.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
                <option value="">None</option>
              </Select>
            )}
          </Field>
        </div>
        {editing ? <Field label="Division" labelSize={12}>{({ id }) => <Input id={id} value={v.division} onChange={set("division")} />}</Field> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title series" labelSize={12} hint="— UCSF series">
            {({ id }) => <Input id={id} value={v.title_series} onChange={set("title_series")} placeholder="In Residence, Ladder Rank, Clinical X…" />}
          </Field>
          <Field label="Degrees" labelSize={12}>{({ id }) => <Input id={id} value={v.degrees} onChange={set("degrees")} placeholder="MD, PhD" />}</Field>
        </div>
        <Field label="Research focus" labelSize={12} hint="— a sentence or keywords; fit tiers start from this">
          {({ id }) => <Textarea id={id} value={v.research_focus} onChange={set("research_focus")} className="min-h-[80px]" />}
        </Field>
        <div className="border-t border-line-row pt-3">
          <SelfDeclaredFields value={v.research} onChange={(research) => setV((s) => ({ ...s, research }))} showDoNotSuggest labelSize={12} />
        </div>
        <div className="border-t border-line-row pt-3">
          <Field label="ORCID iD" labelSize={12} error={orcidError} help="0000-0000-0000-0000 or the orcid.org link. Anchors publications across affiliations, pre-UCSF papers included.">
            {({ id, invalid }) => <Input id={id} invalid={invalid} value={v.orcid} onChange={set("orcid")} placeholder="0000-0000-0000-0000" className="font-mono text-dense" />}
          </Field>
        </div>
        <div className="border-t border-line-row pt-3">
          <button type="button" onClick={() => setShowIds((s) => !s)} aria-expanded={showIds} className="m-0 text-dense font-medium text-teal hover:text-navy">
            Other identifiers (optional) — NIH RePORTER profile ID, UCSF Profiles
          </button>
          {showIds ? (
            <div className="mt-2.5 grid grid-cols-2 gap-3">
              <Input value={v.nih_profile_id} onChange={set("nih_profile_id")} placeholder="RePORTER profile ID" aria-label="RePORTER profile ID" inputMode="numeric" className="font-mono text-dense" />
              <Input value={v.profiles_url_name} onChange={set("profiles_url_name")} placeholder="profiles.ucsf.edu link (optional)" aria-label="UCSF Profiles link" className="text-dense" />
            </div>
          ) : null}
        </div>
        {!editing ? (
          <label className="flex items-center gap-2 text-dense text-ink-body">
            <Checkbox checked={fetchAfter} onChange={(e) => setFetchAfter(e.target.checked)} />
            Fetch PubMed and RePORTER after saving
          </label>
        ) : null}
        {error ? <p className="m-0 text-meta text-danger" role="alert">{error}</p> : null}
      </div>
    </SlideOver>
  );
}
