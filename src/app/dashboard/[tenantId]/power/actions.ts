"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { setSchedule, type Stage } from "@/lib/core/loadShedding";

export async function saveScheduleAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  // Each day comes in as a pair of time fields; a day with neither filled in
  // is a day with no load-shedding rather than a validation error, because
  // most businesses only know two or three of their blocks.
  const blocks: Array<{ day: number; from: string; to: string }> = [];
  for (let day = 0; day <= 6; day++) {
    for (const slot of [1, 2, 3]) {
      const from = String(formData.get(`from-${day}-${slot}`) ?? "").trim();
      const to = String(formData.get(`to-${day}-${slot}`) ?? "").trim();
      if (from && to) blocks.push({ day, from, to });
    }
  }

  await setSchedule({
    tenantId,
    areaLabel: String(formData.get("areaLabel") ?? "").trim() || null,
    stage: (Number(formData.get("stage") ?? 0) || 0) as Stage,
    blocks,
  });

  revalidatePath(`/dashboard/${tenantId}/power`);
  revalidatePath(`/dashboard/${tenantId}/dispatch`);
}
