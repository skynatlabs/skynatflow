"use client";

// The questions, and the answer that comes straight back.
//
// The reply is shown in place rather than on another page: somebody filling
// this in on a phone at a building site should see that it worked without a
// navigation that might not survive their signal.

import { useState } from "react";
import type { FormField } from "@/lib/core/leadForms";

export function EnquiryForm({
  tenantId,
  slug,
  fields,
  businessName,
  submitAction,
}: {
  tenantId: string;
  slug: string;
  fields: FormField[];
  businessName: string;
  submitAction: (formData: FormData) => Promise<{ reply: string }>;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (sent) {
    return (
      <div className="kb-card mt-6 p-6" style={{ background: "var(--kb-tint-mint)" }}>
        <p className="text-base font-medium text-[var(--kb-text)]">{sent}</p>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
          {businessName} has your details. There is nothing else you need to do.
        </p>
      </div>
    );
  }

  return (
    <form
      action={async (formData) => {
        setBusy(true);
        setError(null);
        try {
          const result = await submitAction(formData);
          setSent(result.reply);
        } catch (e) {
          setError(e instanceof Error ? e.message : "That did not go through. Try again.");
        } finally {
          setBusy(false);
        }
      }}
      className="kb-card mt-6 grid gap-3 p-6"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />

      {fields.map((field) => (
        <label key={field.name} className="text-xs text-[var(--kb-text-dim)]">
          {field.label}
          {field.required ? "" : " (optional)"}
          {field.type === "long" ? (
            <textarea name={field.name} required={field.required} rows={4} className="kb-input mt-1 w-full text-sm" />
          ) : field.type === "choice" ? (
            <select name={field.name} required={field.required} className="kb-input mt-1 w-full text-sm">
              <option value="">Choose…</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={field.name}
              required={field.required}
              type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
              inputMode={field.type === "phone" ? "tel" : undefined}
              className="kb-input mt-1 w-full text-sm"
            />
          )}
        </label>
      ))}

      {error && <p className="text-xs" style={{ color: "var(--kb-status-danger-ink)" }}>{error}</p>}

      <button type="submit" disabled={busy} className="kb-pill kb-pill-primary mt-1 justify-center text-sm">
        {busy ? "Sending…" : "Send it"}
      </button>
    </form>
  );
}
