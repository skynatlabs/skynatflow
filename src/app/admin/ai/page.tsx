import { AI_PROVIDER_LABELS, getPlatformAiProvider, providerHasKey, type AiProvider } from "@/lib/ai/model";
import { setAiProviderAction } from "./actions";

export default async function AdminAiSettingsPage() {
  const current = await getPlatformAiProvider();
  const providers: AiProvider[] = ["anthropic", "google"];
  const keyStatus = Object.fromEntries(
    await Promise.all(providers.map(async (p) => [p, await providerHasKey(p)] as const))
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">AI provider</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Which model powers every AI feature platform-wide — proposal writing, inbound-email
        classification, follow-up drafting, and onboarding extraction. Takes effect immediately,
        no redeploy needed.
      </p>

      <div className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {providers.map((provider) => {
          const hasKey = keyStatus[provider];
          const isCurrent = current === provider;
          return (
            <div key={provider} className="flex items-center justify-between p-5">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{AI_PROVIDER_LABELS[provider]}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {hasKey ? "API key configured" : "No API key configured — pick this and it'll fall back to whichever provider does have one"}
                </p>
              </div>
              {isCurrent ? (
                <span className="kb-pill kb-pill-primary text-xs">Active</span>
              ) : (
                <form action={setAiProviderAction}>
                  <input type="hidden" name="provider" value={provider} />
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
