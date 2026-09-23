// Giving points away, and getting people back.
//
// Loyalty is the cheapest thing on this list to build and the easiest to
// build uselessly. The useless version is a card nobody carries, a number
// nobody can find at the till, and a points balance the customer has to ask
// about. Every one of those is a reason the scheme enrols nobody.
//
// So three decisions shape this module, and all three are about the counter
// rather than the database:
//
//   IDENTITY IS THE PHONE NUMBER. Not a card, not an app, not an email. It
//   is what the customer already knows, what the till already asks for, and
//   what WhatsApp already reaches. A scheme keyed on anything else is a
//   scheme that depends on the customer preparing for the transaction.
//
//   ENROLMENT IS AUTOMATIC. If a sale has a customer with a phone number and
//   the programme says so, they are a member. Asking a queue of four people
//   whether they would like to join is where loyalty schemes go to die.
//
//   POINTS ARE A LIABILITY WITH A STATEMENT. Every movement is an entry, the
//   balance is maintained in the same transaction as the entry that moved
//   it, and the two are checkable against each other. A balance that can
//   only be asserted and never reconstructed is a number a business will
//   eventually have to defend to a customer with nothing to defend it with.
//
// What this deliberately does not do: tiers. A tier is a marketing idea that
// needs a business to have enough members for a tier to mean something, and
// a workspace on its first hundred customers is better served by "who has
// not been back" than by a bronze badge.

import { LoyaltyEntryKind, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** The shared walk-in record is not a person and must never accrue points. */
const WALK_IN_NAME = "Walk-in customer";

export interface LoyaltyProgramInput {
  name?: string;
  isActive?: boolean;
  earnPointsPerUnit?: number;
  redeemCentsPerPoint?: number;
  minRedeemPoints?: number;
  expireAfterDays?: number | null;
  autoEnrol?: boolean;
}

/**
 * The programme, or null if this workspace has never set one up.
 *
 * Null rather than a default object, because "no programme" and "a programme
 * with default settings" are different things at a till: one earns nothing.
 */
export async function getLoyaltyProgram(tenantId: string) {
  return prisma.loyaltyProgram.findUnique({ where: { tenantId } });
}

export async function saveLoyaltyProgram(tenantId: string, input: LoyaltyProgramInput) {
  const clean = {
    ...(input.name !== undefined ? { name: input.name.trim().slice(0, 60) || "Rewards" } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.earnPointsPerUnit !== undefined
      ? { earnPointsPerUnit: Math.max(0, Math.round(input.earnPointsPerUnit)) }
      : {}),
    ...(input.redeemCentsPerPoint !== undefined
      ? { redeemCentsPerPoint: Math.max(1, Math.round(input.redeemCentsPerPoint)) }
      : {}),
    ...(input.minRedeemPoints !== undefined
      ? { minRedeemPoints: Math.max(0, Math.round(input.minRedeemPoints)) }
      : {}),
    ...(input.expireAfterDays !== undefined
      ? {
          expireAfterDays:
            input.expireAfterDays === null ? null : Math.max(30, Math.round(input.expireAfterDays)),
        }
      : {}),
    ...(input.autoEnrol !== undefined ? { autoEnrol: input.autoEnrol } : {}),
  };

  return prisma.loyaltyProgram.upsert({
    where: { tenantId },
    create: { tenantId, ...clean },
    update: clean,
  });
}

/**
 * Make somebody a member.
 *
 * Idempotent: enrolling twice returns the existing account rather than
 * resetting a balance, which is what a till operator pressing the button
 * again actually means.
 */
export async function enrolMember(params: { tenantId: string; partyId: string }) {
  const party = await prisma.party.findFirst({
    where: { id: params.partyId, tenantId: params.tenantId },
    select: { id: true, name: true },
  });
  if (!party) throw new Error("Customer not found.");
  if (party.name === WALK_IN_NAME) {
    throw new Error("The walk-in record is shared by every anonymous sale and cannot be a member.");
  }

  return prisma.loyaltyAccount.upsert({
    where: { tenantId_partyId: { tenantId: params.tenantId, partyId: params.partyId } },
    create: { tenantId: params.tenantId, partyId: params.partyId },
    update: {},
    include: { party: { select: { name: true, phone: true } } },
  });
}

/** Look a member up the way a till does: by the number they read out. */
export async function findMemberByPhone(tenantId: string, phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;

  // Match on the last nine digits so 072 123 4567, +27 72 123 4567 and
  // 27721234567 are the same customer — which at a counter they are.
  const tail = digits.slice(-9);
  const parties = await prisma.party.findMany({
    where: { tenantId, phone: { not: null } },
    select: { id: true, name: true, phone: true },
    take: 500,
  });
  const match = parties.find((p) => (p.phone ?? "").replace(/\D/g, "").endsWith(tail));
  if (!match) return null;

  const account = await prisma.loyaltyAccount.findUnique({
    where: { tenantId_partyId: { tenantId, partyId: match.id } },
  });
  return { party: match, account };
}

export interface EarnResult {
  enrolled: boolean;
  pointsEarned: number;
  balance: number;
  /** Said plainly when nothing happened, so a caller never has to guess. */
  reason?: string;
}

/**
 * Credit points for a sale.
 *
 * Called from the till after the sale is recorded, never before: points for
 * a sale that failed to post are points a business cannot explain. Returns
 * rather than throws when there is no programme, because a shop without
 * loyalty must still be able to sell things.
 */
export async function earnOnSale(params: {
  tenantId: string;
  partyId: string;
  amountCents: number;
  transactionId?: string;
}): Promise<EarnResult> {
  const program = await getLoyaltyProgram(params.tenantId);
  if (!program || !program.isActive) {
    return { enrolled: false, pointsEarned: 0, balance: 0, reason: "No active rewards programme." };
  }
  if (params.amountCents <= 0) {
    return { enrolled: false, pointsEarned: 0, balance: 0, reason: "Nothing was spent." };
  }

  const party = await prisma.party.findFirst({
    where: { id: params.partyId, tenantId: params.tenantId },
    select: { id: true, name: true, phone: true },
  });
  if (!party || party.name === WALK_IN_NAME) {
    return {
      enrolled: false,
      pointsEarned: 0,
      balance: 0,
      reason: "An anonymous sale has nobody to credit.",
    };
  }

  let account = await prisma.loyaltyAccount.findUnique({
    where: { tenantId_partyId: { tenantId: params.tenantId, partyId: party.id } },
  });

  let enrolled = false;
  if (!account) {
    // The whole point of auto-enrolment: a member without a reachable number
    // can never be told they have points, so there is nothing to earn yet.
    if (!program.autoEnrol || !party.phone) {
      return {
        enrolled: false,
        pointsEarned: 0,
        balance: 0,
        reason: party.phone
          ? "Automatic enrolment is off and this customer has not joined."
          : "No phone number on this customer, so nothing could reach them.",
      };
    }
    account = await prisma.loyaltyAccount.create({
      data: { tenantId: params.tenantId, partyId: party.id },
    });
    enrolled = true;
  }

  // Floor rather than round: a business should never owe more points than
  // the money spent justifies, and rounding up across a year of small
  // baskets is a liability nobody decided to take on.
  const points = Math.floor((params.amountCents / 100) * program.earnPointsPerUnit);
  if (points <= 0) {
    return {
      enrolled,
      pointsEarned: 0,
      balance: account.pointsBalance,
      reason: "The basket was too small to earn a whole point.",
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.loyaltyEntry.create({
      data: {
        tenantId: params.tenantId,
        accountId: account.id,
        kind: LoyaltyEntryKind.EARNED,
        points,
        transactionId: params.transactionId ?? null,
      },
    });
    return tx.loyaltyAccount.update({
      where: { id: account.id },
      data: {
        pointsBalance: { increment: points },
        lifetimePointsEarned: { increment: points },
        lifetimeSpendCents: { increment: params.amountCents },
        lastActivityAt: new Date(),
      },
    });
  });

  return { enrolled, pointsEarned: points, balance: updated.pointsBalance };
}

export interface RedeemResult {
  ok: boolean;
  pointsUsed: number;
  discountCents: number;
  balance: number;
  error?: string;
}

/**
 * Spend points.
 *
 * Returns a discount in cents; it does not apply one. The caller decides
 * what a discount means on its document, and a module that reached into the
 * ledger from here would be a second path to changing what a customer owes.
 */
export async function redeemPoints(params: {
  tenantId: string;
  partyId: string;
  points: number;
  transactionId?: string;
}): Promise<RedeemResult> {
  const program = await getLoyaltyProgram(params.tenantId);
  if (!program || !program.isActive) {
    return { ok: false, pointsUsed: 0, discountCents: 0, balance: 0, error: "No active rewards programme." };
  }

  const account = await prisma.loyaltyAccount.findUnique({
    where: { tenantId_partyId: { tenantId: params.tenantId, partyId: params.partyId } },
  });
  if (!account) {
    return { ok: false, pointsUsed: 0, discountCents: 0, balance: 0, error: "This customer is not a member." };
  }

  const points = Math.floor(params.points);
  if (points <= 0) {
    return { ok: false, pointsUsed: 0, discountCents: 0, balance: account.pointsBalance, error: "No points given." };
  }
  if (points < program.minRedeemPoints) {
    return {
      ok: false,
      pointsUsed: 0,
      discountCents: 0,
      balance: account.pointsBalance,
      error: `The smallest redemption is ${program.minRedeemPoints} points.`,
    };
  }
  if (points > account.pointsBalance) {
    return {
      ok: false,
      pointsUsed: 0,
      discountCents: 0,
      balance: account.pointsBalance,
      error: `They have ${account.pointsBalance} points, not ${points}.`,
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.loyaltyEntry.create({
      data: {
        tenantId: params.tenantId,
        accountId: account.id,
        kind: LoyaltyEntryKind.REDEEMED,
        points: -points,
        transactionId: params.transactionId ?? null,
      },
    });
    return tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { decrement: points }, lastActivityAt: new Date() },
    });
  });

  return {
    ok: true,
    pointsUsed: points,
    discountCents: points * program.redeemCentsPerPoint,
    balance: updated.pointsBalance,
  };
}

/** A correction, with a reason, because an unexplained adjustment is a hole. */
export async function adjustPoints(params: {
  tenantId: string;
  partyId: string;
  points: number;
  note: string;
}) {
  const note = params.note.trim();
  if (!note) throw new Error("An adjustment needs a reason.");

  const account = await prisma.loyaltyAccount.findUnique({
    where: { tenantId_partyId: { tenantId: params.tenantId, partyId: params.partyId } },
  });
  if (!account) throw new Error("This customer is not a member.");

  const points = Math.round(params.points);
  if (points === 0) throw new Error("An adjustment of nothing changes nothing.");
  if (account.pointsBalance + points < 0) {
    throw new Error(`That would take them below zero — they have ${account.pointsBalance}.`);
  }

  return prisma.$transaction(async (tx) => {
    await tx.loyaltyEntry.create({
      data: {
        tenantId: params.tenantId,
        accountId: account.id,
        kind: LoyaltyEntryKind.ADJUSTED,
        points,
        note: note.slice(0, 300),
      },
    });
    return tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { increment: points }, lastActivityAt: new Date() },
    });
  });
}

export interface MemberRow {
  partyId: string;
  name: string;
  phone: string | null;
  pointsBalance: number;
  lifetimeSpendCents: number;
  lastActivityAt: Date | null;
  daysSinceLastActivity: number | null;
}

function toRow(
  a: Prisma.LoyaltyAccountGetPayload<{ include: { party: { select: { name: true; phone: true } } } }>,
  now: Date
): MemberRow {
  return {
    partyId: a.partyId,
    name: a.party.name,
    phone: a.party.phone,
    pointsBalance: a.pointsBalance,
    lifetimeSpendCents: a.lifetimeSpendCents,
    lastActivityAt: a.lastActivityAt,
    daysSinceLastActivity: a.lastActivityAt
      ? Math.floor((now.getTime() - a.lastActivityAt.getTime()) / 86_400_000)
      : null,
  };
}

/** Who spends the most. The list a business wants before it runs a promotion. */
export async function topMembers(tenantId: string, limit = 25): Promise<MemberRow[]> {
  const now = new Date();
  const rows = await prisma.loyaltyAccount.findMany({
    where: { tenantId },
    orderBy: { lifetimeSpendCents: "desc" },
    take: Math.min(limit, 200),
    include: { party: { select: { name: true, phone: true } } },
  });
  return rows.map((r) => toRow(r, now));
}

/**
 * Who has stopped coming.
 *
 * The single most valuable list a retailer has and the one nobody keeps: a
 * customer who used to come weekly and has not been in for two months has
 * not churned quietly, they have gone somewhere else, and they are reachable
 * on a number the business already holds.
 */
export async function lapsedMembers(
  tenantId: string,
  afterDays = 60,
  limit = 50,
  now = new Date()
): Promise<MemberRow[]> {
  const cutoff = new Date(now.getTime() - afterDays * 86_400_000);
  const rows = await prisma.loyaltyAccount.findMany({
    where: { tenantId, lastActivityAt: { not: null, lt: cutoff } },
    orderBy: { lifetimeSpendCents: "desc" },
    take: Math.min(limit, 200),
    include: { party: { select: { name: true, phone: true } } },
  });
  return rows.map((r) => toRow(r, now));
}

export interface LoyaltySummary {
  active: boolean;
  members: number;
  pointsOutstanding: number;
  /** What the outstanding points would cost if everybody redeemed tomorrow. */
  liabilityCents: number;
  lapsed: number;
  summary: string;
}

/** The headline, including the part a business would rather not think about. */
export async function loyaltySummary(tenantId: string, now = new Date()): Promise<LoyaltySummary> {
  const program = await getLoyaltyProgram(tenantId);
  if (!program) {
    return {
      active: false,
      members: 0,
      pointsOutstanding: 0,
      liabilityCents: 0,
      lapsed: 0,
      summary: "No rewards programme has been set up.",
    };
  }

  const cutoff = new Date(now.getTime() - 60 * 86_400_000);
  const [members, totals, lapsed] = await Promise.all([
    prisma.loyaltyAccount.count({ where: { tenantId } }),
    prisma.loyaltyAccount.aggregate({ where: { tenantId }, _sum: { pointsBalance: true } }),
    prisma.loyaltyAccount.count({ where: { tenantId, lastActivityAt: { not: null, lt: cutoff } } }),
  ]);

  const outstanding = totals._sum.pointsBalance ?? 0;
  const liability = outstanding * program.redeemCentsPerPoint;

  return {
    active: program.isActive,
    members,
    pointsOutstanding: outstanding,
    liabilityCents: liability,
    lapsed,
    summary: program.isActive
      ? `${members} member${members === 1 ? "" : "s"}, ${outstanding} points outstanding` +
        (lapsed > 0 ? `, ${lapsed} who have not been back in two months.` : ".")
      : "The rewards programme is switched off.",
  };
}

/** The statement behind one balance. */
export async function memberHistory(tenantId: string, partyId: string, limit = 50) {
  const account = await prisma.loyaltyAccount.findUnique({
    where: { tenantId_partyId: { tenantId, partyId } },
    include: { party: { select: { name: true, phone: true } } },
  });
  if (!account) return null;

  const entries = await prisma.loyaltyEntry.findMany({
    // The account was already resolved against the tenant, so this is belt
    // and braces — but a statement of somebody's points is exactly the read
    // that must never be able to cross a workspace by accident.
    where: { accountId: account.id, tenantId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });

  return {
    name: account.party.name,
    phone: account.party.phone,
    pointsBalance: account.pointsBalance,
    lifetimeSpendCents: account.lifetimeSpendCents,
    joinedAt: account.joinedAt,
    entries,
  };
}

/**
 * Expire what has gone stale.
 *
 * Driven by the cron, never by a page. Writes an EXPIRED entry for the whole
 * balance rather than ageing points individually: a business that expires on
 * inactivity is saying "you stopped coming", not "these particular points
 * are old", and the simpler rule is the one a customer can be told.
 */
export async function expireStalePoints(tenantId: string, now = new Date()): Promise<number> {
  const program = await getLoyaltyProgram(tenantId);
  if (!program || !program.isActive || !program.expireAfterDays) return 0;

  const cutoff = new Date(now.getTime() - program.expireAfterDays * 86_400_000);
  const stale = await prisma.loyaltyAccount.findMany({
    where: { tenantId, pointsBalance: { gt: 0 }, lastActivityAt: { not: null, lt: cutoff } },
    select: { id: true, pointsBalance: true },
    take: 500,
  });

  for (const account of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.loyaltyEntry.create({
        data: {
          tenantId,
          accountId: account.id,
          kind: LoyaltyEntryKind.EXPIRED,
          points: -account.pointsBalance,
          note: `No activity for ${program.expireAfterDays} days.`,
        },
      });
      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { pointsBalance: 0 },
      });
    });
  }

  return stale.length;
}

/**
 * The nightly sweep, across every workspace that asked for one.
 *
 * Bounded by the programmes that actually set an expiry, which is a small
 * set by design: the default is never, and a business has to choose to take
 * points back. A workspace that never chose is never scanned.
 */
export async function expireStalePointsEverywhere(now = new Date()): Promise<{
  workspaces: number;
  accounts: number;
}> {
  const programs = await prisma.loyaltyProgram.findMany({
    where: { isActive: true, expireAfterDays: { not: null } },
    select: { tenantId: true },
    take: 500,
  });

  let accounts = 0;
  for (const program of programs) {
    accounts += await expireStalePoints(program.tenantId, now).catch(() => 0);
  }
  return { workspaces: programs.length, accounts };
}
