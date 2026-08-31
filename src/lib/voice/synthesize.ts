// One function every voice-output surface (daily briefing, PA voice
// replies) calls instead of talking to Google directly. Decides browser
// vs premium per-request: platform-wide off switch, tenant's plan
// allowance for the current period, and whether a Google TTS key is even
// configured, all checked here so the UI components stay dumb.

import { prisma } from "@/lib/db";
import { getPlatformSecret } from "@/lib/platform/apiKeys";
import { allowanceFor, periodKeyFor, type VoicePlan } from "@/lib/voice/plan";

export interface SynthResult {
  engine: "browser" | "google";
  audioBase64?: string; // present only when engine === "google" (MP3)
}

export async function getPlatformVoiceProvider(): Promise<"browser" | "google"> {
  const setting = await prisma.platformSetting.findUnique({ where: { id: "singleton" } });
  return setting?.voiceProvider === "google" ? "google" : "browser";
}

export async function setPlatformVoiceProvider(provider: "browser" | "google"): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", voiceProvider: provider },
    update: { voiceProvider: provider },
  });
}

async function callGoogleTts(text: string, apiKey: string): Promise<string> {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "en-US", name: "en-US-Neural2-F" },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  if (!res.ok) throw new Error(`Google TTS ${res.status}`);
  const data = await res.json();
  return data.audioContent as string;
}

// Reserves the character budget first (so two concurrent requests can't
// both slip in under the cap), then only calls Google if that succeeded.
async function reserveAllowance(tenantId: string, plan: VoicePlan, chars: number): Promise<boolean> {
  const period = periodKeyFor(plan, new Date());
  const cap = allowanceFor(plan);

  const row = await prisma.voiceUsage.upsert({
    where: { tenantId_period: { tenantId, period } },
    create: { tenantId, period, charactersUsed: 0 },
    update: {},
  });

  if (row.charactersUsed + chars > cap) return false;

  await prisma.voiceUsage.update({
    where: { tenantId_period: { tenantId, period } },
    data: { charactersUsed: { increment: chars } },
  });
  return true;
}

export async function synthesizePaVoice(tenantId: string, text: string): Promise<SynthResult> {
  const trimmed = text.slice(0, 4000); // Google TTS's own per-request cap
  const platformProvider = await getPlatformVoiceProvider();
  if (platformProvider !== "google") return { engine: "browser" };

  const apiKey = await getPlatformSecret("GOOGLE_TTS_API_KEY");
  if (!apiKey) return { engine: "browser" };

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { voicePlan: true } });
  const plan = (tenant?.voicePlan as VoicePlan) ?? "free";

  const withinAllowance = await reserveAllowance(tenantId, plan, trimmed.length);
  if (!withinAllowance) return { engine: "browser" };

  try {
    const audioBase64 = await callGoogleTts(trimmed, apiKey);
    return { engine: "google", audioBase64 };
  } catch (err) {
    console.error("[voice] Google TTS failed, falling back to browser:", err);
    return { engine: "browser" };
  }
}
