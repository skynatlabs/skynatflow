"use client";

// Reads today's work summary aloud on the first dashboard visit of the
// day — premium Google voice when the tenant's plan/period allows it,
// browser speechSynthesis otherwise (see src/lib/voice/speakClient.ts).
// Fires once per tenant per calendar day (tracked in localStorage,
// per-viewer by design — each person on the team gets their own greeting,
// not a shared "already played" flag).

import { useEffect, useState } from "react";
import { speak } from "@/lib/voice/speakClient";

export function DailyVoiceBriefing({ tenantId, text }: { tenantId: string; text: string }) {
  const [showReplay, setShowReplay] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const today = new Date().toISOString().slice(0, 10);
    const storageKey = `flow:voice-briefing:${tenantId}`;
    let alreadyPlayed = false;
    try {
      alreadyPlayed = localStorage.getItem(storageKey) === today;
    } catch {
      // Private browsing / storage blocked — just don't persist the flag,
      // still fine to speak once for this page load.
    }

    setShowReplay(true);
    if (alreadyPlayed) return;

    speak(tenantId, text);

    try {
      localStorage.setItem(storageKey, today);
    } catch {
      // Ignore — worst case it replays next visit today, harmless.
    }
  }, [tenantId, text]);

  function replay() {
    speak(tenantId, text);
  }

  if (!showReplay) return null;

  return (
    <button
      type="button"
      onClick={replay}
      title="Replay today's voice briefing"
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-[var(--kb-text-dim)] hover:text-[var(--kb-text)]"
    >
      🔊 Replay today's briefing
    </button>
  );
}
