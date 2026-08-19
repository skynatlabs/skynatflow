"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { signIn } from "@/auth";

export async function signupAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!email || password.length < 8) {
    throw new Error("A valid email and a password of at least 8 characters are required.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing?.passwordHash) {
    // Already a real, claimed account — send them to login instead of
    // silently overwriting their password.
    throw new Error("An account with this email already exists — sign in instead.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    // Claiming an account that was created via a staff invite (email-only,
    // no password yet) — set the password rather than creating a duplicate.
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, name: name || existing.name },
    });
  } else {
    await prisma.user.create({ data: { email, name: name || undefined, passwordHash } });
  }

  await signIn("credentials", { email, password, redirect: false });
  redirect("/dashboard");
}
