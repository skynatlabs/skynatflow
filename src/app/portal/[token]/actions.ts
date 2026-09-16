"use server";

// What the customer can do from their own link.
//
// The token in the form is the whole credential and the only thing trusted
// here: every action re-resolves it server-side, and nothing takes a party or
// a tenant from the request. Nothing a customer sends changes the books — it
// lands as something a person answers.

import { revalidatePath } from "next/cache";
import { submitDetails, submitMessage, submitPaymentProof } from "@/lib/core/portal";

export async function paymentProofAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  await submitPaymentProof({
    token,
    transactionId: String(formData.get("transactionId") ?? "") || null,
    note: String(formData.get("note") ?? ""),
    fileName: String(formData.get("fileName") ?? "") || null,
    fileDataUrl: String(formData.get("fileDataUrl") ?? "") || null,
  });
  revalidatePath(`/portal/${token}`);
}

export async function messageAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  await submitMessage({
    token,
    body: String(formData.get("body") ?? ""),
    transactionId: String(formData.get("transactionId") ?? "") || null,
  });
  revalidatePath(`/portal/${token}`);
}

export async function detailsAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  await submitDetails({
    token,
    name: String(formData.get("name") ?? ""),
    companyName: String(formData.get("companyName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    addressLine: String(formData.get("addressLine") ?? ""),
    vatNumber: String(formData.get("vatNumber") ?? ""),
  });
  revalidatePath(`/portal/${token}`);
}
