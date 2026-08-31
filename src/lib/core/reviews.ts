// Post-payment review request — fires once, the moment an invoice first
// crosses into PAID, same "fire once on threshold crossing" discipline as
// the hot-lead alert. Silently a no-op if the owner hasn't set a review
// link yet, rather than sending a generic ask with nowhere to click.

import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { sendEmail } from "@/lib/email/client";

export async function maybeSendReviewRequest(invoiceId: string) {
  const invoice = await prisma.transaction.findUnique({
    where: { id: invoiceId },
    include: { party: true, tenant: true },
  });
  if (!invoice || invoice.type !== "INVOICE") return;
  if (invoice.status !== "PAID") return;
  if (invoice.reviewRequestSentAt) return; // already sent, never repeat
  if (!invoice.tenant.googleReviewUrl) return; // nothing configured to link to — reputation management is opt-in via Settings

  const body = `Thanks for your business with ${invoice.tenant.name}! If you have a moment, a quick review would mean a lot: ${invoice.tenant.googleReviewUrl}`;

  if (invoice.party.phone) {
    await sendWhatsAppMessage({ to: invoice.party.phone, body });
  } else if (invoice.party.email) {
    await sendEmail({ to: invoice.party.email, subject: `Thank you for your business with ${invoice.tenant.name}`, html: `<p>${body}</p>` });
  } else {
    return; // no channel to reach them on at all
  }

  await prisma.transaction.update({
    where: { id: invoiceId },
    data: { reviewRequestSentAt: new Date() },
  });
}
