import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireTenantAccess, AuthRequiredError, ForbiddenError } from "@/lib/auth/tenant-access";
import { toCsv } from "@/lib/export/csv";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const capability = new URL(request.url).searchParams.get("capability");

  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) return new Response("Sign in required", { status: 401 });
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const entries = await prisma.auditLog.findMany({
    where: { tenantId, ...(capability ? { capability } : {}) },
    orderBy: { createdAt: "desc" },
  });

  const csv = toCsv(
    ["Timestamp", "Actor Type", "Actor ID", "Capability", "Target Type", "Target ID", "Metadata"],
    entries.map((e) => [
      e.createdAt.toISOString(),
      e.actorType,
      e.actorId,
      e.capability,
      e.targetType,
      e.targetId,
      e.metadata,
    ])
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log.csv"`,
    },
  });
}
