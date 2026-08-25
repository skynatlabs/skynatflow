"use client";

import { useState } from "react";

export function ReceiptUploadForm({
  action,
  tenantId,
}: {
  action: (formData: FormData) => void;
  tenantId: string;
}) {
  const [receiptDataUrl, setReceiptDataUrl] = useState("");
  const [fileName, setFileName] = useState("");

  function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setReceiptDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <form action={action} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="receiptDataUrl" value={receiptDataUrl} />
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Description</span>
        <input name="descriptionText" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Category</span>
        <input name="category" placeholder="Fuel, supplies..." className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Amount (ZAR)</span>
        <input name="amountRand" type="number" step="0.01" required className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Slip (optional)</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="mt-1 block text-xs"
        />
        {fileName && <span className="text-[10px] text-[var(--kb-text-dim)]">{fileName}</span>}
      </label>
      <button type="submit" className="kb-pill kb-pill-primary text-xs">Submit expense</button>
    </form>
  );
}
