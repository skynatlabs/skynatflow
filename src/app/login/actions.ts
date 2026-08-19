"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  try {
    const result = await signIn("credentials", { email, password, redirect: false });
    console.log("[login] signIn result:", result);
  } catch (err) {
    console.error("[login] signIn threw:", err);
    if (err instanceof AuthError) {
      throw new Error(`Incorrect email or password. (${err.type})`);
    }
    throw err;
  }

  redirect("/dashboard");
}
