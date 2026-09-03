"use client";

// Sends the document to the customer for real, instead of just flipping a
// status flag: opens wa.me (which itself routes to the native WhatsApp app
// on phones/tablets, or WhatsApp Web/Desktop on a computer — the standard
// click-to-chat behavior, no platform branching needed here), with the
// message pre-filled and a direct online-view link the customer taps to
// see the document. WhatsApp's click-to-chat API can't pre-attach an
// actual file — that's a WhatsApp platform limit, not something this can
// work around — so a viewable link is the correct, standard approach.
//
// The window.open() call has to be the very first thing that happens in
// the click handler (synchronous, no `await` before it) or browsers treat
// it as a blocked popup instead of a user-initiated one.

import { useRouter } from "next/navigation";
import { useState } from "react";

export function WhatsAppSendButton({
  phone,
  message,
  markSentAction,
  label = "Send via WhatsApp",
  disabled,
}: {
  phone: string | null | undefined;
  message: string;
  /** Optional: a server action (bound with its own args via .bind) that also marks the document as sent — omit when there's no status transition needed (e.g. resharing an already-sent invoice). */
  markSentAction?: () => Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const digitsOnly = (phone ?? "").replace(/[^0-9]/g, "");

  if (!digitsOnly) {
    return (
      <p className="text-xs text-[var(--kb-text-dim)]">
        Add a phone number for this customer to send via WhatsApp.
      </p>
    );
  }

  async function handleClick() {
    window.open(`https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    if (!markSentAction) return;
    setBusy(true);
    try {
      await markSentAction();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={disabled || busy} className="kb-pill kb-pill-primary text-xs disabled:opacity-50">
      {busy ? "Opening WhatsApp…" : label}
    </button>
  );
}
