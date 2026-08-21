// Generic comment thread, attachable to any record by (entityType,
// entityId) — one implementation instead of a parallel comments table
// per entity kind.

import { prisma } from "@/lib/db";

export async function listComments(tenantId: string, entityType: string, entityId: string) {
  const comments = await prisma.comment.findMany({
    where: { tenantId, entityType, entityId },
    orderBy: { createdAt: "asc" },
  });
  const memberships = await prisma.membership.findMany({
    where: { id: { in: comments.map((c) => c.authorId) } },
    include: { user: true },
  });
  const authorById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  return comments.map((c) => ({ ...c, authorName: authorById.get(c.authorId) ?? "Someone" }));
}

export async function addComment(params: {
  tenantId: string;
  entityType: string;
  entityId: string;
  authorId: string;
  body: string;
}) {
  return prisma.comment.create({ data: params });
}
