// PDF export for a quote/proposal — same access rules as the web view
// (token-scoped to the owning party), rendered server-side so it works
// without JS on the client (link can be opened directly or shared).

import { notFound } from "next/navigation";
import { renderToBuffer } from "@react-pdf/renderer";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { prisma } from "@/lib/db";
import { QuotePdfDocument } from "./QuotePdfDocument";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; quoteId: string }> }
) {
  const { token, quoteId } = await params;
  const party = await findPartyByPortalToken(token);
  if (!party) notFound();

  const quote = await prisma.transaction.findUnique({
    where: { id: quoteId },
    include: { itemLines: { include: { item: true } }, tenant: true },
  });
  if (!quote || quote.partyId !== party.id || quote.type !== "QUOTE") notFound();

  const buffer = await renderToBuffer(
    <QuotePdfDocument quote={quote} party={party} tenantName={quote.tenant.name} />
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quote.quoteKind === "PROPOSAL" ? "proposal" : "quote"}-${quote.id}.pdf"`,
    },
  });
}
