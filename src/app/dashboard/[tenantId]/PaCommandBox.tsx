"use client";

// The PA command box — "send quote for R39,995 8kva system to John, 082
// 123 4567" and flow finds the closest past quote, clones it onto a new
// customer, and drops you straight into the draft to check and send.
// Deliberately never auto-sends: this always lands you on the review
// page, one click from Send.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PaCommandBox({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/dashboard/${tenantId}/pa/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.error || data.fallbackToQa) {
        setMessage(data.error ?? "flow doesn't have an action for that yet — try asking a question instead via the floating ✦ button.");
        return;
      }
      if (data.amountCents != null) {
        const rand = (data.amountCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
        setMessage(`Drafted a quote for ${data.customerName} (${rand}) — opening it now to review.`);
      } else if (data.scheduledAt) {
        const when = new Date(data.scheduledAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
        setMessage(`Booked ${data.customerName} in for ${when} — opening the appointments board.`);
      } else if (data.detailsUpdated) {
        setMessage(`Updated ${data.customerName}'s details — opening their record to confirm.`);
      }
      setText("");
      router.push(data.reviewUrl);
    } catch {
      setMessage("Couldn't reach the assistant just now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kb-panel mb-4 p-3">
      <label className="mb-1 block text-xs font-medium text-[var(--kb-text-dim)]">
        🤖 Ask flow to do something — e.g. &ldquo;send quote for R39,995 8kva system to John, 082 123 4567&rdquo;
      </label>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Tell flow what you need..."
          className="kb-input flex-1"
          disabled={busy}
        />
        <button type="button" onClick={submit} disabled={busy || !text.trim()} className="kb-pill kb-pill-primary text-xs">
          {busy ? "Working…" : "Go"}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{message}</p>}
    </div>
  );
}
