"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { resolvePortal } from "@/lib/core/portal";
import { declineAgreement, signAgreement } from "@/lib/core/agreements";

/** The token is the credential. The party comes from it, never from the form. */
async function partyFor(token: string) {
  const party = await resolvePortal(token);
  if (!party) throw new Error("That link is not valid any more.");
  return party;
}

export async function signAgreementAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const agreementId = String(formData.get("agreementId") ?? "");
  const party = await partyFor(token);

  const headerList = await headers();
  const signerIp =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? null;

  await signAgreement({
    agreementId,
    partyId: party.id,
    signerName: String(formData.get("signerName") ?? ""),
    signatureDataUrl: String(formData.get("signature") ?? ""),
    signerIp,
  });

  revalidatePath(`/portal/${token}/agreements/${agreementId}`);
  revalidatePath(`/portal/${token}`);
}

export async function declineAgreementAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const agreementId = String(formData.get("agreementId") ?? "");
  const party = await partyFor(token);

  await declineAgreement({ agreementId, partyId: party.id });
  revalidatePath(`/portal/${token}/agreements/${agreementId}`);
}
