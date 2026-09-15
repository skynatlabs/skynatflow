// The copy of the records offered on the way out.
//
// Deliberately only here, in the closing flow: this is not a feature for
// moving a business's data around day to day, it is what a business is
// entitled to keep when it leaves. The owner only, and the whole workspace
// in one file.

import { notFound } from "next/navigation";
import { requireTenantAccess, AuthRequiredError, ForbiddenError } from "@/lib/auth/tenant-access";
import { recordsArchive } from "@/lib/core/accountClosure";
import { recordAudit } from "@/lib/core/audit";

export async function GET(_request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  let access;
  try {
    access = await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) return new Response("Sign in required", { status: 401 });
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
  if (access.role !== "OWNER") notFound();

  const { fileName, data } = await recordsArchive(tenantId);
  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "Tenant",
    targetId: tenantId,
    metadata: { records: "downloaded", bytes: data.length },
  });

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(data.length),
    },
  });
}
