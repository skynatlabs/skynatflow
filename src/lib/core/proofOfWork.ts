// Proving the work was done.
//
// Almost every dispute a service business has is the same dispute: the
// customer says it was not done, or not done properly, or not done on the day
// they were billed for. The business knows it was. Neither can show anything,
// so the business discounts the invoice to keep the relationship, and does it
// again the next month.
//
// What settles it is not a photograph. It is a photograph with a time, a
// place and a person attached, taken before anybody knew there would be an
// argument. So the pack is assembled as the work happens — before, after,
// where, when, who, and a signature — and none of it is asked for again
// afterwards, because a photograph produced after a complaint proves nothing.
//
// The honest limit, stated on the pack itself: a phone's location is what the
// phone reported. It is good evidence and it is not proof, and a pack that
// claimed otherwise would fall apart the first time somebody tested it.

import { prisma } from "@/lib/db";

export type ProofKind = "before" | "after" | "detail" | "signature" | "document";

export const PROOF_LABEL: Record<ProofKind, string> = {
  before: "Before",
  after: "After",
  detail: "Detail",
  signature: "Signed for",
  document: "Document",
};

export interface ProofItem {
  kind: ProofKind;
  /** The picture itself, as it was captured. */
  dataUrl: string;
  at: Date;
  /** Where the phone said it was. Evidence, not proof. */
  lat: number | null;
  lng: number | null;
  /** Who took it. */
  by: string | null;
  note: string | null;
}

/**
 * Proof is stored on the job card's notes after a marker, the same pattern
 * checklists use.
 *
 * A table would be tidier and would also be a migration, a relation, an
 * export entry and a deletion path for something that is, in the end, a list
 * attached to one job. When proof starts being searched across jobs it earns
 * a table; until then this keeps it beside the thing it belongs to.
 */
const MARKER = "\n---proof---\n";

function readProof(notes: string | null): ProofItem[] {
  if (!notes) return [];
  const index = notes.indexOf(MARKER);
  if (index < 0) return [];
  try {
    const parsed = JSON.parse(notes.slice(index + MARKER.length)) as Array<Omit<ProofItem, "at"> & { at: string }>;
    return parsed.map((item) => ({ ...item, at: new Date(item.at) }));
  } catch {
    // Corrupt proof is not worth throwing over — the job still has to open.
    return [];
  }
}

function writeProof(notes: string | null, items: ProofItem[]): string {
  const before = notes ? notes.split(MARKER)[0] : "";
  return `${before}${MARKER}${JSON.stringify(items)}`;
}

export async function addProof(params: {
  tenantId: string;
  jobCardId: string;
  kind: ProofKind;
  dataUrl: string;
  at?: Date;
  lat?: number | null;
  lng?: number | null;
  by?: string | null;
  note?: string | null;
}): Promise<{ items: number }> {
  if (!params.dataUrl.startsWith("data:image/")) {
    throw new Error("Proof has to be a picture. A description is a note, which is a different thing.");
  }

  const job = await prisma.jobCard.findFirst({
    where: { id: params.jobCardId, tenantId: params.tenantId },
    select: { id: true, notes: true, siteLat: true, siteLng: true },
  });
  if (!job) throw new Error("That job is not in this workspace.");

  const items = readProof(job.notes);
  items.push({
    kind: params.kind,
    dataUrl: params.dataUrl,
    // The moment it was taken, which on a phone that has been out of signal
    // is not the moment it arrives here.
    at: params.at ?? new Date(),
    lat: params.lat ?? null,
    lng: params.lng ?? null,
    by: params.by ?? null,
    note: params.note ?? null,
  });

  await prisma.jobCard.update({ where: { id: job.id }, data: { notes: writeProof(job.notes, items) } });
  return { items: items.length };
}

/** How far the phone was from where the job is, in metres. */
export function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export interface ProofPack {
  jobId: string;
  title: string;
  customer: string;
  where: string | null;
  completedAt: Date | null;
  items: ProofItem[];
  /** Whether the pack would actually settle an argument. */
  strength: "strong" | "partial" | "thin";
  /** What is missing, so somebody can go and get it while they are still there. */
  missing: string[];
  /** What this does and does not prove. */
  standing: string[];
}

/**
 * The pack, as somebody would hand it to a customer who is disputing.
 *
 * Its strength is stated rather than implied: a pack with an after photo and
 * nothing else is thin, and telling the business that while the technician is
 * still on site is worth more than a green tick afterwards.
 */
export async function proofPack(tenantId: string, jobCardId: string): Promise<ProofPack | null> {
  const job = await prisma.jobCard.findFirst({
    where: { id: jobCardId, tenantId },
    include: { party: { select: { name: true, companyName: true, addressLine: true } } },
  });
  if (!job) return null;

  const items = readProof(job.notes).sort((a, b) => a.at.getTime() - b.at.getTime());
  const kinds = new Set(items.map((item) => item.kind));

  const missing: string[] = [];
  if (!kinds.has("before")) missing.push("A photograph before the work started. Without one there is nothing to compare the after to.");
  if (!kinds.has("after")) missing.push("A photograph of the finished work.");
  if (!kinds.has("signature")) missing.push("Somebody on site signing for it.");
  if (items.every((item) => item.lat === null)) missing.push("Nothing carries a location, so the pack cannot show where the work happened.");

  const strength = kinds.has("before") && kinds.has("after") && kinds.has("signature") ? "strong" : kinds.has("after") ? "partial" : "thin";

  const standing = [
    "Each picture carries the moment it was taken on the phone, which is not the moment it reached the system — the first is what matters.",
    "A location is what the phone reported. That is good evidence and it is not proof, and a pack claiming otherwise would fall apart the first time somebody tested it.",
  ];

  // Anything taken a long way from where the job is, said plainly rather than
  // hidden — because the business would rather find out than be shown it by a
  // customer.
  if (job.siteLat !== null && job.siteLng !== null) {
    const far = items.filter(
      (item) => item.lat !== null && item.lng !== null && metresApart({ lat: job.siteLat!, lng: job.siteLng! }, { lat: item.lat, lng: item.lng }) > 500,
    );
    if (far.length > 0) {
      standing.push(`${far.length} ${far.length === 1 ? "picture was" : "pictures were"} taken more than 500 m from where this job is recorded. Worth knowing before a customer points it out.`);
    }
  }

  return {
    jobId: job.id,
    title: job.title,
    customer: job.party?.companyName ?? job.party?.name ?? "No customer",
    where: job.siteAddress ?? job.party?.addressLine ?? null,
    completedAt: job.completedAt,
    items,
    strength,
    missing,
    standing,
  };
}

/**
 * Jobs closed without enough to defend them.
 *
 * The list a business should look at once a week, because every row on it is
 * an invoice that will be discounted if anybody argues.
 */
export async function undefendedJobs(tenantId: string, since: Date) {
  const jobs = await prisma.jobCard.findMany({
    where: { tenantId, status: "DONE", completedAt: { gte: since } },
    select: { id: true, title: true, notes: true, completedAt: true, party: { select: { name: true, companyName: true } } },
    orderBy: { completedAt: "desc" },
    take: 200,
  });

  const rows = jobs
    .map((job) => {
      const kinds = new Set(readProof(job.notes).map((item) => item.kind));
      const has = kinds.size;
      return {
        id: job.id,
        title: job.title,
        customer: job.party?.companyName ?? job.party?.name ?? "No customer",
        completedAt: job.completedAt,
        evidence: has,
        why: !kinds.has("after")
          ? "No photograph of the finished work at all."
          : !kinds.has("signature")
            ? "Nobody signed for it."
            : null,
      };
    })
    .filter((row) => row.why !== null);

  return {
    rows,
    note:
      rows.length === 0
        ? "Every job closed in this period has enough behind it to defend the invoice."
        : `${rows.length} ${rows.length === 1 ? "job was" : "jobs were"} closed without enough to settle an argument. Each one is an invoice that gets discounted if anybody pushes.`,
  };
}
