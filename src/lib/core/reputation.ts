// What people say about the business afterwards.
//
// Reviews are the only marketing a small service business gets for free, and
// almost none of them ask. The ones that do ask, ask badly — a bulk request
// to everybody on the list, three months after the work, which reads as a
// favour being asked rather than a job well done being acknowledged.
//
// Two things make the difference and both are about timing and honesty:
//
//   ASK THE RIGHT PERSON AT THE RIGHT MOMENT. The hour after an invoice is
//   paid is when somebody is most pleased with you, and a customer who has
//   just disputed something is not somebody to ask at all. The list here is
//   filtered on both.
//
//   NEVER WRITE THE REVIEW. Drafting a reply to a review is helping; drafting
//   the review is fraud, it is against every platform's terms, and it is the
//   single fastest way to have a business's listing removed. Nothing here
//   will produce review text, and it says so rather than quietly not doing it.

import { prisma } from "@/lib/db";

export interface AskCandidate {
  partyId: string;
  name: string;
  email: string | null;
  phone: string | null;
  invoiceId: string;
  paidAt: Date;
  amountCents: number;
  /** Why this one and not another. */
  why: string;
}

/**
 * Who to ask, and when.
 *
 * The window is deliberately narrow. Somebody paid this morning is delighted;
 * somebody paid five weeks ago has forgotten, and asking them produces
 * nothing except a slightly worse relationship.
 */
export async function worthAsking(params: { tenantId: string; withinDays?: number; now?: Date }): Promise<{
  candidates: AskCandidate[];
  skipped: Array<{ name: string; why: string }>;
  note: string;
}> {
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - (params.withinDays ?? 7) * 86_400_000);

  const paid = await prisma.transaction.findMany({
    where: {
      tenantId: params.tenantId,
      type: "INVOICE",
      status: "PAID",
      reviewRequestSentAt: null,
      children: { some: { type: "PAYMENT", createdAt: { gte: since } } },
    },
    include: {
      party: { select: { id: true, name: true, companyName: true, email: true, phone: true } },
      children: { where: { type: "PAYMENT" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const candidates: AskCandidate[] = [];
  const skipped: Array<{ name: string; why: string }> = [];

  for (const invoice of paid) {
    const name = invoice.party.companyName ?? invoice.party.name;
    const paidAt = invoice.children[0]?.createdAt;
    if (!paidAt) continue;

    // Somebody in the middle of an argument is not somebody to ask, and
    // asking them is how a three-star review gets written.
    const dispute = await prisma.dispute.count({
      where: { tenantId: params.tenantId, partyId: invoice.party.id, status: { not: "RESOLVED" } },
    }).catch(() => 0);
    if (dispute > 0) {
      skipped.push({ name, why: "There is an unresolved dispute with them. Asking now invites the review nobody wants." });
      continue;
    }

    // Somebody already asked this quarter has been asked enough.
    const askedRecently = await prisma.transaction.count({
      where: {
        tenantId: params.tenantId,
        partyId: invoice.party.id,
        reviewRequestSentAt: { gte: new Date(now.getTime() - 90 * 86_400_000) },
      },
    });
    if (askedRecently > 0) {
      skipped.push({ name, why: "Asked within the last three months. Twice is a nag." });
      continue;
    }

    if (!invoice.party.email && !invoice.party.phone) {
      skipped.push({ name, why: "No email address and no phone number, so there is no way to ask." });
      continue;
    }

    const hours = Math.round((now.getTime() - paidAt.getTime()) / 3600_000);
    candidates.push({
      partyId: invoice.party.id,
      name,
      email: invoice.party.email,
      phone: invoice.party.phone,
      invoiceId: invoice.id,
      paidAt,
      amountCents: invoice.amountCents,
      why:
        hours <= 24
          ? "Paid today. This is the hour they are most pleased with you."
          : `Paid ${Math.round(hours / 24)} days ago, and still well inside the window where they remember the job.`,
    });
  }

  return {
    candidates,
    skipped,
    note:
      candidates.length === 0
        ? "Nobody to ask this week. That usually means nothing has been paid recently rather than anything being wrong."
        : `${candidates.length} ${candidates.length === 1 ? "customer" : "customers"} worth asking, ${skipped.length} deliberately left out.`,
  };
}

export type ReviewTone = "grateful" | "professional" | "brief";

/**
 * A reply to a review somebody left.
 *
 * Fixed wording rather than generated, for the same reason the collections
 * ladder is: a reply that reads as machine-written is worse than no reply,
 * and a business's public voice is not a thing to hand to a model without
 * somebody reading it first. These are starting points that get edited.
 */
export function draftReply(params: { stars: number; reviewerName?: string | null; about?: string | null; tone?: ReviewTone }): {
  text: string;
  advice: string[];
} {
  const who = params.reviewerName?.trim() ? params.reviewerName.trim().split(" ")[0] : null;
  const opening = who ? `${who}, ` : "";

  if (params.stars >= 4) {
    return {
      text:
        `${opening}thank you — that is good to hear, and I will pass it on to the team who did the work. ` +
        `If you need anything else, you know where we are.`,
      advice: [
        "Reply to good reviews too. A listing where the owner answers everything reads as a business that is paying attention.",
        "Keep it short. A long reply to a short compliment looks like marketing.",
      ],
    };
  }

  if (params.stars === 3) {
    return {
      text:
        `${opening}thank you for taking the time. It sounds like we got some of this right and not all of it, ` +
        `and I would like to know which part so we can fix it. Could you give me a call?`,
      advice: [
        "A three-star review is the one most worth answering: the person is telling you something specific and is not yet angry.",
        "Ask them to take it off the review and onto a call. Nothing is settled in public.",
      ],
    };
  }

  return {
    text:
      `${opening}I am sorry — that is not the job we set out to do${params.about ? ` on the ${params.about}` : ""}. ` +
      `I would like to put it right. Please call me directly and I will deal with it myself.`,
    advice: [
      "Answer within a day. A complaint with no reply reads as a business that does not care; a complaint with a same-day reply reads as one that does.",
      "Do not argue the facts in public, even when you are right. Everybody reading it takes the customer's side by default.",
      "Offer a way to continue it privately, and then actually do.",
    ],
  };
}

/**
 * How the business is doing at asking.
 *
 * Deliberately measures the asking rather than the rating: the rating is
 * mostly outside anybody's control, and the number of people asked is
 * entirely within it.
 */
export async function reputationHealth(tenantId: string, since: Date) {
  const [paid, asked, tenant] = await Promise.all([
    prisma.transaction.count({ where: { tenantId, type: "INVOICE", status: "PAID", createdAt: { gte: since } } }),
    prisma.transaction.count({ where: { tenantId, type: "INVOICE", reviewRequestSentAt: { gte: since } } }),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { googleReviewUrl: true } }),
  ]);

  const share = paid > 0 ? Math.round((asked / paid) * 100) : 0;

  const advice: string[] = [];
  if (!tenant.googleReviewUrl) {
    advice.push("No review link is set, so nothing can be asked for. It takes two minutes to find on your Google listing and it is the single highest-return thing on this page.");
  } else if (share < 30 && paid > 3) {
    advice.push(`Only ${share}% of paid jobs were asked. Most businesses that get reviews simply ask more often than the ones that do not.`);
  }
  advice.push("Nothing here will write a review for you. Drafting a reply is helping; drafting the review is fraud, and it is the fastest way to have a listing removed.");

  return {
    paid,
    asked,
    sharePercent: share,
    hasLink: Boolean(tenant.googleReviewUrl),
    advice,
    note:
      paid === 0
        ? "Nothing has been paid in this period, so there is nobody to have asked."
        : `${asked} of ${paid} paid jobs were asked for a review.`,
  };
}
