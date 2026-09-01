import { getPlatformVoiceProvider } from "@/lib/voice/synthesize";
import { getPlatformSecret } from "@/lib/platform/apiKeys";
import { setVoiceProviderAction } from "./actions";

export default async function AdminVoiceSettingsPage() {
  const current = await getPlatformVoiceProvider();
  const hasGoogleKey = Boolean(await getPlatformSecret("GOOGLE_TTS_API_KEY"));

  const providers: { id: "browser" | "google"; label: string; helpText: string }[] = [
    { id: "browser", label: "Browser voice (free)", helpText: "The device's own built-in voice — costs nothing, no key needed. Lower quality." },
    { id: "google", label: "Google Cloud TTS (premium)", helpText: hasGoogleKey ? "API key configured." : "No API key configured yet — add one in API keys first, or picking this now just falls back to browser voice for everyone." },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">PA voice</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Which engine renders the daily briefing and spoken PA answers, platform-wide. Per-tenant
        plans (Free/Starter/Unlimited) still cap how much premium voice each tenant gets per
        period — this switch is the overall on/off for premium voice existing at all. Safe to
        flip any time, no redeploy needed.
      </p>

      <div className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {providers.map((p) => {
          const isCurrent = current === p.id;
          return (
            <div key={p.id} className="flex items-center justify-between p-5">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{p.label}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">{p.helpText}</p>
              </div>
              {isCurrent ? (
                <span className="kb-pill kb-pill-primary text-xs">Active</span>
              ) : (
                <form action={setVoiceProviderAction}>
                  <input type="hidden" name="provider" value={p.id} />
                  <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                    Use this
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
