// What somebody leaves behind.
//
// The premise of most handover checklists is that the person leaving will
// write down what they knew. They will not — they are leaving, often on bad
// terms, and the things that matter are exactly the ones they never thought
// to mention because to them they were obvious.
//
// So this is assembled from what they actually touched, not from what they
// remember: the equipment still in their name, the customers only they have
// spoken to, the jobs still open on them, the leave already approved past
// their last day. Everything here is a query over data the business already
// has, which is why it can be produced on the day somebody resigns rather
// than during a fortnight of goodwill nobody has.

import { prisma } from "@/lib/db";
import { assetsHeldBy } from "./assets";
import { formatMoney } from "@/lib/format/money";
import { tenantCurrency } from "./currency";

export interface HandoverItem {
  kind: "asset" | "customer" | "job" | "quote" | "leave" | "record";
  id: string;
  label: string;
  detail: string | null;
  /** True where this genuinely blocks their departure rather than merely informing it. */
  blocking: boolean;
}

export interface HandoverPack {
  membershipId: string;
  name: string;
  role: string;
  items: HandoverItem[];
  blockingCount: number;
  summary: string;
  /** What this cannot see. Stated so the pack is not mistaken for exhaustive. */
  caveats: string[];
}

/**
 * Build the pack.
 *
 * `since` bounds the customer and quote lookups: somebody who has been here
 * four years has touched almost everything, and a handover listing four
 * hundred customers is a handover nobody reads. The last six months is what
 * is actually still live.
 */
export async function buildHandoverPack(params: {
  tenantId: string;
  membershipId: string;
  since?: Date;
}): Promise<HandoverPack> {
  const membership = await prisma.membership.findUnique({
    where: { id: params.membershipId },
    include: { user: { select: { name: true, email: true } } },
  });
  const currency = await tenantCurrency(params.tenantId);

  if (!membership || membership.tenantId !== params.tenantId) {
    throw new Error("Team member not found.");
  }

  const since =
    params.since ?? new Date(Date.now() - 182 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [assets, quotes, jobs, leave, records] = await Promise.all([
    assetsHeldBy(params.tenantId, params.membershipId),

    // Documents attributed to them. These carry the customer relationships
    // that would otherwise walk out of the door unremarked.
    prisma.transaction.findMany({
      where: {
        tenantId: params.tenantId,
        salesPersonMembershipId: params.membershipId,
        createdAt: { gte: since },
        status: { notIn: ["CANCELLED", "DECLINED"] },
      },
      select: {
        id: true,
        type: true,
        status: true,
        amountCents: true,
        party: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),

    prisma.task.findMany({
      where: {
        tenantId: params.tenantId,
        assigneeId: params.membershipId,
        status: { not: "DONE" },
      },
      select: { id: true, title: true, status: true },
      take: 100,
    }),

    prisma.leaveRequest.findMany({
      where: {
        tenantId: params.tenantId,
        membershipId: params.membershipId,
        status: { in: ["APPROVED", "REQUESTED"] },
        endOn: { gte: now },
      },
      select: { id: true, kind: true, startOn: true, endOn: true, days: true, status: true },
    }),

    prisma.employmentRecord.count({
      where: { tenantId: params.tenantId, membershipId: params.membershipId },
    }),
  ]);

  const items: HandoverItem[] = [];

  // Equipment blocks. It is the thing that actually goes missing.
  for (const a of assets) {
    items.push({
      kind: "asset",
      id: a.id,
      label: a.name,
      detail: [a.category, a.serial].filter(Boolean).join(" · ") || null,
      blocking: true,
    });
  }

  // Open money. A quote nobody picks up is a sale lost silently.
  const openQuotes = quotes.filter(
    (q) => q.type === "QUOTE" && ["SENT", "DRAFT"].includes(q.status)
  );
  for (const q of openQuotes) {
    items.push({
      kind: "quote",
      id: q.id,
      label: `Open quote — ${q.party.name}`,
      detail: `${formatMoney(q.amountCents, currency)}, ${q.status.toLowerCase()}`,
      blocking: true,
    });
  }

  // Customers they are the only point of contact for, which is the knowledge
  // that is genuinely theirs rather than the company's.
  const customerIds = [...new Set(quotes.map((q) => q.party.id))];
  if (customerIds.length > 0) {
    const others = await prisma.transaction.groupBy({
      by: ["partyId"],
      where: {
        tenantId: params.tenantId,
        partyId: { in: customerIds },
        salesPersonMembershipId: { not: params.membershipId },
      },
      _count: { _all: true },
    });
    const touchedByOthers = new Set(others.map((o) => o.partyId));

    for (const id of customerIds) {
      if (touchedByOthers.has(id)) continue;
      const name = quotes.find((q) => q.party.id === id)!.party.name;
      items.push({
        kind: "customer",
        id,
        label: name,
        detail: "Nobody else here has dealt with them",
        blocking: false,
      });
    }
  }

  for (const j of jobs) {
    items.push({
      kind: "job",
      id: j.id,
      label: j.title,
      detail: `Still ${j.status.toLowerCase().replace(/_/g, " ")}`,
      blocking: true,
    });
  }

  for (const l of leave) {
    items.push({
      kind: "leave",
      id: l.id,
      label: `${l.days} day${l.days === 1 ? "" : "s"} ${l.kind.toLowerCase()} leave`,
      detail: `${l.startOn.toISOString().slice(0, 10)} to ${l.endOn.toISOString().slice(0, 10)}, ${l.status.toLowerCase()}`,
      blocking: false,
    });
  }

  if (records > 0) {
    items.push({
      kind: "record",
      id: params.membershipId,
      label: `${records} employment record${records === 1 ? "" : "s"} on file`,
      detail: "Contracts, warnings and reviews — keep these after they go",
      blocking: false,
    });
  }

  const blockingCount = items.filter((i) => i.blocking).length;
  const name = membership.user?.name ?? membership.user?.email ?? "This person";

  return {
    membershipId: params.membershipId,
    name,
    role: membership.role,
    items,
    blockingCount,
    summary: summarise(name, assets.length, openQuotes.length, jobs.length),
    caveats: [
      `Documents and customers are from the last ${Math.round(
        (now.getTime() - since.getTime()) / (30 * 86_400_000)
      )} months — anything older is assumed to have moved on already.`,
      "Only work attributed to them is visible. Anything they did under somebody else's name, or outside the app entirely, is not here.",
    ],
  };
}

function summarise(name: string, assets: number, quotes: number, jobs: number): string {
  const parts: string[] = [];
  if (assets > 0) parts.push(`${assets} piece${assets === 1 ? "" : "s"} of equipment`);
  if (quotes > 0) parts.push(`${quotes} open quote${quotes === 1 ? "" : "s"}`);
  if (jobs > 0) parts.push(`${jobs} unfinished job${jobs === 1 ? "" : "s"}`);

  if (parts.length === 0) return `${name} has nothing outstanding to hand over.`;
  return `${name} still has ${parts.join(", ")}.`;
}
