"use client";

import { useState } from "react";

export function PhotoEventForm({
  action,
  tenantId,
  customerId,
}: {
  action: (formData: FormData) => void;
  tenantId: string;
  customerId: string;
}) {
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [fileName, setFileName] = useState("");

  function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <form action={action} className="mt-4 space-y-3 border-t border-[var(--kb-panel-border)] pt-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="photoDataUrl" value={photoDataUrl} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-[var(--kb-text-dim)]">Type</label>
          <select
            name="eventType"
            className="mt-1 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2.5 py-2 text-sm text-[var(--kb-text)]"
          >
            <option value="SITE_VISIT">Site visit</option>
            <option value="DELIVERY">Delivery</option>
            <option value="INSTALL">Install</option>
          </select>
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="block text-xs text-[var(--kb-text-dim)]">Notes</label>
          <input
            name="notes"
            className="mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-white px-2.5 py-2 text-sm text-[var(--kb-text)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--kb-text-dim)]">Photo proof</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="mt-1 text-xs text-[var(--kb-text-dim)]"
          />
          {fileName && <p className="mt-0.5 text-[10px] text-[var(--kb-text-dim)]">{fileName} attached</p>}
        </div>
        <button type="submit" className="kb-pill kb-pill-primary text-xs">
          Log it
        </button>
      </div>
    </form>
  );
}
