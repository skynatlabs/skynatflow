import {
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  MODELS,
  getAgentTier,
  getPlatformAiProvider,
  providerHasKey,
} from "@/lib/ai/model";
import { setAiProviderAction, setAgentTierAction } from "./actions";

export default async function AdminAiSettingsPage() {
  const current = await getPlatformAiProvider();
  const tier = await getAgentTier();
  const providers = AI_PROVIDERS;
  const keyStatus = Object.fromEntries(
    await Promise.all(providers.map(async (p) => [p, await providerHasKey(p)] as const))
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">AI provider</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Which model powers every AI feature platform-wide — proposal writing, inbound-email
        classification, follow-up drafting, and onboarding extraction. Takes effect immediately,
        no redeploy needed. A workspace can override this for itself in its own settings.
      </p>
      <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
        Each provider runs two models: the smart one plans and chooses tools, the fast one does
        classification and reads figures off documents. Most of the volume is the fast one, which
        is where the bill actually lives.
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
                <p className="mt-1 font-mono text-[10px] text-[var(--kb-text-dim)]">
                  {MODELS[provider].smart} &middot; {MODELS[provider].fast}
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

      <h2 className="mt-10 text-lg font-semibold text-[var(--kb-text)]">How hard the agent thinks</h2>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Each run is only offered the handful of tools its request could need, not all 332 &mdash;
        which makes choosing between them a job the fast model does about as well as the expensive
        one, for roughly a fifth of the price. Reading figures off documents and sorting email are
        always on the fast model regardless; this governs the agent loop itself.
      </p>

      <div className="kb-card mt-4 divide-y divide-[var(--kb-panel-border)]">
        {([
          { value: "fast", title: "Fast", note: "The default. Sized for business management and optimisation, which is what this app asks of it." },
          { value: "smart", title: "Frontier", note: "Several times the cost per run. Worth trying only if the fast model is visibly reasoning badly about real workspaces." },
        ] as const).map((option) => (
          <div key={option.value} className="flex items-center justify-between p-5">
            <div>
              <p className="font-medium text-[var(--kb-text)]">{option.title}</p>
              <p className="text-xs text-[var(--kb-text-dim)]">{option.note}</p>
              <p className="mt-1 font-mono text-[10px] text-[var(--kb-text-dim)]">
                {MODELS[current][option.value]}
              </p>
            </div>
            {tier === option.value ? (
              <span className="kb-pill kb-pill-primary text-xs">Active</span>
            ) : (
              <form action={setAgentTierAction}>
                <input type="hidden" name="tier" value={option.value} />
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">Use this</button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
