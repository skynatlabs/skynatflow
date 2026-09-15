// Delivery notes — the packing slip, and the proof that it arrived.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { deliverableParties, listDeliveryNotes } from "@/lib/core/deliveryNotes";
import { formatMoney } from "@/lib/core/currency";
import { PageHeader } from "../PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { NewDeliveryNote } from "./NewDeliveryNote";

export const dynamic = "force-dynamic";

const TONE: Record<string, { label: string; bg: string; ink: string }> = {
  DRAFT: { label: "draft", bg: "var(--kb-panel)", ink: "var(--kb-text-dim)" },
  SENT: { label: "out for delivery", bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  DELIVERED: { label: "delivered", bg: "var(--kb-tint-mint)", ink: "var(--kb-tint-mint-ink)" },
};

export default async function DeliveryNotesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [notes, parties, open, tenant] = await Promise.all([
    listDeliveryNotes(tenantId),
    deliverableParties(tenantId),
    // Documents somebody could be delivering against: sent or part-paid.
    prisma.transaction.findMany({
      where: { tenantId, type: { in: ["INVOICE", "QUOTE"] }, status: { in: ["SENT", "ACCEPTED", "PARTIALLY_PAID", "OVERDUE"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, amountCents: true, createdAt: true, party: { select: { name: true } } },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
  ]);
  const money = (c: number) => formatMoney(c, tenant?.currency ?? "ZAR");

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Delivery notes" crumbs={[{ label: "Delivery notes" }]} />

      <p className="-mt-2 mb-5 max-w-prose text-sm text-[var(--kb-text-dim)]">
        What actually went out of the door, with no prices on it. Written against an invoice or on its own, printed for the van, and
        signed for on arrival — a part delivery leaves the rest outstanding rather than pretending the order is closed.
      </p>

      <NewDeliveryNote
        tenantId={tenantId}
        parties={parties}
        documents={open.map((d) => ({
          id: d.id,
          label: `${d.type === "INVOICE" ? "Invoice" : "Quote"} · ${d.party.name} · ${money(d.amountCents)} · ${d.createdAt.toLocaleDateString()}`,
        }))}
      />

      <section className="mt-6">
        {notes.length === 0 ? (
          <EmptyState
            title="No delivery notes yet"
            purpose="A packing slip for the van and a signature on arrival, with no prices on it."
            needs="An invoice or a quote to deliver against — or just type what is going."
          />
        ) : (
          <ul className="kb-card divide-y divide-[var(--kb-panel-border)]">
            {notes.map((n) => {
              const tone = TONE[n.status];
              const units = n.lines.reduce((s, l) => s + l.quantity, 0);
              return (
                <li key={n.id}>
                  <Link href={`/dashboard/${tenantId}/delivery-notes/${n.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-black/[0.02]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--kb-text)]">
                        {n.number} · {n.party.name}
                      </p>
                      <p className="text-xs text-[var(--kb-text-dim)]">
                        {n.lines.length} line{n.lines.length === 1 ? "" : "s"}, {units} unit{units === 1 ? "" : "s"} ·{" "}
                        {n.createdAt.toLocaleDateString()}
                        {n.deliveredAt ? ` · signed ${n.deliveredAt.toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <span className="kb-pill text-[10px]" style={{ background: tone.bg, color: tone.ink }}>
                      {tone.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
