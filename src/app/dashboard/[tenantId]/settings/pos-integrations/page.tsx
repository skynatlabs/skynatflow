import { prisma } from "@/lib/db";
import { POS_PROVIDERS } from "@/lib/pos/providers/registry";
import { connectPosProviderAction } from "./actions";

export default async function PosIntegrationsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const connected = await prisma.posIntegration.findMany({ where: { tenantId } });
  const connectedByProvider = new Map(connected.map((c) => [c.provider, c]));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">POS integrations</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Use flow&apos;s own built-in till, or connect a card provider — scaffolded per region, more
        markets added over time.
      </p>

      <div className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {Object.entries(POS_PROVIDERS).map(([provider, meta]) => {
          const existing = connectedByProvider.get(provider as never);
          return (
            <div key={provider} className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{meta.label}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">Region: {meta.region}</p>
                </div>
                {existing?.isActive && <span className="kb-pill kb-pill-primary text-xs">Connected</span>}
              </div>
              <form action={connectPosProviderAction} className="mt-3 flex items-end gap-2">
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="provider" value={provider} />
                <input type="hidden" name="region" value={meta.region} />
                <input
                  name="apiKey"
                  placeholder="API key (leave blank to use in test/stub mode)"
                  defaultValue={existing?.apiKey ?? ""}
                  className="flex-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                />
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                  {existing ? "Update" : "Connect"}
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </main>
  );
}
