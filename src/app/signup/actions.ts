"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { signIn } from "@/auth";
import { consume } from "@/lib/rateLimit";
import { recordAuthEvent } from "@/lib/auth/events";

export async function signupAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!email || password.length < 8) {
    throw new Error("A valid email and a password of at least 8 characters are required.");
  }

  // Signing up is the cheapest way to make us do work — create rows, send
  // mail, provision a workspace — so it is limited by address. Generous
  // enough that a family or an office behind one connection is unaffected,
  // tight enough that a script is not.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (ip) {
    const verdict = await consume({ bucket: `signup:ip:${ip}`, limit: 5, windowSeconds: 60 * 60 });
    if (!verdict.allowed) {
      throw new Error("That is a lot of new accounts from one place. Try again a little later.");
    }
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

  await recordAuthEvent({ email, kind: "SIGNUP", ip });
  await signIn("credentials", { email, password, redirect: false });
  // Straight into setting up: a new account has no workspace to land in, and
  // the dashboard would only bounce them here anyway.
  redirect("/onboarding");
}
