"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { resolvePortal } from "@/lib/core/portal";
import { declineAgreement, signAgreement } from "@/lib/core/agreements";
import { noteSigningEvent } from "@/lib/core/signing";

/** The token is the credential. The party comes from it, never from the form. */
async function partyFor(token: string) {
  const party = await resolvePortal(token);
  if (!party) throw new Error("That link is not valid any more.");
  return party;
}

/**
 * Who and from where, as far as the request can say.
 *
 * Read here rather than inside the core module, because headers only exist at
 * the request boundary — and because the signing record is a record of what
 * the request looked like, not of what the database did.
 */
async function requestFacts() {
  const headerList = await headers();
  return {
    ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? null,
    userAgent: headerList.get("user-agent") ?? null,
  };
}

export async function signAgreementAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const agreementId = String(formData.get("agreementId") ?? "");
  const party = await partyFor(token);
  const { ip, userAgent } = await requestFacts();

  const signerName = String(formData.get("signerName") ?? "");

  await signAgreement({
    agreementId,
    partyId: party.id,
    signerName,
    signatureDataUrl: String(formData.get("signature") ?? ""),
    signerIp: ip,
  });

  await noteSigningEvent({
    tenantId: party.tenantId,
    kind: "agreement",
    documentId: agreementId,
    event: "signed",
    actor: { type: "user", name: signerName.trim() },
    ip: ip ?? undefined,
    userAgent: userAgent ?? undefined,
  });

  revalidatePath(`/portal/${token}/agreements/${agreementId}`);
  revalidatePath(`/portal/${token}`);
}

export async function declineAgreementAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const agreementId = String(formData.get("agreementId") ?? "");
  const party = await partyFor(token);
  const { ip, userAgent } = await requestFacts();

  await declineAgreement({ agreementId, partyId: party.id });

  await noteSigningEvent({
    tenantId: party.tenantId,
    kind: "agreement",
    documentId: agreementId,
    event: "declined",
    actor: { type: "user", name: party.companyName ?? party.name },
    ip: ip ?? undefined,
    userAgent: userAgent ?? undefined,
  });

  revalidatePath(`/portal/${token}/agreements/${agreementId}`);
}
