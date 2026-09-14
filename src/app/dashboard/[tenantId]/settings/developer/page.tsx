import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { listApiKeys } from "@/lib/api/keys";
import { listEndpoints } from "@/lib/api/webhooks";
import { EVENT_LABELS } from "@/lib/agent/events";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { NewKeyForm } from "./NewKeyForm";
import { createEndpointAction, deleteEndpointAction, revokeKeyAction } from "./actions";

export const dynamic = "force-dynamic";

function ago(date: Date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function DeveloperPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const isOwner = can(access.role, "staff:manage");

  const [keys, endpoints] = await Promise.all([listApiKeys(tenantId), listEndpoints(tenantId)]);

  if (!isOwner) {
    return (
      <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
        <h1 className="text-xl font-semibold text-[var(--kb-text)]">Developer</h1>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
          API keys are a standing credential to this workspace&apos;s money, so only an owner can
          see or create them.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">Developer</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Connect anything to flow: read and write your own data over the API, and get told when
        something happens.
      </p>

      {/* ------------------------------------------------------------- keys */}
      <section className="kb-card mt-6 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          API keys
        </h2>

        {keys.length > 0 && (
          <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--kb-text)]">
                    {key.name}
                    {key.revokedAt && (
                      <span
                        className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                        style={{
                          background: "var(--kb-status-danger)",
                          color: "var(--kb-status-danger-ink)",
                        }}
                      >
                        revoked
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-[11px] text-[var(--kb-text-dim)]">
                    flow_sk_{key.keyPrefix}… · {key.role.toLowerCase()}
                    {key.readOnly && " · read-only"}
                    {key.lastUsedAt ? ` · used ${ago(key.lastUsedAt)}` : " · never used"}
                    {key.expiresAt && ` · expires ${key.expiresAt.toLocaleDateString()}`}
                  </p>
                </div>
                {!key.revokedAt && (
                  <form action={revokeKeyAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="keyId" value={key.id} />
                    <SubmitButton
                      className="text-xs hover:underline"
                      pendingText="Revoking…"
                    >
                      Revoke
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-[var(--kb-panel-border)] pt-4">
          <NewKeyForm tenantId={tenantId} />
        </div>
      </section>

      {/* --------------------------------------------------------- webhooks */}
      <section className="kb-card mt-5 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Webhooks
        </h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          We POST to your URL when something happens, signed with a secret so you can tell it&apos;s
          really us. Failures retry five times over about two hours.
        </p>

        {endpoints.length > 0 && (
          <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id} className="py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-mono text-xs text-[var(--kb-text)]">{endpoint.url}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--kb-text-dim)]">
                      {endpoint.events.length === 0
                        ? "every event"
                        : endpoint.events.join(", ")}
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px] text-[var(--kb-text-dim)]">
                      {endpoint.secret}
                    </p>
                    {endpoint.deliveries.length > 0 && (
                      <p className="mt-1 text-[11px] text-[var(--kb-text-dim)]">
                        Last: {endpoint.deliveries[0].event} ·{" "}
                        {endpoint.deliveries[0].status.toLowerCase()}
                        {endpoint.deliveries[0].statusCode
                          ? ` (${endpoint.deliveries[0].statusCode})`
                          : ""}{" "}
                        · {ago(endpoint.deliveries[0].createdAt)}
                      </p>
                    )}
                  </div>
                  <form action={deleteEndpointAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="endpointId" value={endpoint.id} />
                    <SubmitButton className="text-xs hover:underline" pendingText="Removing…">
                      Remove
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form action={createEndpointAction} className="mt-4 grid gap-3 border-t border-[var(--kb-panel-border)] pt-4 sm:grid-cols-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="sm:col-span-2">
            <span className="block text-xs font-medium text-[var(--kb-text-dim)]">Your URL</span>
            <input
              name="url"
              required
              type="url"
              placeholder="https://example.com/hooks/flow"
              className="mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2.5 py-1.5 text-sm text-[var(--kb-text)]"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="block text-xs font-medium text-[var(--kb-text-dim)]">
              Events <span className="font-normal">(comma separated, blank for all)</span>
            </span>
            <input
              name="events"
              placeholder="invoice.paid, quote.accepted"
              className="mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2.5 py-1.5 text-sm text-[var(--kb-text)]"
            />
            <span className="mt-1 block text-[11px] text-[var(--kb-text-dim)]">
              Available: {Object.keys(EVENT_LABELS).join(", ")}
            </span>
          </label>
          <SubmitButton className="kb-pill kb-pill-primary text-xs sm:col-span-2" pendingText="Adding…">
            Add endpoint
          </SubmitButton>
        </form>
      </section>

      <p className="mt-5 text-xs text-[var(--kb-text-dim)]">
        Start with{" "}
        <code className="font-mono">GET /api/v1/me</code> — it tells you which workspace a key
        belongs to and exactly what it&apos;s allowed to do.{" "}
        <Link href={`/dashboard/${tenantId}/settings`} className="underline">
          Back to settings
        </Link>
      </p>
    </main>
  );
}
