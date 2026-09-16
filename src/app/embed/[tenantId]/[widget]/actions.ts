"use server";

import { prisma } from "@/lib/db";
import { getOrCreatePortalToken } from "@/lib/core/parties";

/**
 * "I want to pay my invoice."
 *
 * Deliberately not a checkout inside the iframe. Two reasons, and both are
 * the kind that only show up once real customers are using it: a card
 * payment that needs 3-D Secure redirects to the bank, and a bank's page
 * inside somebody's WordPress site either refuses to load or works once and
 * then does not. And an invoice number alone is a guessable string — a form
 * that opens an invoice from a number is a form that lets a stranger read
 * other people's invoices.
 *
 * So it asks for the number *and* a contact detail already on the account,
 * and what it hands back is the customer's own portal link, opened at the
 * top level where payment actually works.
 */
export async function lookUpInvoiceAction(formData: FormData): Promise<{ url: string; amount: string } | { error: string }> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim().toLowerCase();

  if (!reference || !contact) return { error: "Both the invoice number and your email or phone number are needed." };

  const tail = reference.replace(/[^0-9a-z]/gi, "").slice(-6).toUpperCase();
  const invoices = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: "INVOICE",
      status: { notIn: ["DRAFT", "CANCELLED", "PAID"] },
      OR: [{ externalRef: reference }, { poNumber: reference }],
    },
    include: { party: { select: { id: true, email: true, phone: true } } },
    take: 20,
  });

  // The generated reference is the last six of the id, so a number that
  // matches nothing stored still has one more place to look.
  const byTail =
    invoices.length > 0
      ? invoices
      : (
          await prisma.transaction.findMany({
            where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED", "PAID"] } },
            include: { party: { select: { id: true, email: true, phone: true } } },
            orderBy: { createdAt: "desc" },
            take: 500,
          })
        ).filter((row) => row.id.slice(-6).toUpperCase() === tail);

  const digitsOnly = contact.replace(/[^0-9]/g, "");
  const match = byTail.find((row) => {
    const email = row.party.email?.toLowerCase();
    const phone = row.party.phone?.replace(/[^0-9]/g, "");
    if (email && email === contact) return true;
    // Last nine digits, so a number saved as 083 555 1234 matches one typed
    // as +27 83 555 1234. The same comparison the rest of the system uses.
    if (phone && digitsOnly.length >= 9 && phone.slice(-9) === digitsOnly.slice(-9)) return true;
    return false;
  });

  if (!match) {
    // One message for "no such invoice" and for "wrong contact detail". Two
    // different messages would tell a stranger which invoice numbers exist.
    return { error: "No unpaid invoice matches that number and contact detail. Check the number on your invoice, or get in touch." };
  }

  const token = await getOrCreatePortalToken(match.party.id);
  const base = process.env.NEXT_PUBLIC_APP_URL || "";
  return {
    url: `${base}/portal/${token}/invoices/${match.id}`,
    amount: (match.amountCents / 100).toFixed(2),
  };
}
