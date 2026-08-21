// Customer portal home — token-login (no password), generalized from
// Soler's proven pattern. Shows the customer their own quotes, invoices,
// and history, scoped strictly to their own Party record via the token.

import { notFound } from "next/navigation";
import Link from "next/link";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function PortalHomePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const party = await findPartyByPortalToken(token);
  if (!party) notFound();

  const [tenant, transactions, events] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: party.tenantId } }),
    prisma.transaction.findMany({
      where: { partyId: party.id, type: { in: ["QUOTE", "INVOICE"] } },
      orderBy: { createdAt: "desc" },
      include: { itemLines: { include: { item: true } } },
    }),
    prisma.event.findMany({
      where: { partyId: party.id, photoUrl: { not: null } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="kb-shell min-h-screen p-8" data-theme="light">
      <main className="mx-auto max-w-2xl">
        <p className="text-sm text-[var(--kb-text-dim)]">{tenant.name}</p>
        <h1 className="text-2xl font-bold text-[var(--kb-text)]">Hi {party.name}</h1>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
          Here&apos;s everything on file for you.
        </p>

        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {transactions.map((t) => (
            <li key={t.id} className="p-4">
              {t.type === "QUOTE" ? (
                <Link
                  href={`/portal/${token}/quotes/${t.id}`}
                  className="flex items-center justify-between"
                >
                  <div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: "var(--kb-tint-violet)", color: "var(--kb-tint-violet-ink)" }}
                    >
                      Quote &middot; {t.status}
                    </span>
                    <p className="mt-1 text-sm text-[var(--kb-text)]">
                      {t.itemLines.map((l) => l.item.name).join(", ")}
                    </p>
                  </div>
                  <span className="font-semibold text-[var(--kb-text)]">{money(t.amountCents)}</span>
                </Link>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: "var(--kb-tint-blue)", color: "var(--kb-tint-blue-ink)" }}
                    >
                      Invoice &middot; {t.status}
                    </span>
                    <p className="mt-1 text-sm text-[var(--kb-text)]">
                      {t.itemLines.map((l) => l.item.name).join(", ")}
                    </p>
                  </div>
                  <span className="font-semibold text-[var(--kb-text)]">{money(t.amountCents)}</span>
                </div>
              )}
            </li>
          ))}
          {transactions.length === 0 && (
            <li className="p-4 text-sm text-[var(--kb-text-dim)]">Nothing here yet.</li>
          )}
        </ul>

        {events.length > 0 && (
          <>
            <h2 className="mt-8 text-sm font-semibold text-[var(--kb-text)]">Photo proof</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {events.map((e) => (
                <div key={e.id} className="kb-card overflow-hidden p-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.photoUrl!} alt={e.type} className="h-28 w-full object-cover" />
                  <p className="p-2 text-[10px] text-[var(--kb-text-dim)]">
                    {e.type.replace(/_/g, " ")} &middot; {e.createdAt.toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
