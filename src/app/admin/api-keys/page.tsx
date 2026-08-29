import { API_KEY_REGISTRY, listApiKeyStatus } from "@/lib/platform/apiKeys";
import { setApiKeyAction, clearApiKeyAction } from "./actions";

const GROUPS = ["AI", "Auth", "Communication", "Payments", "Storage"] as const;

export default async function ApiKeysAdminPage() {
  const status = await listApiKeyStatus();

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">API keys</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every external-service credential the platform uses, settable here instead of only as an
        env var — a key saved here takes effect immediately, no redeploy. Leaving one blank falls
        back to its env var, if that's set.
      </p>

      {GROUPS.map((group) => {
        const keys = API_KEY_REGISTRY.filter((k) => k.group === group);
        if (keys.length === 0) return null;
        return (
          <section key={group} className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
              {group}
            </h2>
            <div className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
              {keys.map((meta) => {
                const source = status[meta.key]?.source ?? "none";
                return (
                  <div key={meta.key} className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-[var(--kb-text)]">{meta.label}</p>
                        <p className="text-xs text-[var(--kb-text-dim)]">{meta.helpText}</p>
                      </div>
                      {source === "database" && <span className="kb-pill kb-pill-primary text-xs">Set here</span>}
                      {source === "env" && <span className="kb-pill kb-pill-ghost text-xs">From env var</span>}
                      {source === "none" && <span className="text-xs text-[var(--kb-text-dim)]">Not configured</span>}
                    </div>
                    <form action={setApiKeyAction} className="mt-3 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="key" value={meta.key} />
                      <input
                        name="value"
                        type="password"
                        placeholder={source === "database" ? "•••••••••••• (leave blank to keep)" : "Paste key…"}
                        className="min-w-64 flex-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                      />
                      <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                        Save
                      </button>
                      {source === "database" && (
                        <button
                          type="submit"
                          formAction={clearApiKeyAction}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </form>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
