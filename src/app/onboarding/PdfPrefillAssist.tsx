"use client";

// Companion to PrefillAssist — same "fill the form via DOM ids" approach,
// but the source is an uploaded PDF quote instead of a website. Also
// writes to the customerJson hidden field so a customer named on the
// quote gets created alongside the business itself.

import { useRef, useState } from "react";

export default function PdfPrefillAssist() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/onboarding/extract-pdf", { method: "POST", body });
      const data = await res.json();
      if (!data.extraction) {
        setMessage(data.error ?? "Couldn't read that PDF — fill it in manually below.");
        return;
      }

      const { businessName, suggestedNiche, customerName, customerEmail, customerPhone, lineItems } =
        data.extraction;

      if (businessName) {
        const nameInput = document.getElementById("businessName-input") as HTMLInputElement | null;
        if (nameInput) nameInput.value = businessName;
      }
      if (suggestedNiche) {
        const radio = document.getElementById(`niche-${suggestedNiche}`) as HTMLInputElement | null;
        if (radio) radio.checked = true;
      }
      const hiddenItems = document.getElementById("catalogItemsJson-input") as HTMLInputElement | null;
      if (hiddenItems && lineItems?.length) {
        hiddenItems.value = JSON.stringify(
          lineItems.map((l: { name: string; unitPriceCents: number | null }) => ({
            name: l.name,
            unitPriceCents: l.unitPriceCents,
          }))
        );
      }
      const hiddenCustomer = document.getElementById("customerJson-input") as HTMLInputElement | null;
      if (hiddenCustomer && customerName) {
        hiddenCustomer.value = JSON.stringify({ name: customerName, email: customerEmail, phone: customerPhone });
      }

      const parts = [businessName && `business name`, customerName && `a customer`, lineItems?.length && `${lineItems.length} item(s)`]
        .filter(Boolean)
        .join(", ");
      setMessage(
        parts
          ? `Pulled ${parts} from the PDF — check it over and adjust anything before continuing.`
          : "Read the PDF but couldn't find much to extract — fill in the form manually below."
      );
    } catch {
      setMessage("Couldn't read that PDF — fill it in manually below.");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="kb-card mb-4 p-4">
      <p className="text-sm font-medium text-[var(--kb-text)]">Have a past quote as a PDF?</p>
      <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
        Upload it and we'll pull your business name, a customer, and the line items straight off it.
      </p>
      <div className="mt-3">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          disabled={loading}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="text-sm text-[var(--kb-text-dim)]"
        />
        {loading && <span className="ml-2 text-xs text-[var(--kb-text-dim)]">Reading…</span>}
      </div>
      {message && <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{message}</p>}
    </div>
  );
}
