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

      const {
        customerName,
        customerPhone,
        customerEmail,
        subject,
        poNumber,
        documentDiscountPercent,
        lineItems,
      } = data.extraction;

      if (customerName) {
        const el = document.querySelector<HTMLInputElement>('input[name="customerName"]');
        if (el) el.value = customerName;
      }
      if (customerPhone) {
        const el = document.querySelector<HTMLInputElement>('input[name="customerPhone"]');
        if (el) el.value = customerPhone;
      }
      if (customerEmail) {
        const el = document.querySelector<HTMLInputElement>('input[name="customerEmail"]');
        if (el) el.value = customerEmail;
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

      const count = lineItems?.length ?? 0;
      // Anything it couldn't price is said out loud. A line silently missing
      // from a quote is the one failure mode nobody catches before sending.
      const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
      setMessage(
        `Filled in ${count} item${count === 1 ? "" : "s"} — check everything below before sending.` +
          (warnings.length ? ` ${warnings.join(" ")}` : "")
      );
    } catch {
      setMessage("Couldn't read that just now — fill in the form manually below.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="kb-card mb-4 p-4">
      <p className="text-sm font-medium text-[var(--kb-text)]">
        ✨ Or just describe it — we&apos;ll sort it into the form
      </p>
      <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
        Customer on the first lines, then one item per line — or just describe it in a sentence.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"Isaac Dlamini\nisaac@acme.co.za\n082 555 1234\n\n2 x iPhone 16 @ R20 000 each\n1 x AirPods Pro - 4500\nInstallation 1500"}
        className="mt-2 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none"
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
