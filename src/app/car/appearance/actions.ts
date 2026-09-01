"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { setPlatformColorSkin } from "@/lib/ai/model";

export async function setColorSkinAction(formData: FormData) {
  await requireSuperAdmin();
  const skin = String(formData.get("skin") ?? "");
  if (skin !== "default" && skin !== "sunset") {
    throw new Error("Unknown skin.");
  }
  await setPlatformColorSkin(skin);
  revalidatePath("/car/appearance");
}
