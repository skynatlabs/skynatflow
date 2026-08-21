import { prisma } from "@/lib/db";
import { resolveDisputeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DisputesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [open, resolved] = await Promise.all([
    prisma.dispute.findMany({
      where: { tenantId, status: "OPEN" },
      include: { party: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.dispute.findMany({
      where: { tenantId, status: "RESOLVED" },
      include: { party: true },
      orderBy: { resolvedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Customer reports</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        "Something's not right" flags raised from the customer portal on a quote or invoice.
      </p>

      <div className="mt-6 space-y-4">
        {open.map((d) => (
          <div key={d.id} className="kb-card p-6">
            <p className="text-sm font-medium text-[var(--kb-text)]">{d.party.name}</p>
            <p className="mt-1 text-sm text-[var(--kb-text)]">&ldquo;{d.message}&rdquo;</p>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
              Raised {d.createdAt.toLocaleString()}
            </p>
            <form action={resolveDisputeAction} className="mt-3">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="disputeId" value={d.id} />
              <input
                name="resolutionNote"
                placeholder="What did you do about it? (optional)"
                className="w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2 text-sm text-[var(--kb-text)]"
              />
              <button type="submit" className="kb-pill kb-pill-primary mt-2 text-xs">
                Mark resolved
              </button>
            </form>
          </div>
        ))}
        {open.length === 0 && (
          <div className="kb-card p-6 text-sm text-[var(--kb-text-dim)]">
            Nothing open — nice.
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-[var(--kb-text)]">Resolved</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {resolved.map((d) => (
              <li key={d.id} className="p-4 text-sm">
                <p className="text-[var(--kb-text)]">
                  {d.party.name}: &ldquo;{d.message}&rdquo;
                </p>
                {d.resolutionNote && (
                  <p className="mt-1 text-xs text-[var(--kb-text-dim)]">&rarr; {d.resolutionNote}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
