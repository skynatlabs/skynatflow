"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { acceptQuoteWithSignature, recordResponse } from "@/lib/core/money";
import { prisma } from "@/lib/db";

async function verifyOwnership(token: string, quoteId: string) {
  const party = await findPartyByPortalToken(token);
  if (!party) throw new Error("Invalid portal link.");

  const quote = await prisma.transaction.findUniqueOrThrow({ where: { id: quoteId } });
  if (quote.partyId !== party.id) {
    // Never let one customer's token act on another customer's quote.
    throw new Error("This quote does not belong to this portal link.");
  }
  return { party, quote };
}

export async function acceptQuoteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const signatureDataUrl = String(formData.get("signature") ?? "");

  await verifyOwnership(token, quoteId);

  if (!signatureDataUrl.startsWith("data:image/")) {
    throw new Error("A signature is required to accept.");
  }

  const headerList = await headers();
  const acceptanceIp =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    undefined;

  await acceptQuoteWithSignature({ quoteId, signatureDataUrl, acceptanceIp });

  revalidatePath(`/portal/${token}/quotes/${quoteId}`);
}

export async function declineQuoteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");

  await verifyOwnership(token, quoteId);
  await recordResponse(quoteId, "DECLINED");

  revalidatePath(`/portal/${token}/quotes/${quoteId}`);
}
