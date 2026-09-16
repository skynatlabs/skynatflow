// The people who bring other businesses here.
//
// A small business does not choose its business software. Its bookkeeper
// does, its accountant does, or the person who set up its website does — and
// those people each look after between ten and two hundred businesses. One
// bookkeeper who moves their book across is worth more than a year of
// advertising, and they will only do it if the product is better for *them*,
// not only for their clients.
//
// So a partner is not a referral link. It is somebody who works across many
// workspaces every day and needs: one place to see all of them, an honest
// answer to "which of my clients is about to be in trouble", and a share of
// what they bring in. The first two are what keeps them; the third is what
// gets their attention.
//
// The privacy line, which is the whole difficulty: a partner sees only the
// workspaces that have accepted them, and what they see is exactly what their
// membership allows — no more. There is no partner back door. A partner
// looking at a client's books is doing it through an ordinary membership on
// that workspace, which the client can revoke without asking anybody.

import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";

export type PartnerKind = "bookkeeper" | "accountant" | "consultant" | "reseller" | "developer";

export const PARTNER_KIND: Record<PartnerKind, { label: string; what: string }> = {
  bookkeeper: { label: "Bookkeeper", what: "Keeps the books for several businesses, month in and month out." },
  accountant: { label: "Accountant", what: "Does the year end and the tax, and is asked which software to use." },
  consultant: { label: "Business consultant", what: "Comes in to fix something and needs to see what is actually happening." },
  reseller: { label: "Reseller", what: "Sells this under their own name, to their own clients." },
  developer: { label: "Developer or agency", what: "Builds on the API, or sets it up for clients." },
};

/** What a partner earns, and for how long. */
export const COMMISSION = {
  percent: 20,
  months: 12,
  note: "20% of what a workspace pays, for its first twelve months. Recurring rather than a one-off, because a partner who is paid once has no reason to make sure their client stays.",
};

function newCode(): string {
  // Short enough to say down a phone, long enough not to be guessed at.
  return randomBytes(4).toString("hex").toUpperCase();
}

export async function createPartner(params: {
  ownerUserId: string;
  firmName: string;
  kind: PartnerKind;
  contactEmail: string;
}) {
  const name = params.firmName.trim();
  if (!name) throw new Error("The firm needs a name.");

  // Retried rather than assumed unique: an eight-character code will collide
  // eventually, and finding out through a constraint error at sign-up is a
  // partner's first impression.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const taken = await prisma.partner.findUnique({ where: { code } });
    if (taken) continue;
    return prisma.partner.create({
      data: { ownerUserId: params.ownerUserId, firmName: name, kind: params.kind, contactEmail: params.contactEmail.trim(), code },
    });
  }
  throw new Error("Could not make a code for this firm. Try again.");
}

export async function partnerByCode(code: string) {
  return prisma.partner.findUnique({ where: { code: code.trim().toUpperCase() } });
}

/**
 * Attach a workspace to the partner who brought it.
 *
 * Only ever at sign-up, and only once. A code applied later would let anybody
 * claim a business that was already here, which is the fraud every referral
 * scheme eventually meets.
 */
export async function attributeSignup(params: { tenantId: string; code: string }) {
  const partner = await partnerByCode(params.code);
  if (!partner) throw new Error("That partner code is not one we know.");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { referredByCode: true, createdAt: true } });
  if (tenant.referredByCode) throw new Error("This workspace already has a partner.");

  const ageDays = (Date.now() - tenant.createdAt.getTime()) / 86_400_000;
  if (ageDays > 30) {
    throw new Error("This workspace is more than a month old. A partner code only attaches at sign-up, so that nobody can claim a business that was already here.");
  }

  return prisma.tenant.update({ where: { id: params.tenantId }, data: { referredByCode: partner.code } });
}

export interface ClientRow {
  tenantId: string;
  name: string;
  /** Whether this partner can actually open it. */
  hasAccess: boolean;
  /** Only ever filled in where there is access. */
  attention: string[];
  since: Date;
  /** Whether the commission window is still open. */
  earning: boolean;
}

/**
 * The partner's book.
 *
 * Two different lists that look like one: workspaces that came through this
 * partner's code, and workspaces where this partner holds a membership. They
 * overlap but neither contains the other — a referred client may never grant
 * access, and a client they look after may have found the product alone.
 */
export async function partnerBook(partnerId: string, now = new Date()): Promise<{ clients: ClientRow[]; note: string }> {
  const partner = await prisma.partner.findUniqueOrThrow({ where: { id: partnerId } });

  const [referred, memberships] = await Promise.all([
    prisma.tenant.findMany({ where: { referredByCode: partner.code }, select: { id: true, name: true, createdAt: true } }),
    prisma.membership.findMany({
      where: { userId: partner.ownerUserId },
      select: { tenantId: true, tenant: { select: { id: true, name: true, createdAt: true } } },
    }),
  ]);

  const accessible = new Set(memberships.map((membership) => membership.tenantId));
  const byId = new Map<string, { id: string; name: string; createdAt: Date }>();
  for (const tenant of referred) byId.set(tenant.id, tenant);
  for (const membership of memberships) byId.set(membership.tenant.id, membership.tenant);

  const clients: ClientRow[] = [];
  for (const tenant of byId.values()) {
    const hasAccess = accessible.has(tenant.id);
    const months = (now.getTime() - tenant.createdAt.getTime()) / (30 * 86_400_000);

    clients.push({
      tenantId: tenant.id,
      name: tenant.name,
      hasAccess,
      // Nothing about a workspace this partner cannot open. There is no
      // partner back door: what they see is what their membership allows.
      attention: hasAccess ? await attentionFor(tenant.id, now) : [],
      since: tenant.createdAt,
      earning: referred.some((row) => row.id === tenant.id) && months <= COMMISSION.months,
    });
  }

  clients.sort((a, b) => b.attention.length - a.attention.length || a.name.localeCompare(b.name));

  const noAccess = clients.filter((client) => !client.hasAccess).length;
  return {
    clients,
    note:
      noAccess > 0
        ? `${noAccess} of these have not given you access, so nothing about them is shown. Ask them to add you as a member — they can take it away again at any time without asking anybody.`
        : "Everything here is seen through your own membership on each workspace, which the client can revoke at any time.",
  };
}

/**
 * What a bookkeeper would want flagged before they open the file.
 *
 * Chosen to be the things that cost their client money if nobody notices,
 * rather than the things that are merely untidy.
 */
async function attentionFor(tenantId: string, now: Date): Promise<string[]> {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [unreconciled, uncoded, overdue, vatDue] = await Promise.all([
    prisma.bankTransaction.count({ where: { bankAccount: { tenantId }, matchedEntryId: null } }).catch(() => 0),
    prisma.expense.count({ where: { tenantId, accountId: null, category: null, status: { notIn: ["REJECTED", "DUPLICATE"] } } }),
    prisma.transaction.count({ where: { tenantId, type: "INVOICE", status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, dueAt: { lt: monthAgo } } }),
    prisma.vatReturn.count({ where: { tenantId, status: "DRAFT" } }).catch(() => 0),
  ]);

  const rows: string[] = [];
  if (unreconciled > 20) rows.push(`${unreconciled} bank lines not matched to anything.`);
  if (uncoded > 10) rows.push(`${uncoded} costs with no account on them.`);
  if (overdue > 0) rows.push(`${overdue} ${overdue === 1 ? "invoice is" : "invoices are"} over a month past due.`);
  if (vatDue > 0) rows.push(`${vatDue} VAT ${vatDue === 1 ? "return" : "returns"} still in draft.`);
  return rows;
}

/**
 * What a partner is owed.
 *
 * Deliberately says "would be" rather than "is": nothing here pays anybody,
 * and a figure presented as a balance when there is no payment run behind it
 * is the kind of promise that ends a partnership.
 */
export async function partnerEarnings(partnerId: string, now = new Date()) {
  const partner = await prisma.partner.findUniqueOrThrow({ where: { id: partnerId } });
  const referred = await prisma.tenant.findMany({
    where: { referredByCode: partner.code },
    select: { id: true, name: true, createdAt: true, monthlyFeeCents: true },
  });

  let monthlyCents = 0;
  const rows = referred.map((tenant) => {
    const months = Math.floor((now.getTime() - tenant.createdAt.getTime()) / (30 * 86_400_000));
    const withinWindow = months < COMMISSION.months;
    const fee = tenant.monthlyFeeCents ?? 0;
    const share = withinWindow ? Math.round((fee * COMMISSION.percent) / 100) : 0;
    monthlyCents += share;
    return {
      name: tenant.name,
      monthsIn: months,
      monthsLeft: Math.max(0, COMMISSION.months - months),
      monthlyShareCents: share,
      note: withinWindow ? null : "Past the twelve months.",
    };
  });

  return {
    clients: rows.length,
    earningNow: rows.filter((row) => row.monthlyShareCents > 0).length,
    monthlyCents,
    rows,
    terms: COMMISSION.note,
    caveat:
      "This is what the share works out at on today's fees. Nothing is paid from here — it is the figure, not a balance.",
  };
}
