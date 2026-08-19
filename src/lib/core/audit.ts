import { prisma } from "@/lib/db";
import type { Capability } from "./access";

export async function recordAudit(params: {
  tenantId: string;
  actorType: "user" | "ai" | "system";
  actorId?: string;
  capability: Capability;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorType: params.actorType,
      actorId: params.actorId,
      capability: params.capability,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    },
  });
}
