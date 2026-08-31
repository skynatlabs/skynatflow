"use client";

// The Siri-style entry point to flow's PA — one tap from anywhere in the
// app, not just the dashboard home. Type or speak a request; flow first
// tries to treat it as an action (currently: "send a quote like X to
// customer Y" — src/lib/core PA command route), and if it isn't one,
// falls back to answering it as a plain question grounded in the
// tenant's real numbers. Either way the spoken answer goes through the
// shared speak() helper, so it gets premium voice when the tenant's plan
// allows it and free browser voice otherwise.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { speak } from "@/lib/voice/speakClient";

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEvent {
  results: { [index: number]: SpeechRecognitionResult; length: number };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export function FloatingPaButton({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setMicSupported(typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  async function handle(instruction: string) {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setReply(null);
    try {
      const cmdRes = await fetch(`/api/dashboard/${tenantId}/pa/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: instruction }),
      });
      const cmdData = await cmdRes.json();

      if (cmdData.reviewUrl && cmdData.amountCents != null) {
        const rand = (cmdData.amountCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
        const msg = `Drafted a quote for ${cmdData.customerName}, ${rand} — opening it now to review.`;
        setReply(msg);
        speak(tenantId, msg);
        setText("");
        setOpen(false);
        router.push(cmdData.reviewUrl);
        return;
      }

      if (cmdData.reviewUrl && cmdData.detailsUpdated) {
        const msg = `Updated ${cmdData.customerName}'s details.`;
        setReply(msg);
        speak(tenantId, msg);
        setText("");
        setOpen(false);
        router.push(cmdData.reviewUrl);
        return;
      }

      if (cmdData.reviewUrl && cmdData.scheduledAt) {
        const when = new Date(cmdData.scheduledAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
        const msg = `Booked ${cmdData.customerName} in for ${when}.`;
        setReply(msg);
        speak(tenantId, msg);
        setText("");
        setOpen(false);
        router.push(cmdData.reviewUrl);
        return;
      }

      if (cmdData.fallbackToQa) {
        const qaRes = await fetch(`/api/dashboard/${tenantId}/voice-assistant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: instruction }),
        });
        const qaData = await qaRes.json();
        const answer = qaData.answer ?? "Sorry, I couldn't work that out.";
        setReply(answer);
        speak(tenantId, answer);
        return;
      }

      const msg = cmdData.error ?? "Sorry, I couldn't work that out.";
      setReply(msg);
    } catch {
      setReply("Couldn't reach flow just now.");
    } finally {
      setBusy(false);
    }
  }

  function startListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setText(transcript);
        handle(transcript);
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return (
    <>
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 rounded-2xl border p-4"
          style={{ background: "var(--kb-panel)", borderColor: "var(--kb-panel-border)", boxShadow: "0 20px 48px -16px rgba(0,0,0,0.35)" }}
        >
          <p className="mb-2 text-xs font-medium text-[var(--kb-text-dim)]">✦ Ask flow anything</p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handle(text)}
              placeholder='"Send a quote like the 8kVA one to..."'
              className="kb-input flex-1 text-sm"
              disabled={busy}
            />
            {micSupported && (
              <button
                type="button"
                onClick={listening ? stopListening : startListening}
                className={`kb-pill text-xs ${listening ? "kb-pill-primary" : "kb-pill-ghost"}`}
                title="Speak instead"
              >
                🎤
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => handle(text)}
            disabled={busy || !text.trim()}
            className="kb-pill kb-pill-primary mt-2 w-full text-xs"
          >
            {busy ? "Working…" : listening ? "Listening…" : "Go"}
          </button>
          {reply && <p className="mt-3 text-xs text-[var(--kb-text-dim)]">{reply}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Ask flow"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full text-2xl text-white transition hover:scale-105"
        style={{ background: "var(--kb-navy)", boxShadow: "0 10px 24px -8px rgba(0,0,0,0.4)" }}
      >
        {open ? "×" : "✦"}
      </button>
    </>
  );
}
