// What must happen before a job is done.
//
// In half the trades this list is the difference between work that passes an
// inspection and work that has to be redone — and it lives in one person's
// head, so when that person is off the job is done differently. Writing it
// down is not bureaucracy; it is the only way the tenth job is the same as
// the first.
//
// Two decisions that make the difference between a checklist people use and
// one they tick through:
//
//   ENFORCED IS A CHOICE. A list that blocks completion is right for a
//   compliance job and wrong for a tidy-up, and forcing one behaviour on both
//   means somebody ticks everything from the van to get out of the screen.
//
//   A PHOTOGRAPH WHERE IT MATTERS. An item that needs proof says so, and a
//   tick without the photograph does not count. Proof of work that can be
//   produced without doing the work is not proof.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface ChecklistItemInput {
  text: string;
  needsPhoto?: boolean;
}

/** What has been ticked on a job, kept on the job card rather than a table. */
interface TickRecord {
  itemId: string;
  at: string;
  byId?: string | null;
  photoUrl?: string | null;
}

export async function createChecklist(params: {
  tenantId: string;
  name: string;
  forWork?: string | null;
  enforced?: boolean;
  items: ChecklistItemInput[];
}) {
  if (!params.name.trim()) throw new Error("The checklist needs a name.");
  const items = params.items.filter((i) => i.text.trim());
  if (items.length === 0) throw new Error("A checklist with nothing on it is not a checklist.");

  return prisma.checklist.create({
    data: {
      tenantId: params.tenantId,
      name: params.name.trim(),
      forWork: params.forWork?.trim() || null,
      enforced: params.enforced ?? true,
      items: {
        create: items.map((item, sortOrder) => ({
          text: item.text.trim(),
          needsPhoto: Boolean(item.needsPhoto),
          sortOrder,
        })),
      },
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function listChecklists(tenantId: string) {
  return prisma.checklist.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: "asc" },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function retireChecklist(tenantId: string, checklistId: string) {
  const list = await prisma.checklist.findFirst({ where: { id: checklistId, tenantId }, select: { id: true } });
  if (!list) throw new Error("That checklist is not in this workspace.");
  // Retired rather than deleted: jobs already done against it still point at
  // it, and a job whose checklist vanished cannot be audited.
  return prisma.checklist.update({ where: { id: checklistId }, data: { isActive: false } });
}

export async function attachChecklist(params: { tenantId: string; jobCardId: string; checklistId: string | null }) {
  const job = await prisma.jobCard.findFirst({ where: { id: params.jobCardId, tenantId: params.tenantId }, select: { id: true } });
  if (!job) throw new Error("That job is not in this workspace.");
  if (params.checklistId) {
    const list = await prisma.checklist.findFirst({
      where: { id: params.checklistId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!list) throw new Error("That checklist is not in this workspace.");
  }
  return prisma.jobCard.update({ where: { id: params.jobCardId }, data: { checklistId: params.checklistId } });
}

function ticksOn(notes: string | null): TickRecord[] {
  if (!notes) return [];
  const marker = notes.indexOf("\n---checklist---\n");
  if (marker === -1) return [];
  try {
    const parsed = JSON.parse(notes.slice(marker + "\n---checklist---\n".length));
    return Array.isArray(parsed) ? (parsed as TickRecord[]) : [];
  } catch {
    return [];
  }
}

function withTicks(notes: string | null, ticks: TickRecord[]): string {
  const marker = "\n---checklist---\n";
  const base = notes ? (notes.includes(marker) ? notes.slice(0, notes.indexOf(marker)) : notes) : "";
  return `${base}${marker}${JSON.stringify(ticks)}`;
}

export interface ChecklistProgress {
  checklistId: string;
  name: string;
  enforced: boolean;
  items: Array<{
    id: string;
    text: string;
    needsPhoto: boolean;
    done: boolean;
    photoUrl: string | null;
    at: Date | null;
  }>;
  doneCount: number;
  total: number;
  /** What is stopping this job being marked done. Empty when nothing is. */
  outstanding: string[];
}

export async function checklistProgress(tenantId: string, jobCardId: string): Promise<ChecklistProgress | null> {
  const job = await prisma.jobCard.findFirst({
    where: { id: jobCardId, tenantId },
    include: { checklist: { include: { items: { orderBy: { sortOrder: "asc" } } } } },
  });
  if (!job?.checklist) return null;

  const ticks = ticksOn(job.notes);
  const items = job.checklist.items.map((item) => {
    const tick = ticks.find((t) => t.itemId === item.id);
    // A tick without the photograph it required does not count. Proof that
    // can be produced without doing the work is not proof.
    const done = Boolean(tick) && (!item.needsPhoto || Boolean(tick?.photoUrl));
    return {
      id: item.id,
      text: item.text,
      needsPhoto: item.needsPhoto,
      done,
      photoUrl: tick?.photoUrl ?? null,
      at: tick ? new Date(tick.at) : null,
    };
  });

  return {
    checklistId: job.checklist.id,
    name: job.checklist.name,
    enforced: job.checklist.enforced,
    items,
    doneCount: items.filter((i) => i.done).length,
    total: items.length,
    outstanding: items
      .filter((i) => !i.done)
      .map((i) => (i.needsPhoto && ticks.some((t) => t.itemId === i.id) ? `${i.text} — needs a photograph` : i.text)),
  };
}

export async function tickItem(params: {
  tenantId: string;
  jobCardId: string;
  itemId: string;
  photoUrl?: string | null;
  byId?: string | null;
  at?: Date;
}) {
  const job = await prisma.jobCard.findFirst({
    where: { id: params.jobCardId, tenantId: params.tenantId },
    select: { id: true, notes: true, checklistId: true },
  });
  if (!job) throw new Error("That job is not in this workspace.");
  if (!job.checklistId) throw new Error("There is no checklist on that job.");

  const item = await prisma.checklistItem.findFirst({
    where: { id: params.itemId, checklistId: job.checklistId },
    select: { id: true, needsPhoto: true, text: true },
  });
  if (!item) throw new Error("That item is not on this job's checklist.");
  if (item.needsPhoto && !params.photoUrl) throw new Error(`"${item.text}" needs a photograph.`);

  const ticks = ticksOn(job.notes).filter((t) => t.itemId !== params.itemId);
  ticks.push({
    itemId: params.itemId,
    at: (params.at ?? new Date()).toISOString(),
    byId: params.byId ?? null,
    photoUrl: params.photoUrl ?? null,
  });

  await prisma.jobCard.update({ where: { id: job.id }, data: { notes: withTicks(job.notes, ticks) } });
  return checklistProgress(params.tenantId, params.jobCardId);
}

export async function untickItem(params: { tenantId: string; jobCardId: string; itemId: string }) {
  const job = await prisma.jobCard.findFirst({
    where: { id: params.jobCardId, tenantId: params.tenantId },
    select: { id: true, notes: true },
  });
  if (!job) throw new Error("That job is not in this workspace.");
  const ticks = ticksOn(job.notes).filter((t) => t.itemId !== params.itemId);
  await prisma.jobCard.update({ where: { id: job.id }, data: { notes: withTicks(job.notes, ticks) } });
  return checklistProgress(params.tenantId, params.jobCardId);
}

/**
 * May this job be marked done?
 *
 * The one question the whole feature exists to answer, and the reason it is
 * a separate call: completion happens from several places — the job page, the
 * phone, the agent — and each of them has to ask the same thing.
 */
export async function mayComplete(tenantId: string, jobCardId: string): Promise<{ allowed: boolean; reason: string }> {
  const progress = await checklistProgress(tenantId, jobCardId);
  if (!progress) return { allowed: true, reason: "No checklist on this job." };
  if (!progress.enforced) {
    return {
      allowed: true,
      reason:
        progress.outstanding.length === 0
          ? "Everything on the checklist is done."
          : `${progress.outstanding.length} still outstanding, but this checklist does not block completion.`,
    };
  }
  if (progress.outstanding.length === 0) return { allowed: true, reason: "Everything on the checklist is done." };
  return {
    allowed: false,
    reason: `Still outstanding: ${progress.outstanding.slice(0, 4).join("; ")}${progress.outstanding.length > 4 ? `, and ${progress.outstanding.length - 4} more` : ""}.`,
  };
}

/** Jobs where the checklist is the thing holding completion up. */
export async function blockedByChecklist(tenantId: string) {
  const jobs = await prisma.jobCard.findMany({
    where: { tenantId, checklistId: { not: null }, status: { not: "DONE" } },
    select: { id: true, title: true, party: { select: { name: true, companyName: true } } },
    take: 100,
  });

  const out: Array<{ jobCardId: string; title: string; customer: string; outstanding: string[] }> = [];
  for (const job of jobs) {
    const progress = await checklistProgress(tenantId, job.id);
    if (progress && progress.enforced && progress.outstanding.length > 0) {
      out.push({
        jobCardId: job.id,
        title: job.title,
        customer: job.party.companyName ?? job.party.name,
        outstanding: progress.outstanding,
      });
    }
  }
  return out;
}

/** Starting points, so nobody faces a blank list. */
export const CHECKLIST_LIBRARY: Array<{ name: string; forWork: string; items: ChecklistItemInput[] }> = [
  {
    name: "Electrical installation",
    forWork: "electrical",
    items: [
      { text: "Isolate and lock off the supply" },
      { text: "Earth continuity tested and recorded" },
      { text: "Insulation resistance tested and recorded" },
      { text: "Polarity checked at every point" },
      { text: "Earth leakage tripped and timed" },
      { text: "Photograph the distribution board", needsPhoto: true },
      { text: "Certificate of compliance issued" },
      { text: "Site left clean and the customer shown the work", needsPhoto: true },
    ],
  },
  {
    name: "Plumbing callout",
    forWork: "plumbing",
    items: [
      { text: "Water isolated before starting" },
      { text: "Photograph the fault before working on it", needsPhoto: true },
      { text: "Replacement parts listed on the job" },
      { text: "Pressure tested and held" },
      { text: "Photograph the finished work", needsPhoto: true },
      { text: "No leaks after ten minutes running" },
      { text: "Customer shown the work and signed off" },
    ],
  },
  {
    name: "Vehicle service",
    forWork: "fleet",
    items: [
      { text: "Odometer reading recorded" },
      { text: "Oil and filter changed" },
      { text: "Brakes and tyres inspected" },
      { text: "Lights and indicators checked" },
      { text: "Photograph the odometer and the service sticker", needsPhoto: true },
      { text: "Next service date set" },
    ],
  },
  {
    name: "Delivery and install",
    forWork: "delivery",
    items: [
      { text: "Everything on the delivery note checked off" },
      { text: "Photograph the goods on site before unpacking", needsPhoto: true },
      { text: "Installed, tested and working" },
      { text: "Packaging removed" },
      { text: "Customer signature on the delivery note" },
    ],
  },
];

/** Put a starting point on a workspace, once. */
export async function adoptFromLibrary(tenantId: string, name: string) {
  const template = CHECKLIST_LIBRARY.find((t) => t.name === name);
  if (!template) throw new Error("There is no such checklist in the library.");
  const existing = await prisma.checklist.findFirst({ where: { tenantId, name: template.name }, select: { id: true } });
  if (existing) return prisma.checklist.update({ where: { id: existing.id }, data: { isActive: true } });
  return createChecklist({ tenantId, name: template.name, forWork: template.forWork, items: template.items });
}

/** The raw ticks, for anything that needs them without the shaping. */
export function readTicks(notes: string | null): Prisma.JsonValue {
  return ticksOn(notes) as unknown as Prisma.JsonValue;
}
