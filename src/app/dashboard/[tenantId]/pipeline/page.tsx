// Pipeline board — the sales-funnel view GoHighLevel/ClickUp/Monday all
// have, over the exact same Transaction rows the list views already use.
// Same "buttons, not drag-drop" philosophy as the task board — no gesture
// to learn.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { markQuoteOutcomeAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

const COLUMNS: {
  key: "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED";
  label: string;
  tint: string;
}[] = [
  { key: "DRAFT", label: "Draft", tint: "kb-tint-blue" },
  { key: "SENT", label: "Awaiting response", tint: "kb-tint-yellow" },
  { key: "ACCEPTED", label: "Won", tint: "kb-tint-mint" },
  { key: "DECLINED", label: "Lost", tint: "kb-tint-peach" },
];

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const quotes = await prisma.transaction.findMany({
    where: { tenantId, type: "QUOTE" },
    include: { party: true },
    orderBy: { createdAt: "desc" },
  });

  const total = quotes
    .filter((q) => q.status === "SENT" || q.status === "DRAFT")
    .reduce((sum, q) => sum + q.amountCents, 0);
  const won = quotes.filter((q) => q.status === "ACCEPTED").reduce((sum, q) => sum + q.amountCents, 0);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Pipeline</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every quote, at a glance — {money(total)} still in play, {money(won)} won.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = quotes.filter((q) => q.status === col.key);
          return (
            <div key={col.key} className={`kb-tile ${col.tint}`}>
              <h2 className="text-xs font-bold uppercase tracking-wide opacity-70">
                {col.label} ({items.length})
              </h2>
              <ul className="mt-3 space-y-2">
                {items.map((q) => (
                  <li key={q.id} className="rounded-xl bg-white/70 p-3 text-sm">
                    <Link
                      href={`/dashboard/${tenantId}/customers/${q.partyId}`}
                      className="block font-medium text-[var(--kb-text)] hover:underline"
                    >
                      {q.party.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{money(q.amountCents)}</p>

                    {col.key === "SENT" && (
                      <div className="mt-2 flex gap-3">
                        <form action={markQuoteOutcomeAction}>
                          <input type="hidden" name="tenantId" value={tenantId} />
                          <input type="hidden" name="quoteId" value={q.id} />
                          <input type="hidden" name="outcome" value="ACCEPTED" />
                          <button type="submit" className="text-xs font-semibold hover:underline">
                            Mark won &rarr;
                          </button>
                        </form>
                        <form action={markQuoteOutcomeAction}>
                          <input type="hidden" name="tenantId" value={tenantId} />
                          <input type="hidden" name="quoteId" value={q.id} />
                          <input type="hidden" name="outcome" value="DECLINED" />
                          <button
                            type="submit"
                            className="text-xs font-semibold text-[var(--kb-text-dim)] hover:underline"
                          >
                            Mark lost
                          </button>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
                {items.length === 0 && <li className="text-xs opacity-60">Nothing here.</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </main>
  );
}
