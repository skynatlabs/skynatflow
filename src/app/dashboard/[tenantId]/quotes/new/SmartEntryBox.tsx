"use client";

// "Type or paste everything in one box, we sort it into fields" —
// pastes/free-typed text like "Quote for John, 2x solar panel at 5000
// each, 10% off, due in 30 days" becomes a filled-in form. Talks to the
// rest of the form via DOM ids and LineItemsEditor's window hook, same
// approach as PrefillAssist/PdfPrefillAssist elsewhere in onboarding.

import { useState } from "react";
import type { LineItemValue } from "./LineItemsEditor";

export function SmartEntryBox({ tenantId }: { tenantId: string }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleExtract() {
    if (!text.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/dashboard/${tenantId}/quotes/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.extraction) {
        setMessage(data.error ?? "Couldn't parse that — fill in the form manually below.");
        return;
      }

      const { customerName, customerPhone, subject, poNumber, documentDiscountPercent, lineItems } =
        data.extraction;

      if (customerName) {
        const el = document.querySelector<HTMLInputElement>('input[name="customerName"]');
        if (el) el.value = customerName;
      }
      if (customerPhone) {
        const el = document.querySelector<HTMLInputElement>('input[name="customerPhone"]');
        if (el) el.value = customerPhone;
      }
      if (subject) {
        const el = document.querySelector<HTMLInputElement>('input[name="subject"]');
        if (el) el.value = subject;
      }
      if (poNumber) {
        const el = document.querySelector<HTMLInputElement>('input[name="poNumber"]');
        if (el) el.value = poNumber;
      }

      if (lineItems?.length && window.__setQuoteLineItems) {
        const lines: LineItemValue[] = lineItems.map(
          (l: { name: string; quantity: number; unitPriceCents: number | null; discountPercent: number | null; taxRatePercent: number | null }) => ({
            itemId: "",
            itemName: l.name,
            quantity: l.quantity,
            priceRand: (l.unitPriceCents ?? 0) / 100,
            discountPercent: l.discountPercent ?? undefined,
            taxRatePercent: l.taxRatePercent ?? undefined,
          })
        );
        window.__setQuoteLineItems(lines, documentDiscountPercent ?? undefined);
      }

      setMessage(
        `Filled in ${lineItems?.length ?? 0} item${lineItems?.length === 1 ? "" : "s"} — check everything below and adjust before sending.`
      );
    } catch {
      setMessage("Couldn't reach the AI service — fill in the form manually below.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="kb-card mb-4 p-4">
      <p className="text-sm font-medium text-[var(--kb-text)]">
        ✨ Or just describe it — we'll sort it into the form
      </p>
      <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
        e.g. "Quote for John Smith, 2x solar panel at R5000 each, 10% discount, PO 4471"
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Type or paste the quote details here..."
        className="mt-2 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={handleExtract}
          disabled={loading || !text.trim()}
          className="kb-pill kb-pill-primary text-xs disabled:opacity-50"
        >
          {loading ? "Reading…" : "Fill in the form"}
        </button>
        {message && <p className="text-xs text-[var(--kb-text-dim)]">{message}</p>}
      </div>
    </div>
  );
}
