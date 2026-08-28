import { NextRequest, NextResponse } from "next/server";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { prisma } from "@/lib/db";
import { renderTransactionPdf } from "@/lib/pdf/render";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; invoiceId: string }> }
) {
  const { token, invoiceId } = await params;
  const party = await findPartyByPortalToken(token);
  if (!party) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const invoice = await prisma.transaction.findUnique({
    where: { id: invoiceId },
    include: { itemLines: { include: { item: true } }, tenant: true },
  });
  if (!invoice || invoice.partyId !== party.id || invoice.type !== "INVOICE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const viewOnlineUrl = new URL(`/portal/${token}/invoices/${invoiceId}`, request.url).toString();

  const buffer = await renderTransactionPdf({
    transaction: invoice,
    party,
    tenant: invoice.tenant,
    docLabel: "Invoice",
    viewOnlineUrl,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${invoice.id}.pdf"`,
    },
  });
}
