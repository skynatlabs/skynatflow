"use client";

// Minting a key.
//
// The secret is shown once, here, and never again — so the copy affordance
// has to be obvious and the warning has to be honest rather than decorative.
// A key you cannot copy is a key someone screenshots.

import { useState } from "react";
import { ALL_ROLES } from "@/lib/core/access";
import { createKeyAction } from "./actions";

const field =
  "mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2.5 py-1.5 text-sm text-[var(--kb-text)]";
const label = "block text-xs font-medium text-[var(--kb-text-dim)]";

export function NewKeyForm({ tenantId }: { tenantId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (secret) {
    return (
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--kb-accent-a)" }}>
        <p className="text-sm font-semibold text-[var(--kb-text)]">Copy this now</p>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          It isn&apos;t stored anywhere — only a hash of it is. Once you leave this page it
          cannot be shown again, and you&apos;ll have to make a new one.
        </p>
        <code className="mt-3 block overflow-x-auto rounded-lg bg-[var(--kb-bg)] p-3 font-mono text-xs text-[var(--kb-text)]">
          {secret}
        </code>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(secret);
              setCopied(true);
            }}
            className="kb-pill kb-pill-primary text-xs"
          >
            {copied ? "Copied" : "Copy key"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSecret(null);
              setCopied(false);
            }}
            className="kb-pill kb-pill-ghost text-xs"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      action={async (formData) => {
        setBusy(true);
        setError(null);
        try {
          const result = await createKeyAction(formData);
          setSecret(result.secret);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't create that key.");
        } finally {
          setBusy(false);
        }
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <input type="hidden" name="tenantId" value={tenantId} />

      <label className="sm:col-span-2">
        <span className={label}>What is it for?</span>
        <input name="name" required placeholder="Zapier, our website, the stocktake script" className={field} />
      </label>

      <label>
        <span className={label}>Acts as</span>
        <select name="role" defaultValue="STAFF" className={field}>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {r.charAt(0) + r.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className={label}>Expires in (days, blank = never)</span>
        <input name="expiresInDays" type="number" min="1" max="3650" className={field} />
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--kb-text)] sm:col-span-2">
        <input type="checkbox" name="readOnly" />
        Read-only — can look at everything its role allows, and change nothing
      </label>

      {error && (
        <p className="text-xs sm:col-span-2" style={{ color: "var(--kb-status-danger-ink)" }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="kb-pill kb-pill-primary text-xs disabled:opacity-50 sm:col-span-2"
      >
        {busy ? "Creating…" : "Create key"}
      </button>
    </form>
  );
}
