"use client";

// "Pay my invoice", on a business's Contact page.
//
// The result is a link out of the frame rather than a payment inside it —
// see the action for why. The link opens at the top level, which is also the
// only way a bank's 3-D Secure page will work from here.

import { useState } from "react";

type Result = { url: string; amount: string } | { error: string };

export function PayForm({
  tenantId,
  businessName,
  lookUpAction,
}: {
  tenantId: string;
  businessName: string;
  lookUpAction: (formData: FormData) => Promise<Result>;
}) {
  const [found, setFound] = useState<{ url: string; amount: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (found) {
    return (
      <div className="kb-card p-5 text-center">
        <p className="text-sm text-[var(--kb-text-dim)]">Found it.</p>
        <p className="mt-1 text-2xl font-semibold text-[var(--kb-text)]">{found.amount}</p>
        <a
          href={found.url}
          target="_top"
          rel="noopener"
          className="kb-btn-primary mt-4 inline-block rounded-xl px-5 py-2.5 text-sm font-medium"
        >
          Open and pay
        </a>
        <p className="mt-3 text-[11px] text-[var(--kb-text-dim)]">
          This opens your own page with {businessName}, where you can see the invoice before paying.
        </p>
      </div>
    );
  }

  return (
    <form
      action={async (formData) => {
        setBusy(true);
        setError(null);
        const result = await lookUpAction(formData);
        setBusy(false);
        if ("error" in result) setError(result.error);
        else setFound(result);
      }}
      className="kb-card grid gap-3 p-5"
    >
      <input type="hidden" name="tenantId" value={tenantId} />

      <label className="text-xs text-[var(--kb-text-dim)]">
        Invoice number
        <input
          name="reference"
          required
          placeholder="From the top of your invoice"
          className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2.5 text-sm text-[var(--kb-text)]"
        />
      </label>

      <label className="text-xs text-[var(--kb-text-dim)]">
        Your email or phone number
        <input
          name="contact"
          required
          placeholder="The one they have on file"
          className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2.5 text-sm text-[var(--kb-text)]"
        />
      </label>

      {error && <p className="text-xs text-[var(--kb-tint-rose-ink)]">{error}</p>}

      <button type="submit" disabled={busy} className="kb-btn-primary mt-1 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-60">
        {busy ? "Looking…" : "Find my invoice"}
      </button>
    </form>
  );
}
