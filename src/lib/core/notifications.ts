// Hot-lead alert — Soler's AutomationService::onQuoteOpened pattern,
// generalized: the moment a quote's open count crosses 2, tell the owner.
// A quote opened twice is a real buying signal, worth a human's attention
// regardless of what the automated follow-up cadence is doing.

import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email/client";

export async function maybeAlertHotLead(quoteId: string) {
  const quote = await prisma.transaction.findUniqueOrThrow({
    where: { id: quoteId },
    include: { party: true },
  });

  // Fire exactly once, on the threshold crossing — not on every open after.
  if (quote.openCount !== 2) return;

  const ownerMembership = await prisma.membership.findFirst({
    where: { tenantId: quote.tenantId, role: "OWNER" },
    include: { user: true },
  });
  if (!ownerMembership?.user.email) return;

  const amount = (quote.amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "ZAR",
  });

  await sendEmail({
    to: ownerMembership.user.email,
    subject: `${quote.party.name} just opened your quote again — hot lead`,
    html: `
      <p><strong>${quote.party.name}</strong> has now opened the quote for ${amount} twice.</p>
      <p>This usually means they're actively comparing options — worth a personal follow-up call or message rather than waiting on the automated cadence.</p>
    `,
  });
}
