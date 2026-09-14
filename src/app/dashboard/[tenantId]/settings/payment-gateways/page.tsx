import { prisma } from "@/lib/db";
import { gatewaysForRegion } from "@/lib/payments/registry";
import { connectPaymentGatewayAction, disconnectPaymentGatewayAction } from "./actions";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

const inputClass =
  "flex-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm text-[var(--kb-text)]";

export default async function PaymentGatewaysPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const connected = await prisma.paymentGateway.findMany({ where: { tenantId } });
  const connectedByProvider = new Map(connected.map((c) => [c.provider, c]));

  const regions: { region: "RSA" | "USA"; label: string }[] = [
    { region: "RSA", label: "South Africa" },
    { region: "USA", label: "United States" },
  ];

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
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
                    <input
                      name="webhookSecret"
                      type="password"
                      placeholder="Webhook signing secret"
                      defaultValue={existing?.webhookSecret ?? ""}
                      className={inputClass}
                    />
                    <SubmitButton className="kb-pill kb-pill-ghost text-xs" pendingText="Saving…">
                      {existing ? "Update" : "Connect"}
                    </SubmitButton>
                  </form>
                  {/* Without the signing secret the callback can't be trusted,
                      so payments never settle automatically — worth saying
                      here rather than letting it fail silently in production. */}
                  <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
                    Paste this as the webhook / ITN / callback URL in your {gatewayLabel} dashboard:{" "}
                    <code className="rounded bg-black/[0.05] px-1 py-0.5">
                      {appUrl}/api/webhooks/payments/{provider.toLowerCase()}
                    </code>
                    {!existing?.webhookSecret && (
                      <span className="ml-1 font-medium text-[var(--kb-tint-yellow-ink)]">
                        Until the signing secret is set, card payments won&apos;t mark invoices paid
                        automatically.
                      </span>
                    )}
                  </p>
                  {isActive && (
                    <form action={disconnectPaymentGatewayAction} className="mt-2">
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="provider" value={provider} />
                      <SubmitButton
                        className="text-xs text-[var(--kb-text-dim)] hover:underline"
                        pendingText="Disconnecting…"
                      >
                        Disconnect
                      </SubmitButton>
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
