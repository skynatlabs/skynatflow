"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { markErrorHandled } from "@/lib/errors";

export async function markErrorHandledAction(formData: FormData) {
  await requireSuperAdmin();
  await markErrorHandled(String(formData.get("id") ?? ""));
  revalidatePath("/car/errors");
}
