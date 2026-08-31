// Shared client-side "speak this" used by every voice-output surface —
// tries the tenant's premium voice via the synth API, falls back to the
// browser's own speechSynthesis on any failure or when the API says
// browser is what's active for this tenant/period. Callers never need to
// know which engine actually spoke.

export async function speak(tenantId: string, text: string): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const res = await fetch(`/api/dashboard/${tenantId}/voice/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.engine === "google" && data.audioBase64) {
      const audio = new Audio(`data:audio/mp3;base64,${data.audioBase64}`);
      await audio.play();
      return;
    }
  } catch {
    // fall through to browser voice below
  }

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
}
