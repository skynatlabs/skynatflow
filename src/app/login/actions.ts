"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { mayAttemptLogin, recordLoginOutcome } from "@/lib/rateLimit";
import { recordAuthEvent } from "@/lib/auth/events";

/**
 * Signing in, with the door held shut after enough wrong answers.
 *
 * The throttle lives here rather than inside the credentials provider so that
 * it applies to the attempt itself — the provider is only reached once the
 * form has been accepted, and by then the guess has already been made.
 *
 * Two properties are deliberate and easy to lose in a refactor:
 *
 *   THE MESSAGE NEVER SAYS WHICH PART WAS WRONG. Not whether the address
 *   exists, not whether it was the password or the 2FA code. Each of those is
 *   an oracle somebody can query.
 *
 *   A SUCCESS CLEARS THE COUNT. Otherwise a person who mistypes their
 *   password four times and then gets it right is still one slip from being
 *   locked out for a quarter of an hour, and the feature becomes the reason
 *   somebody cannot get into their own books.
 */
export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const totpToken = String(formData.get("totpToken") ?? "").trim();

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const userAgent = headerList.get("user-agent");

  const gate = await mayAttemptLogin({ email, ip });
  if (!gate.allowed) {
    await recordAuthEvent({ email, kind: "SIGNIN_BLOCKED", ip, userAgent });
    throw new Error(gate.message);
  }

  let signedIn = false;
  try {
    await signIn("credentials", { email, password, totpToken, redirect: false });
    signedIn = true;
  } catch (err) {
    if (!(err instanceof AuthError)) {
      // Not a refused credential — a configuration or provider failure.
      // Recording it as a failed guess would lock somebody out of their own
      // account because of our outage.
      throw err;
    }
  }

  await recordLoginOutcome({ email, ip, ok: signedIn });
  await recordAuthEvent({ email, kind: signedIn ? "SIGNIN_OK" : "SIGNIN_FAILED", ip, userAgent });
  if (!signedIn) throw new Error("Incorrect email/password, or missing/wrong 2FA code.");

  redirect("/dashboard");
}
