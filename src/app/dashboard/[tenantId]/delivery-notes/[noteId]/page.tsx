// One delivery note: what is on it, the slip to print, and the signature.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { getDeliveryNote } from "@/lib/core/deliveryNotes";
import { PageHeader } from "../../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { deleteDraftAction, markDeliveredAction, markSentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DeliveryNotePage({ params }: { params: Promise<{ tenantId: string; noteId: string }> }) {
  const { tenantId, noteId } = await params;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const note = await getDeliveryNote(tenantId, noteId);
  if (!note) notFound();

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title={note.number}
        crumbs={[{ label: "Delivery notes", href: `/dashboard/${tenantId}/delivery-notes` }, { label: note.number }]}
        actions={
          <span className="flex flex-wrap gap-1">
            <a href={`/dashboard/${tenantId}/delivery-notes/${note.id}/pdf`} className="kb-pill kb-pill-primary text-xs">
              Print the slip
            </a>
            {note.transaction && (
              <Link
                href={`/dashboard/${tenantId}/${note.transaction.type === "INVOICE" ? "invoices" : "quotes"}/${note.transaction.id}`}
                className="kb-pill kb-pill-ghost text-xs"
              >
                The {note.transaction.type === "INVOICE" ? "invoice" : "quote"}
              </Link>
            )}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="kb-card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">What is going</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
                <th className="py-1">Item</th>
                <th className="py-1 text-right">Quantity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kb-panel-border)]">
              {note.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 text-[var(--kb-text)]">{l.description}</td>
                  <td className="py-2 text-right tabular-nums text-[var(--kb-text)]">
                    {l.quantity}
                    {l.unit ? ` ${l.unit}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {note.notes && <p className="mt-3 text-xs text-[var(--kb-text-dim)]">{note.notes}</p>}
        </section>

        <section className="space-y-4">
          <div className="kb-card p-5">
            <h2 className="text-sm font-semibold text-[var(--kb-text)]">{note.party.name}</h2>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{note.deliveryAddress ?? "No address on the note"}</p>
            {note.reference && <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Their reference: {note.reference}</p>}
          </div>

          <div className="kb-card p-5">
            <h2 className="text-sm font-semibold text-[var(--kb-text)]">Where it is</h2>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
              {note.status === "DELIVERED"
                ? `Delivered ${note.deliveredAt?.toLocaleDateString()}${note.signedBy ? `, signed by ${note.signedBy}` : ""}.`
                : note.status === "SENT"
                  ? "Out for delivery."
                  : "Still a draft — nothing has gone out."}
            </p>

            {note.status === "DRAFT" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={markSentAction.bind(null, tenantId, note.id)}>
                  <SubmitButton pendingText="Sending…">It has gone out</SubmitButton>
                </form>
                <form action={deleteDraftAction.bind(null, tenantId, note.id)}>
                  <button type="submit" className="text-xs text-[var(--kb-text-dim)] underline">
                    Delete this draft
                  </button>
                </form>
              </div>
            )}

            {note.status !== "DELIVERED" && (
              <form action={markDeliveredAction.bind(null, tenantId, note.id)} className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex-1 text-xs">
                  <span className="font-medium text-[var(--kb-text-dim)]">Signed for by</span>
                  <input name="signedBy" placeholder="Name on the gate" className="kb-input mt-1 w-full text-sm" />
                </label>
                <SubmitButton pendingText="Recording…">It arrived</SubmitButton>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
