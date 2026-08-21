"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { verifyTotp } from "@/lib/auth/totp";

export async function confirmTotpSetupAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Sign in required.");

  const secret = String(formData.get("secret") ?? "");
  const token = String(formData.get("token") ?? "").trim();

  if (!secret || !token || !verifyTotp(secret, token)) {
    throw new Error("That code didn't match — check your authenticator app and try again.");
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { totpSecret: secret, totpEnabled: true },
  });

  redirect("/account/security?enabled=1");
}

export async function disableTotpAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Sign in required.");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { totpSecret: null, totpEnabled: false },
  });

  redirect("/account/security?disabled=1");
}
