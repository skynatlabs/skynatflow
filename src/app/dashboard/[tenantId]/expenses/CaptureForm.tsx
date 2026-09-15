"use client";

// Recording a cost, by whichever route it arrives.
//
// One form for the desk and the pump. On a phone the slip field opens the
// camera; on a desktop it opens a file picker. Once a picture is in, "Read
// the slip" fills in what the machine can see — supplier, amount, tax, date,
// slip number — and the person corrects rather than types. The tags (what
// vehicle, what trip, what job, business or personal) are asked here, at the
// moment of spend, because it is the only moment anybody knows.

import { useState, useTransition } from "react";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export interface CaptureOption {
  id: string;
  label: string;
}

export interface ReadFields {
  supplierName: string;
  amountRand: string;
  taxRand: string;
  spentOn: string;
  reference: string;
  odometerKm: string;
  descriptionText: string;
  notes: string | null;
  confidence: number;
  lineCount: number;
}

const INPUT = "kb-input mt-1 w-full text-sm";

export function CaptureForm({
  tenantId,
  action,
  readAction,
  vehicles,
  trips,
  jobs,
  currencySymbol,
  today,
}: {
  tenantId: string;
  action: (formData: FormData) => void;
  readAction: (dataUrl: string) => Promise<ReadFields | null>;
  vehicles: CaptureOption[];
  trips: CaptureOption[];
  jobs: CaptureOption[];
  currencySymbol: string;
  today: string;
}) {
  const [receiptDataUrl, setReceiptDataUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fields, setFields] = useState<Partial<ReadFields>>({});
  const [readNote, setReadNote] = useState<string | null>(null);
  const [reading, startReading] = useTransition();

  function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setReadNote(null);
    const reader = new FileReader();
    reader.onload = () => setReceiptDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  function readSlip() {
    if (!receiptDataUrl) return;
    startReading(async () => {
      const r = await readAction(receiptDataUrl);
      if (!r) {
        setReadNote("Could not read that slip — fill it in by hand.");
        return;
      }
      setFields(r);
      setReadNote(
        `${r.confidence >= 70 ? "Read the slip" : "Read the slip, but not clearly"}${r.lineCount ? ` — ${r.lineCount} line${r.lineCount === 1 ? "" : "s"}` : ""}. Check the figures before saving.${r.notes ? ` ${r.notes}` : ""}`
      );
    });
  }

  const set = (k: keyof ReadFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form action={action} className="kb-card mt-3 p-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="receiptDataUrl" value={receiptDataUrl} />
      <input type="hidden" name="receiptRead" value={fields.amountRand !== undefined ? "yes" : ""} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Slip</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="mt-1 block text-xs"
          />
          {fileName && <span className="text-[10px] text-[var(--kb-text-dim)]">{fileName}</span>}
        </label>
        {receiptDataUrl && (
          <button type="button" onClick={readSlip} disabled={reading} className="kb-pill kb-pill-ghost text-xs disabled:opacity-50">
            {reading ? "Reading…" : "Read the slip"}
          </button>
        )}
        {readNote && <span className="text-xs text-[var(--kb-text-dim)]">{readNote}</span>}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs sm:col-span-2">
          <span className="font-medium text-[var(--kb-text-dim)]">What for</span>
          <input name="descriptionText" required value={fields.descriptionText ?? ""} onChange={set("descriptionText")} className={INPUT} placeholder="Diesel, cement, tolls…" />
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Amount ({currencySymbol})</span>
          <input name="amountRand" type="number" step="0.01" inputMode="decimal" required value={fields.amountRand ?? ""} onChange={set("amountRand")} className={INPUT} />
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Of which tax</span>
          <input name="taxRand" type="number" step="0.01" inputMode="decimal" value={fields.taxRand ?? ""} onChange={set("taxRand")} className={INPUT} />
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Paid to</span>
          <input name="supplierName" value={fields.supplierName ?? ""} onChange={set("supplierName")} className={INPUT} placeholder="Supplier" />
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Slip number</span>
          <input name="reference" value={fields.reference ?? ""} onChange={set("reference")} className={INPUT} />
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Day</span>
          <input name="spentOn" type="date" value={fields.spentOn || today} onChange={set("spentOn")} className={INPUT} />
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Category</span>
          <input name="category" className={INPUT} placeholder="Fuel, supplies…" />
        </label>

        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Vehicle</span>
          <select name="assetId" className={INPUT} defaultValue="">
            <option value="">—</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Trip</span>
          <select name="tripId" className={INPUT} defaultValue="">
            <option value="">—</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Job</span>
          <select name="jobCardId" className={INPUT} defaultValue="">
            <option value="">—</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Odometer (fuel)</span>
          <input name="odometerKm" type="number" inputMode="numeric" value={fields.odometerKm ?? ""} onChange={set("odometerKm")} className={INPUT} placeholder="km" />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex flex-wrap items-center gap-3 text-xs">
          <legend className="sr-only">Business or personal</legend>
          <label className="flex items-center gap-1.5"><input type="radio" name="isOwnerDrawing" value="false" defaultChecked /> Business cost</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="isOwnerDrawing" value="true" /> Personal — my own money out</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="isOwnerDrawing" value="" /> Not sure</label>
        </fieldset>
        <SubmitButton pendingText="Saving…">Record it</SubmitButton>
      </div>
    </form>
  );
}
