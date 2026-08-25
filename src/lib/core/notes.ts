// Generic notes, attachable to any record — same polymorphic pattern as
// comments.ts, kept as a separate model since notes and threaded comments
// serve different purposes (a note is a standalone written record, a
// comment is part of a conversation).

import { prisma } from "@/lib/db";

export async function addNote(params: {
  tenantId: string;
  entityType: string;
  entityId?: string;
  authorId: string;
  title?: string;
  body: string;
}) {
  return prisma.note.create({ data: params });
}

export async function listNotes(tenantId: string, entityType: string, entityId?: string) {
  const notes = await prisma.note.findMany({
    where: { tenantId, entityType, entityId: entityId ?? undefined },
    orderBy: { createdAt: "desc" },
  });
  const memberships = await prisma.membership.findMany({
    where: { id: { in: notes.map((n) => n.authorId) } },
    include: { user: true },
  });
  const authorById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  return notes.map((n) => ({ ...n, authorName: authorById.get(n.authorId) ?? "Someone" }));
}
