// Before the money goes.
//
// Invoice fraud is the most profitable crime committed against small
// businesses anywhere, and the version that works on this continent is not
// sophisticated. It is an email that says "our banking details have
// changed", sent from an address one character different from the real one,
// attached to an invoice that looks exactly like every other invoice from
// that supplier. It works because nothing in the business remembers what the
// details used to be, and nobody is looking at the supplier list closely
// enough to notice there are now two of them.
//
// So this module answers the questions a careful finance person would ask
// if they had time, on every bill, every time:
//
//   Did this supplier's bank account change recently?
//   Is there another supplier on file with almost the same name?
//   Have we seen this invoice number from them before?
//   Is this the same amount we paid them last week?
//   Is this bill sitting just under the amount that would need approval?
//   Did the same person approve it and pay it?
//
// NONE OF THESE IS AN ACCUSATION, AND THE WORDING MATTERS.
//
// Suppliers genuinely do change banks. Two companies genuinely can be called
// Mahlangu Trading. A duplicate invoice number is usually somebody's
// bookkeeping. Every flag here is phrased as a question for a person, with
// the fact that prompted it, and none of them blocks anything. A control
// that cries wolf gets switched off, and a control that blocks payments gets
// worked around — both leave the business worse off than no control at all.
//
// This is deliberately scoped to the business's OWN books. Scoring payments
// in an authorisation path is a different discipline, needs sub-100ms
// answers, and is not what this is.

import { BillStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Bank details changed inside this window are worth a question. */
export const RECENT_BANK_CHANGE_DAYS = 30;

/** Two names this close are worth a look. 0 is identical, 1 is one edit. */
export const LOOKALIKE_MAX_EDITS = 2;

/**
 * Edit distance, bounded.
 *
 * Stops as soon as the distance exceeds the limit, because the answer to
 * "are these two names nearly the same" does not need the exact distance
 * between two strings that plainly are not.
 */
export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * Two ways of reading a name, because one is not enough.
 *
 * TIGHT keeps every word and only drops punctuation and case, so "Mahlangu
 * Trading" and "Mahlangu Tradlng" are one edit apart. LOOSE additionally
 * drops company suffixes, so "Mahlangu Trading (Pty) Ltd" and "Mahlangu
 * Trading" are identical.
 *
 * Only using LOOSE was the first attempt and it was quietly wrong in exactly
 * the case this exists for: stripping "trading" from the real name and NOT
 * from the misspelling "tradlng" pushed the two names further apart than
 * they started, so the lookalike went undetected.
 */
function normaliseName(name: string): { tight: string; loose: string } {
  const tight = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const loose = name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|cc|inc|co|company|holdings|group|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return { tight, loose };
}

/** How close two names are, read whichever way makes them closest. */
function nameDistance(a: string, b: string, limit: number): number {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (left.tight.length <= 3 || right.tight.length <= 3) return limit + 1;
  return Math.min(
    editDistance(left.tight, right.tight, limit),
    editDistance(left.loose, right.loose, limit)
  );
}

export interface BankChangeInput {
  tenantId: string;
  partyId: string;
  bankName?: string | null;
  bankAccountHolder?: string | null;
  bankAccountNumber?: string | null;
  changedById?: string | null;
}

/**
 * Set or change where a supplier gets paid, and remember what it was.
 *
 * The history is written in the same transaction as the change, because a
 * record of a change that can be written without the change (or the reverse)
 * is a record nobody can rely on.
 */
export async function setSupplierBankDetails(input: BankChangeInput) {
  const party = await prisma.party.findFirst({
    where: { id: input.partyId, tenantId: input.tenantId },
    select: { id: true, bankName: true, bankAccountHolder: true, bankAccountNumber: true },
  });
  if (!party) throw new Error("That supplier is not in this workspace.");

  const next = {
    bankName: input.bankName?.trim() || null,
    bankAccountHolder: input.bankAccountHolder?.trim() || null,
    bankAccountNumber: input.bankAccountNumber?.replace(/\s/g, "") || null,
  };

  const changed =
    next.bankName !== party.bankName ||
    next.bankAccountHolder !== party.bankAccountHolder ||
    next.bankAccountNumber !== party.bankAccountNumber;

  if (!changed) return { changed: false };

  await prisma.$transaction(async (tx) => {
    await tx.partyBankChange.create({
      data: {
        tenantId: input.tenantId,
        partyId: input.partyId,
        fromBankName: party.bankName,
        toBankName: next.bankName,
        fromHolder: party.bankAccountHolder,
        toHolder: next.bankAccountHolder,
        fromAccountNumber: party.bankAccountNumber,
        toAccountNumber: next.bankAccountNumber,
        changedById: input.changedById ?? null,
      },
    });
    await tx.party.update({ where: { id: input.partyId }, data: next });
  });

  return { changed: true, wasFirstTime: party.bankAccountNumber === null };
}

export async function bankDetailHistory(tenantId: string, partyId: string) {
  return prisma.partyBankChange.findMany({
    where: { tenantId, partyId },
    orderBy: { changedAt: "desc" },
    take: 50,
  });
}

export type FlagKind =
  | "BANK_DETAILS_CHANGED"
  | "LOOKALIKE_SUPPLIER"
  | "DUPLICATE_REFERENCE"
  | "SAME_AMOUNT_RECENTLY"
  | "JUST_UNDER_APPROVAL"
  | "APPROVED_AND_PAID_BY_ONE_PERSON";

export interface BillFlag {
  billId: string;
  supplierName: string;
  amountCents: number;
  kind: FlagKind;
  /** Phrased as a question for a person, never as a finding. */
  question: string;
  /** The fact that prompted it, so the question can be answered. */
  because: string;
}

export interface ScreenResult {
  flags: BillFlag[];
  billsChecked: number;
  summary: string;
}

/**
 * Look at everything that has not been paid yet.
 *
 * Scoped to unpaid bills on purpose: a flag on something that already went
 * out is a post-mortem, and a post-mortem the business did not ask for is
 * noise on a page somebody is trying to use.
 */
export async function screenBills(
  params: {
    tenantId: string;
    approvalThresholdCents?: number;
    now?: Date;
  }
): Promise<ScreenResult> {
  const now = params.now ?? new Date();
  const recentCutoff = new Date(now.getTime() - RECENT_BANK_CHANGE_DAYS * 86_400_000);

  const bills = await prisma.supplierBill.findMany({
    where: {
      tenantId: params.tenantId,
      status: { in: [BillStatus.AWAITING_APPROVAL, BillStatus.APPROVED] },
    },
    orderBy: { issuedOn: "desc" },
    take: 500,
    include: { supplier: { select: { id: true, name: true } } },
  });

  if (bills.length === 0) {
    return { flags: [], billsChecked: 0, summary: "Nothing is waiting to be paid." };
  }

  const supplierIds = bills.map((b) => b.supplierId).filter((id): id is string => id !== null);

  const [recentChanges, allSuppliers, historicBills] = await Promise.all([
    prisma.partyBankChange.findMany({
      where: {
        tenantId: params.tenantId,
        partyId: { in: supplierIds },
        changedAt: { gte: recentCutoff },
      },
      orderBy: { changedAt: "desc" },
      take: 500,
    }),
    prisma.party.findMany({
      where: { tenantId: params.tenantId, role: "SUPPLIER" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.supplierBill.findMany({
      where: {
        tenantId: params.tenantId,
        issuedOn: { gte: new Date(now.getTime() - 400 * 86_400_000) },
      },
      select: {
        id: true,
        supplierId: true,
        reference: true,
        amountCents: true,
        issuedOn: true,
        approvedById: true,
        status: true,
      },
      take: 5000,
    }),
  ]);

  const changeFor = new Map<string, (typeof recentChanges)[number]>();
  for (const change of recentChanges) {
    if (!changeFor.has(change.partyId)) changeFor.set(change.partyId, change);
  }

  const flags: BillFlag[] = [];
  const days = (from: Date) => Math.floor((now.getTime() - from.getTime()) / 86_400_000);
  const money = (cents: number) => (cents / 100).toFixed(2);

  for (const bill of bills) {
    const name = bill.supplier?.name ?? bill.supplierName ?? "Unnamed supplier";
    const add = (kind: FlagKind, question: string, because: string) =>
      flags.push({ billId: bill.id, supplierName: name, amountCents: bill.amountCents, kind, question, because });

    // 1. Bank details changed recently.
    if (bill.supplierId) {
      const change = changeFor.get(bill.supplierId);
      // A first-time entry is somebody filling the record in, not a change.
      if (change && change.fromAccountNumber !== null) {
        add(
          "BANK_DETAILS_CHANGED",
          `Did ${name} really change banks?`,
          `Their account number changed ${days(change.changedAt)} days ago, from ${change.fromAccountNumber} to ${change.toAccountNumber ?? "nothing"}. Ring the number you already had for them, not one on the new invoice.`
        );
      }
    }

    // 2. Another supplier with almost the same name.
    if (bill.supplier) {
      const twin = allSuppliers.find(
        (other) =>
          other.id !== bill.supplier!.id &&
          nameDistance(bill.supplier!.name, other.name, LOOKALIKE_MAX_EDITS) <= LOOKALIKE_MAX_EDITS
      );
      if (twin) {
        add(
          "LOOKALIKE_SUPPLIER",
          `Is this ${name} or ${twin.name}?`,
          `There are two suppliers on file with almost the same name. One of them may be a duplicate record, and one of them may not be a real supplier.`
        );
      }
    }

    // 3. This invoice number has been seen before from this supplier.
    if (bill.reference && bill.supplierId) {
      const seen = historicBills.find(
        (other) =>
          other.id !== bill.id &&
          other.supplierId === bill.supplierId &&
          other.reference !== null &&
          other.reference.trim().toLowerCase() === bill.reference!.trim().toLowerCase()
      );
      if (seen) {
        add(
          "DUPLICATE_REFERENCE",
          `Have we already had invoice ${bill.reference} from ${name}?`,
          `An invoice with that number from them was recorded on ${seen.issuedOn.toLocaleDateString()}.`
        );
      }
    }

    // 4. Same supplier, same amount, inside a fortnight.
    if (bill.supplierId) {
      const twin = historicBills.find(
        (other) =>
          other.id !== bill.id &&
          other.supplierId === bill.supplierId &&
          other.amountCents === bill.amountCents &&
          Math.abs(other.issuedOn.getTime() - bill.issuedOn.getTime()) < 14 * 86_400_000
      );
      if (twin) {
        add(
          "SAME_AMOUNT_RECENTLY",
          `Is this the same bill as the one on ${twin.issuedOn.toLocaleDateString()}?`,
          `${name} has two bills for exactly ${money(bill.amountCents)} within a fortnight.`
        );
      }
    }

    // 5. Sitting just under the amount that would need a second signature.
    if (params.approvalThresholdCents && params.approvalThresholdCents > 0) {
      const gap = params.approvalThresholdCents - bill.amountCents;
      if (gap > 0 && gap < params.approvalThresholdCents * 0.05) {
        add(
          "JUST_UNDER_APPROVAL",
          `Why is this ${money(gap)} under the approval limit?`,
          `A bill that stops just short of needing a second signature is sometimes one job split in two.`
        );
      }
    }

    // 6. One person on both sides of the control.
    if (bill.approvedById && bill.status === BillStatus.APPROVED) {
      const alsoPaid = historicBills.filter(
        (other) => other.approvedById === bill.approvedById && other.supplierId === bill.supplierId
      );
      if (alsoPaid.length >= 5) {
        add(
          "APPROVED_AND_PAID_BY_ONE_PERSON",
          `Should one person be approving everything from ${name}?`,
          `The same person has approved ${alsoPaid.length} bills from this supplier. That is not wrong, but it is the arrangement every invoice fraud needs.`
        );
      }
    }
  }

  return {
    flags: flags.slice(0, 100),
    billsChecked: bills.length,
    summary:
      flags.length === 0
        ? `Nothing to ask about on ${bills.length} unpaid bill${bills.length === 1 ? "" : "s"}.`
        : `${flags.length} question${flags.length === 1 ? "" : "s"} worth asking before the money goes.`,
  };
}

export interface LookalikePair {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  edits: number;
}

/**
 * Suppliers whose names are nearly the same.
 *
 * Useful outside the bill screen too: most of these are duplicate records
 * quietly splitting one supplier's spend across two rows, which makes every
 * supplier report wrong in a way nobody notices.
 */
export async function lookalikeSuppliers(tenantId: string): Promise<LookalikePair[]> {
  const suppliers = await prisma.party.findMany({
    where: { tenantId, role: "SUPPLIER" },
    select: { id: true, name: true },
    take: 2000,
  });

  const pairs: LookalikePair[] = [];
  for (let i = 0; i < suppliers.length; i++) {
    for (let j = i + 1; j < suppliers.length; j++) {
      const edits = nameDistance(suppliers[i].name, suppliers[j].name, LOOKALIKE_MAX_EDITS);
      if (edits <= LOOKALIKE_MAX_EDITS) {
        pairs.push({
          aId: suppliers[i].id,
          aName: suppliers[i].name,
          bId: suppliers[j].id,
          bName: suppliers[j].name,
          edits,
        });
      }
    }
  }

  return pairs.sort((a, b) => a.edits - b.edits).slice(0, 100);
}
