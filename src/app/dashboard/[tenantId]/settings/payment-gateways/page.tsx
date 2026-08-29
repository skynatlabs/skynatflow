import { prisma } from "@/lib/db";
import { gatewaysForRegion } from "@/lib/payments/registry";
import { connectPaymentGatewayAction, disconnectPaymentGatewayAction } from "./actions";

const inputClass =
  "flex-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm text-[var(--kb-text)]";

export default async function PaymentGatewaysPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const connected = await prisma.paymentGateway.findMany({ where: { tenantId } });
  const connectedByProvider = new Map(connected.map((c) => [c.provider, c]));

  const regions: { region: "RSA" | "USA"; label: string }[] = [
    { region: "RSA", label: "South Africa" },
    { region: "USA", label: "United States" },
  ];

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Payment gateways</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Let a customer pay a quote or invoice online by card from their portal link — separate from
        your in-person card terminal (see POS &amp; card terminal). Connect one or more; a customer
        sees whichever are active.
      </p>

      {regions.map(({ region, label }) => (
        <section key={region} className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
            {label}
          </h2>
          <div className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {gatewaysForRegion(region).map(({ provider, label: gatewayLabel }) => {
              const existing = connectedByProvider.get(provider);
              const isActive = existing?.isActive ?? false;
              return (
                <div key={provider} className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-[var(--kb-text)]">{gatewayLabel}</p>
                    {isActive ? (
                      <span className="kb-pill kb-pill-primary text-xs">Connected</span>
                    ) : (
                      <span className="text-xs text-[var(--kb-text-dim)]">Not connected</span>
                    )}
                  </div>
                  <form action={connectPaymentGatewayAction} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="provider" value={provider} />
                    <input type="hidden" name="region" value={region} />
                    <input
                      name="publicKey"
                      placeholder="Public / merchant ID (if required)"
                      defaultValue={existing?.publicKey ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="secretKey"
                      type="password"
                      placeholder="Secret key (leave blank to use test/stub mode)"
                      defaultValue={existing?.secretKey ?? ""}
                      className={inputClass}
                    />
                    <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                      {existing ? "Update" : "Connect"}
                    </button>
                  </form>
                  {isActive && (
                    <form action={disconnectPaymentGatewayAction} className="mt-2">
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="provider" value={provider} />
                      <button type="submit" className="text-xs text-[var(--kb-text-dim)] hover:underline">
                        Disconnect
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
