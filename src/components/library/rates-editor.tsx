"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveInstitutionRatesAction } from "@/app/actions/library-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function RatesEditor({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: { rows: Array<{ label: string; value: string }>; agreement: string | null; effective: string | null; sourceUrl: string | null } }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Array<{ label: string; value: string }>>(initial.rows.length ? initial.rows : [{ label: "F&A · on-campus research", value: "" }, { label: "F&A · off-campus", value: "" }, { label: "Fringe · academic", value: "" }]);
  const [agreement, setAgreement] = useState(initial.agreement ?? "");
  const [effective, setEffective] = useState(initial.effective ?? "");
  const [url, setUrl] = useState(initial.sourceUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      const res = await saveInstitutionRatesAction({ rows, agreementLabel: agreement, effectiveFrom: effective || null, sourceUrl: url || null });
      if (!res.ok) return setError(res.error);
      toast({ message: "Rate schedule updated · every item citing it shows the new figures" });
      onClose();
      router.refresh();
    });
  return (
    <Dialog open={open} onClose={onClose} title="OSR rate agreement" description="Stewards keep these from OSR's published rate agreement. They are never accepted as uploads." width={560} footer={<><Button variant="secondary" size={32} onClick={onClose}>Cancel</Button><Button variant="primary" size={32} onClick={save} disabled={pending}>Save schedule</Button></>}>
      <div className="flex flex-col gap-3 py-1">
        {error ? <div className="rounded-[8px] border border-danger-border bg-danger-tint px-3 py-2 text-dense text-danger-dark">{error}</div> : null}
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_32px] gap-2">
              <Input size={32} value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="F&A · on-campus research" aria-label="Rate label" />
              <Input size={32} value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="64.0%" aria-label="Rate value" />
              <Button variant="ghost" size={32} aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <div><Button variant="secondary" size={28} onClick={() => setRows([...rows, { label: "", value: "" }])}>Add a rate</Button></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Agreement" labelSize={12}>{({ id }) => <Input id={id} size={32} value={agreement} onChange={(e) => setAgreement(e.target.value)} placeholder="Rate agreement FY2027" />}</Field>
          <Field label="Effective" labelSize={12}>{({ id }) => <Input id={id} size={32} type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />}</Field>
          <Field label="Full schedule (OSR link)" labelSize={12} className="col-span-2">{({ id }) => <Input id={id} size={32} value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-[12px]" placeholder="https://osr.ucsf.edu/…" />}</Field>
        </div>
      </div>
    </Dialog>
  );
}
