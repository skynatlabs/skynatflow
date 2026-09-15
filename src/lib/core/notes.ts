// Generic notes, attachable to any record — same polymorphic pattern as
// comments.ts, kept as a separate model since notes and threaded comments
// serve different purposes (a note is a standalone written record, a
// comment is part of a conversation).
//
// A note is also how a small team hands work to each other. Most of what one
// person knows about a job ends up in a WhatsApp group where it cannot be
// found again; a note written on the workspace stays with it, and naming
// somebody in it tells them.

import { prisma } from "@/lib/db";
import { createNotification } from "./notifications2";

export interface AddNoteParams {
  tenantId: string;
  entityType: string;
  entityId?: string;
  authorId: string;
  title?: string;
  body: string;
  /** "team" — everyone sees it; "private" — only the author. */
  audience?: "team" | "private";
  /** Membership ids named in it. Each is told. */
  mentions?: string[];
  pinned?: boolean;
}

export async function addNote(params: AddNoteParams) {
  const mentions = [...new Set(params.mentions ?? [])];
  // Anybody named has to actually be on this workspace.
  const valid =
    mentions.length > 0
      ? (await prisma.membership.findMany({ where: { tenantId: params.tenantId, id: { in: mentions } }, select: { id: true } })).map((m) => m.id)
      : [];

  const note = await prisma.note.create({
    data: {
      tenantId: params.tenantId,
      entityType: params.entityType,
      entityId: params.entityId,
      authorId: params.authorId,
      title: params.title,
      body: params.body,
      audience: params.audience ?? "team",
      mentions: valid,
      pinned: params.pinned ?? false,
    },
  });

  if (valid.length > 0) {
    const author = await prisma.membership.findUnique({
      where: { id: params.authorId },
      select: { user: { select: { name: true, email: true } } },
    });
    const who = author?.user.name ?? author?.user.email ?? "Somebody";
    for (const membershipId of valid) {
      if (membershipId === params.authorId) continue;
      await createNotification({
        tenantId: params.tenantId,
        membershipId,
        type: "GENERAL",
        title: `${who} left you a note`,
        body: (params.title ? `${params.title} — ` : "") + params.body.slice(0, 300),
        linkHref: `/dashboard/${params.tenantId}/notes`,
      });
    }
  }

  return note;
}

export async function listNotes(tenantId: string, entityType: string, entityId?: string) {
  const notes = await prisma.note.findMany({
    where: { tenantId, entityType, entityId: entityId ?? undefined },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
  return withAuthors(tenantId, notes);
}

/**
 * The workspace's own notes board: what the team left for each other,
 * pinned first. A private note is only ever the author's.
 */
export async function listTeamNotes(tenantId: string, membershipId: string | null, take = 100) {
  const notes = await prisma.note.findMany({
    where: {
      tenantId,
      OR: [{ audience: "team" }, ...(membershipId ? [{ audience: "private", authorId: membershipId }] : [])],
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take,
  });
  return withAuthors(tenantId, notes);
}

export async function setNotePinned(tenantId: string, noteId: string, pinned: boolean) {
  const note = await prisma.note.findFirst({ where: { id: noteId, tenantId }, select: { id: true } });
  if (!note) throw new Error("That note is not in this workspace.");
  return prisma.note.update({ where: { id: noteId }, data: { pinned } });
}

export async function deleteNote(tenantId: string, noteId: string, membershipId: string | null) {
  const note = await prisma.note.findFirst({ where: { id: noteId, tenantId }, select: { id: true, authorId: true } });
  if (!note) throw new Error("That note is not in this workspace.");
  // A note is somebody's own writing: they take it back, nobody else does.
  if (membershipId && note.authorId !== membershipId) throw new Error("Only whoever wrote a note can delete it.");
  return prisma.note.delete({ where: { id: noteId } });
}

async function withAuthors<T extends { authorId: string; mentions: string[] }>(tenantId: string, notes: T[]) {
  const ids = [...new Set(notes.flatMap((n) => [n.authorId, ...n.mentions]))];
  const memberships = ids.length
    ? await prisma.membership.findMany({ where: { tenantId, id: { in: ids } }, include: { user: true } })
    : [];
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  return notes.map((n) => ({
    ...n,
    authorName: nameById.get(n.authorId) ?? "Someone",
    mentionNames: n.mentions.map((id) => nameById.get(id) ?? "Someone"),
  }));
}
