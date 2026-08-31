"use client";

// Ask a question by voice, get a spoken answer grounded in real
// dashboard numbers. Both halves are free/native: Web Speech Recognition
// transcribes in the browser (Chrome/Edge/Safari support it; other
// browsers just won't show the mic button), speechSynthesis reads the
// answer back — no voice API cost either direction.

import { useEffect, useRef, useState } from "react";

// Not in the standard lib.dom types yet in most TS setups — declared
// minimally here rather than pulling in a whole @types package for one API.
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

export function VoiceAssistant({ tenantId }: { tenantId: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  async function askQuestion(question: string) {
    setStatus(`You asked: "${question}"`);
    try {
      const res = await fetch(`/api/dashboard/${tenantId}/voice-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      const answer = data.answer ?? "Sorry, I couldn't work that out.";
      setStatus(answer);
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(answer));
      }
    } catch {
      setStatus("Couldn't reach the assistant just now.");
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
      if (transcript) askQuestion(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    setStatus(null);
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  if (!supported) return null;

  return (
    <div className="mb-3 flex items-center gap-2">
      <button
        type="button"
        onClick={listening ? stopListening : startListening}
        className={`kb-pill text-xs ${listening ? "kb-pill-primary" : "kb-pill-ghost"}`}
      >
        {listening ? "🎙️ Listening…" : "🎤 Ask flow"}
      </button>
      {status && <p className="text-xs text-[var(--kb-text-dim)]">{status}</p>}
    </div>
  );
}
