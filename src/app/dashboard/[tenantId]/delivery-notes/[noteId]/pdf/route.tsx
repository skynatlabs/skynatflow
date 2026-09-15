// The slip itself, for the van.

import { notFound } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { getDeliveryNote } from "@/lib/core/deliveryNotes";
import { renderDeliveryNotePdf } from "@/lib/pdf/render";

export async function GET(_request: Request, { params }: { params: Promise<{ tenantId: string; noteId: string }> }) {
  const { tenantId, noteId } = await params;

  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) return new Response("Sign in required", { status: 401 });
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [note, tenant] = await Promise.all([
    getDeliveryNote(tenantId, noteId),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
  ]);
  if (!note) notFound();

  const buffer = await renderDeliveryNotePdf({ note, party: note.party, tenant });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${note.number}.pdf"`,
    },
  });
}
