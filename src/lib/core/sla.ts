// Speed-to-quote tracking — the research found the first contractor to
// respond wins 78-90% of jobs, and by 30 minutes most leads have already
// moved on. This flags any quote still sitting in DRAFT (not yet sent)
// past that window, so it surfaces before the job is lost, not after.

import { TransactionType, TransactionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface SlaBreach {
  id: string;
  partyId: string;
  partyName: string;
  amountCents: number;
  createdAt: Date;
  minutesWaiting: number;
}

export async function getQuoteSlaBreaches(
  tenantId: string,
  breachAfterMinutes = 30
): Promise<SlaBreach[]> {
  const cutoff = new Date(Date.now() - breachAfterMinutes * 60000);

  const drafts = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: TransactionType.QUOTE,
      status: TransactionStatus.DRAFT,
      createdAt: { lt: cutoff },
    },
    include: { party: true },
    orderBy: { createdAt: "asc" },
  });

  const now = Date.now();
  return drafts.map((d) => ({
    id: d.id,
    partyId: d.partyId,
    partyName: d.party.name,
    amountCents: d.amountCents,
    createdAt: d.createdAt,
    minutesWaiting: Math.floor((now - d.createdAt.getTime()) / 60000),
  }));
}
