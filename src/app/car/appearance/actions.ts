"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { setPlatformColorSkin, type ColorSkin } from "@/lib/ai/model";

const VALID_SKINS: ColorSkin[] = ["default", "sunset", "professional", "creative", "futuristic"];

export async function setColorSkinAction(formData: FormData) {
  await requireSuperAdmin();
  const skin = String(formData.get("skin") ?? "");
  if (!VALID_SKINS.includes(skin as ColorSkin)) {
    throw new Error("Unknown skin.");
  }
  await setPlatformColorSkin(skin as ColorSkin);
  revalidatePath("/car/appearance");
}
