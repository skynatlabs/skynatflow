"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { issueSerials, voidSerial } from "@/lib/core/authenticity";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/authenticity`);
}

/**
 * Codes can be pasted in, or generated.
 *
 * Generated codes use crypto randomness rather than a counter: a sequential
 * code is one a counterfeiter can guess the next of, which makes the whole
 * scheme decorative.
 */
export async function issueCodesAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  const itemId = String(formData.get("itemId"));
  const pasted = String(formData.get("codes") ?? "")
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const generateCount = Math.min(2000, Math.max(0, Number(formData.get("generate") ?? 0)));
  const generated: string[] = [];
  if (generateCount > 0) {
    const { randomBytes } = await import("node:crypto");
    const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0, no I/1
    for (let i = 0; i < generateCount; i++) {
      const bytes = randomBytes(10);
      let code = "";
      for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
      generated.push(`${code.slice(0, 5)}-${code.slice(5)}`);
    }
  }

  const codes = [...pasted, ...generated];
  if (codes.length === 0) throw new Error("Give some codes, or say how many to generate.");

  const result = await issueSerials({ tenantId, itemId, codes });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "product:manage",
    targetType: "Item",
    targetId: itemId,
    metadata: { codesCreated: result.created },
  });

  refresh(tenantId);
}

/** Telling every buyer who checks to stop using the product. Audited. */
export async function withdrawCodeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  const code = String(formData.get("code") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const result = await voidSerial({ tenantId, code, reason });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "product:manage",
    targetType: "ProductSerial",
    targetId: code,
    metadata: { withdrawn: result.voided, reason },
  });

  refresh(tenantId);
}
