// The credit notebook, kept properly.
//
// A spaza owner, a hardware counter, a salon: they sell on credit all day,
// write it in a book, and that book is the business's largest asset and its
// least protected one. It gets wet, it gets lost, and the entries nobody can
// read become money nobody collects.
//
// The obvious mistake here is to build a second ledger — a "khata balance"
// living beside the real one. Two sets of books is the oldest accounting
// failure there is, and the version where a machine keeps one of them is not
// an improvement. So this is not a ledger. It is a CAPTURE MODE over the one
// that already exists:
//
//   A credit sale is an unpaid invoice with one line.
//   A repayment is a payment, allocated oldest first.
//   The book is the customer balance query the rest of the app already uses.
//
// Everything a shop does here therefore shows up in the books, the VAT
// return, the collections ladder and the statements, without anybody having
// to reconcile a notebook to an accounting system at the end of the month.
//
// Two decisions worth stating because they look like shortcuts and are not:
//
//   ONE HIDDEN CATALOGUE ITEM. A line needs an item, and a shop selling
//   "bread, R12" does not want a catalogue row per entry. So every khata
//   line hangs off a single per-workspace item and the real words live on
//   the line's description, where a document already prints them.
//
//   OLDEST FIRST, ALWAYS. "Thandi paid fifty" has to land somewhere. Oldest
//   debt first is the rule every shopkeeper already uses, it is the one that
//   keeps ageing honest, and a customer can be told it in one sentence.

import { TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordPayment, customerBalances } from "./money";

/** The name the hidden line-item carries, so it is recognisable in a report. */
const KHATA_ITEM_NAME = "Goods on credit";

/**
 * The one item every credit line hangs off.
 *
 * Priced at zero and inactive: it must never appear in the catalogue picker
 * or be sellable on its own — it exists so a line has something to point at.
 */
async function khataItem(tenantId: string): Promise<string> {
  const existing = await prisma.item.findFirst({
    where: { tenantId, name: KHATA_ITEM_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.item.create({
    data: {
      tenantId,
      name: KHATA_ITEM_NAME,
      unitPriceCents: 0,
      isActive: false,
      description: "Entries written straight into the credit book.",
    },
  });
  return created.id;
}

/**
 * Find who they mean, or add them.
 *
 * Matching is on the last nine digits of a phone number first, then on an
 * exact trimmed name, because at a counter the number is the identity and
 * the spelling of a name is not.
 */
export async function findOrAddCustomer(params: {
  tenantId: string;
  name: string;
  phone?: string | null;
}): Promise<{ id: string; name: string; created: boolean }> {
  const name = params.name.trim();
  if (!name) throw new Error("Who is it for?");

  const digits = (params.phone ?? "").replace(/\D/g, "");
  if (digits.length >= 6) {
    const tail = digits.slice(-9);
    const withPhone = await prisma.party.findMany({
      where: { tenantId: params.tenantId, phone: { not: null } },
      select: { id: true, name: true, phone: true },
      take: 500,
    });
    const hit = withPhone.find((p) => (p.phone ?? "").replace(/\D/g, "").endsWith(tail));
    if (hit) return { id: hit.id, name: hit.name, created: false };
  }

  const byName = await prisma.party.findFirst({
    where: { tenantId: params.tenantId, name, role: "CUSTOMER" },
    select: { id: true, name: true },
  });
  if (byName) return { ...byName, created: false };

  const created = await prisma.party.create({
    data: {
      tenantId: params.tenantId,
      role: "CUSTOMER",
      name,
      phone: params.phone?.trim() || null,
    },
    select: { id: true, name: true },
  });
  return { ...created, created: true };
}

export interface CreditSaleResult {
  invoiceId: string;
  partyId: string;
  customerName: string;
  customerAdded: boolean;
  amountCents: number;
  balanceCents: number;
}

/**
 * "Thandi took bread, fifty rand."
 *
 * One call from one line of speech or typing. The result carries their whole
 * balance back, because that is the number the shopkeeper says out loud next.
 */
export async function recordCreditSale(params: {
  tenantId: string;
  partyId?: string;
  customerName?: string;
  phone?: string | null;
  description: string;
  amountCents: number;
}): Promise<CreditSaleResult> {
  const amountCents = Math.round(params.amountCents);
  if (amountCents <= 0) throw new Error("A credit entry has to be for more than nothing.");

  const description = params.description.trim().slice(0, 200);
  if (!description) throw new Error("What did they take?");

  let partyId = params.partyId ?? null;
  let customerName = "";
  let customerAdded = false;

  if (partyId) {
    const party = await prisma.party.findFirst({
      where: { id: partyId, tenantId: params.tenantId },
      select: { id: true, name: true },
    });
    if (!party) throw new Error("Customer not found.");
    customerName = party.name;
  } else {
    const resolved = await findOrAddCustomer({
      tenantId: params.tenantId,
      name: params.customerName ?? "",
      phone: params.phone,
    });
    partyId = resolved.id;
    customerName = resolved.name;
    customerAdded = resolved.created;
  }

  const itemId = await khataItem(params.tenantId);

  // SENT, not DRAFT: the goods have left the shelf. A draft would keep it
  // out of every balance the business relies on, which is precisely the
  // notebook problem this replaces.
  const invoice = await prisma.transaction.create({
    data: {
      tenantId: params.tenantId,
      partyId,
      type: TransactionType.INVOICE,
      status: TransactionStatus.SENT,
      amountCents,
      itemLines: {
        create: [{ itemId, quantity: 1, unitPriceCents: amountCents, description }],
      },
    },
    select: { id: true },
  });

  const balances = await customerBalances(params.tenantId, partyId);

  return {
    invoiceId: invoice.id,
    partyId,
    customerName,
    customerAdded,
    amountCents,
    balanceCents: Math.round(balances.get(partyId) ?? amountCents),
  };
}

export interface RepaymentResult {
  partyId: string;
  customerName: string;
  paidCents: number;
  /** What could not be allocated because they owed less than they handed over. */
  unallocatedCents: number;
  balanceCents: number;
  settled: string[];
}

/**
 * "Thandi paid thirty."
 *
 * Allocated oldest first across everything still owing. Anything left over
 * is reported rather than parked somewhere invisible: a customer who
 * overpays has given the shop money it has to account for, and a silent
 * credit balance is how that gets forgotten.
 */
export async function recordRepayment(params: {
  tenantId: string;
  partyId: string;
  amountCents: number;
}): Promise<RepaymentResult> {
  const amount = Math.round(params.amountCents);
  if (amount <= 0) throw new Error("A repayment has to be for more than nothing.");

  const party = await prisma.party.findFirst({
    where: { id: params.partyId, tenantId: params.tenantId },
    select: { id: true, name: true },
  });
  if (!party) throw new Error("Customer not found.");

  const invoices = await prisma.transaction.findMany({
    where: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      type: TransactionType.INVOICE,
      status: { notIn: [TransactionStatus.CANCELLED, TransactionStatus.DRAFT] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, amountCents: true, children: { select: { type: true, amountCents: true } } },
    take: 500,
  });

  let left = amount;
  const settled: string[] = [];

  for (const invoice of invoices) {
    if (left <= 0) break;
    const paid = invoice.children.reduce(
      (sum, c) =>
        c.type === TransactionType.PAYMENT
          ? sum + c.amountCents
          : c.type === TransactionType.REFUND
            ? sum - c.amountCents
            : sum,
      0
    );
    const outstanding = invoice.amountCents - paid;
    if (outstanding <= 0) continue;

    const put = Math.min(left, outstanding);
    await recordPayment({ invoiceId: invoice.id, amountCents: put });
    left -= put;
    if (put === outstanding) settled.push(invoice.id);
  }

  const balances = await customerBalances(params.tenantId, params.partyId);

  return {
    partyId: params.partyId,
    customerName: party.name,
    paidCents: amount - left,
    unallocatedCents: left,
    balanceCents: Math.round(balances.get(params.partyId) ?? 0),
    settled,
  };
}

export interface BookRow {
  partyId: string;
  name: string;
  phone: string | null;
  owesCents: number;
  /** How long the oldest unpaid entry has been sitting. */
  oldestDays: number | null;
}

export interface TheBook {
  rows: BookRow[];
  totalOwedCents: number;
  /** Owed for more than sixty days — the part that is turning into a loss. */
  goneBadCents: number;
  summary: string;
}

/**
 * Who owes what, worst first.
 *
 * Ordered by age rather than by amount, deliberately. A big debt taken on
 * yesterday is trade; a small one from four months ago is a customer who is
 * not coming back, and that is the one a shopkeeper needs to see.
 */
export async function theBook(tenantId: string, now = new Date()): Promise<TheBook> {
  const balances = await customerBalances(tenantId);
  const owing = [...balances.entries()].filter(([, v]) => v > 0.5);
  if (owing.length === 0) {
    return { rows: [], totalOwedCents: 0, goneBadCents: 0, summary: "Nobody owes anything." };
  }

  const ids = owing.map(([id]) => id);
  const [parties, oldest] = await Promise.all([
    prisma.party.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, name: true, phone: true },
      take: 1000,
    }),
    prisma.transaction.groupBy({
      by: ["partyId"],
      where: {
        tenantId,
        partyId: { in: ids },
        type: TransactionType.INVOICE,
        status: { notIn: [TransactionStatus.CANCELLED, TransactionStatus.DRAFT] },
      },
      _min: { createdAt: true },
    }),
  ]);

  const nameOf = new Map(parties.map((p) => [p.id, p]));
  const oldestOf = new Map(oldest.map((o) => [o.partyId, o._min.createdAt]));

  const rows: BookRow[] = owing
    .map(([partyId, balance]) => {
      const party = nameOf.get(partyId);
      const first = oldestOf.get(partyId) ?? null;
      return {
        partyId,
        name: party?.name ?? "Unknown",
        phone: party?.phone ?? null,
        owesCents: Math.round(balance),
        oldestDays: first ? Math.floor((now.getTime() - first.getTime()) / 86_400_000) : null,
      };
    })
    .sort((a, b) => (b.oldestDays ?? 0) - (a.oldestDays ?? 0));

  const total = rows.reduce((sum, r) => sum + r.owesCents, 0);
  const bad = rows.filter((r) => (r.oldestDays ?? 0) > 60).reduce((sum, r) => sum + r.owesCents, 0);

  return {
    rows,
    totalOwedCents: total,
    goneBadCents: bad,
    summary:
      `${rows.length} ${rows.length === 1 ? "person owes" : "people owe"} money` +
      (bad > 0 ? `, and some of it has been sitting for over two months.` : "."),
  };
}

export interface KhataEntry {
  id: string;
  kind: "took" | "paid";
  description: string;
  amountCents: number;
  at: Date;
}

/** One customer's page in the book, most recent first. */
export async function customerPage(tenantId: string, partyId: string, limit = 60) {
  const party = await prisma.party.findFirst({
    where: { id: partyId, tenantId },
    select: { id: true, name: true, phone: true },
  });
  if (!party) return null;

  const rows = await prisma.transaction.findMany({
    where: {
      tenantId,
      partyId,
      type: { in: [TransactionType.INVOICE, TransactionType.PAYMENT] },
      status: { not: TransactionStatus.CANCELLED },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      type: true,
      amountCents: true,
      createdAt: true,
      itemLines: { select: { description: true, item: { select: { name: true } } }, take: 3 },
    },
  });

  const balances = await customerBalances(tenantId, partyId);

  const entries: KhataEntry[] = rows.map((r) => ({
    id: r.id,
    kind: r.type === TransactionType.INVOICE ? "took" : "paid",
    description:
      r.type === TransactionType.PAYMENT
        ? "Paid"
        : r.itemLines
            .map((l) => l.description ?? l.item.name)
            .filter(Boolean)
            .join(", ") || "Goods",
    amountCents: r.amountCents,
    at: r.createdAt,
  }));

  return {
    partyId: party.id,
    name: party.name,
    phone: party.phone,
    balanceCents: Math.round(balances.get(partyId) ?? 0),
    entries,
  };
}

/**
 * What to send them.
 *
 * Written, not sent. A message from the shop is the shop speaking, and this
 * module has no business deciding when that happens — so it composes and the
 * caller (or a person) releases it.
 *
 * The tone is the thing that matters. A shopkeeper who sends a lawyer's
 * letter to a neighbour loses the neighbour; one who sends the same limp
 * reminder six times is not chasing. So it says the number, the age, and
 * nothing else.
 */
export function reminderText(params: {
  customerName: string;
  owesCents: number;
  oldestDays: number | null;
  shopName: string;
  currencySymbol?: string;
}): string {
  const symbol = params.currencySymbol ?? "R";
  const amount = `${symbol}${(params.owesCents / 100).toFixed(2)}`;
  const firstName = params.customerName.split(" ")[0];

  const age =
    params.oldestDays === null
      ? ""
      : params.oldestDays > 60
        ? ` The oldest part of it is from over two months ago.`
        : params.oldestDays > 21
          ? ` The oldest part of it is from over three weeks ago.`
          : "";

  return (
    `Hi ${firstName}, this is ${params.shopName}. ` +
    `Your account is at ${amount}.${age} ` +
    `Please let me know when you can settle it, or come past and we can work something out.`
  );
}
