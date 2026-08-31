// PDF export for a quote/proposal — same access rules as the web view
// (token-scoped to the owning party), rendered server-side so it works
// without JS on the client (link can be opened directly or shared).
// Uses the tenant's chosen PDF template (styles.ts) via the shared
// renderer, so every quote/invoice/slip goes through the same branding.

import { NextRequest, NextResponse } from "next/server";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { prisma } from "@/lib/db";
import { renderTransactionPdf } from "@/lib/pdf/render";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; quoteId: string }> }
) {
  const { token, quoteId } = await params;
  const party = await findPartyByPortalToken(token);
  if (!party) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const quote = await prisma.transaction.findUnique({
    where: { id: quoteId },
    include: {
      itemLines: { include: { item: true } },
      tenant: true,
      salesPersonMembership: { include: { user: true } },
    },
  });
  if (!quote || quote.partyId !== party.id || quote.type !== "QUOTE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const viewOnlineUrl = new URL(`/portal/${token}/quotes/${quoteId}`, request.url).toString();

  const buffer = await renderTransactionPdf({
    transaction: quote,
    party,
    tenant: quote.tenant,
    docLabel: quote.quoteKind === "PROPOSAL" ? "Proposal" : "Quote",
    viewOnlineUrl,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quote.quoteKind === "PROPOSAL" ? "proposal" : "quote"}-${quote.id}.pdf"`,
    },
  });
}
