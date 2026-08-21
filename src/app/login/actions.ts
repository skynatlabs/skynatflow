"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const totpToken = String(formData.get("totpToken") ?? "").trim();

  try {
    const result = await signIn("credentials", { email, password, totpToken, redirect: false });
    console.log("[login] signIn result:", result);
  } catch (err) {
    console.error("[login] signIn threw:", err);
    if (err instanceof AuthError) {
      throw new Error("Incorrect email/password, or missing/wrong 2FA code.");
    }
    throw err;
  }

  redirect("/dashboard");
}
