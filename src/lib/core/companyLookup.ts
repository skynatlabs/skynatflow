// Who are they, really.
//
// Two questions a business asks before doing work on credit, and neither has
// a good answer today for anybody small. Is this a real registered company,
// and do they pay?
//
// The first needs CIPC, whose public search is behind a login and whose API
// is sold through resellers. The second needs a credit bureau — TransUnion,
// Experian or XDS — and every one of them requires a signed agreement, a
// registered purpose under the National Credit Act, and a per-enquiry fee.
// Neither is connected here, and neither can be without the business itself
// signing up. Saying so is the whole of what this module claims.
//
// But the second question has an answer nobody is selling, because only this
// system has it: how this customer has actually paid *us*. A bureau score is
// a stranger's opinion of somebody you already know. Twelve invoices and the
// days each one took is better evidence than a number out of three digits,
// and it costs nothing.

import { prisma } from "@/lib/db";

export interface RegistryDef {
  key: string;
  label: string;
  country: string;
  /** What it can tell you. */
  answers: string;
  /** What it would take to connect it. */
  needs: string;
}

export const REGISTRIES: RegistryDef[] = [
  {
    key: "cipc",
    label: "CIPC",
    country: "ZA",
    answers: "Whether a registration number is real, the company's registered name, its status, and who its directors are.",
    needs: "A CIPC customer code and a reseller agreement. Not connected on this deployment.",
  },
  {
    key: "sars-vat",
    label: "SARS VAT vendor search",
    country: "ZA",
    answers: "Whether a VAT number is a registered vendor — which decides whether you can claim the VAT on their invoice.",
    needs: "The public search has no API. The check below is a format check only.",
  },
];

export const BUREAUX = [
  { key: "transunion", label: "TransUnion", needs: "A subscriber agreement and a registered purpose under the National Credit Act." },
  { key: "experian", label: "Experian", needs: "A subscriber agreement, and a fee per enquiry." },
  { key: "xds", label: "XDS", needs: "A subscriber agreement." },
];

/**
 * Does this VAT number even have the right shape?
 *
 * South African VAT numbers are ten digits starting with a 4, and the last
 * digit is a Luhn check — the same algorithm as a card number. That catches
 * a typo or an invented number without asking anybody, which is most of the
 * value of a lookup for a fraction of the trouble.
 */
export function checkVatNumber(raw: string): { plausible: boolean; reason: string } {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length !== 10) return { plausible: false, reason: "A South African VAT number is ten digits. This one is not." };
  if (!digits.startsWith("4")) return { plausible: false, reason: "A South African VAT number starts with a 4. This one does not." };

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  if (sum % 10 !== 0) {
    return { plausible: false, reason: "The check digit does not work out, so this number has been mistyped or invented." };
  }
  return { plausible: true, reason: "The shape and check digit are right. That does not prove they are a registered vendor — only SARS can say that." };
}

/**
 * Does a registration number look like a real one?
 *
 * The CIPC format is YYYY/NNNNNN/NN, where the last pair says what kind of
 * entity it is. A wrong year or an impossible type is worth catching before
 * a contract goes out with it printed on the bottom.
 */
export function checkRegistrationNumber(raw: string): { plausible: boolean; entityType: string | null; reason: string } {
  const match = raw.trim().match(/^(\d{4})\/(\d{6})\/(\d{2})$/);
  if (!match) {
    return { plausible: false, entityType: null, reason: "A CIPC number looks like 2019/123456/07. This one does not." };
  }

  const [, year, , type] = match;
  const yearNumber = Number(year);
  const thisYear = new Date().getUTCFullYear();
  if (yearNumber < 1900 || yearNumber > thisYear) {
    return { plausible: false, entityType: null, reason: `${year} is not a year a company could have been registered in.` };
  }

  const TYPES: Record<string, string> = {
    "06": "Close corporation",
    "07": "Private company (Pty) Ltd",
    "08": "Non-profit company",
    "09": "Personal liability company",
    "10": "Public company",
    "21": "External company",
    "23": "Incorporated",
    "24": "State-owned company",
  };

  const entityType = TYPES[type] ?? null;
  return {
    plausible: true,
    entityType,
    reason: entityType
      ? `Registered in ${year} as a ${entityType.toLowerCase()}. Whether it is still in good standing needs CIPC, which is not connected.`
      : `Registered in ${year}. The type code ${type} is not one of the common ones — worth checking.`,
  };
}

export interface PaymentBehaviour {
  partyId: string;
  name: string;
  /** How many settled invoices this is based on. */
  settled: number;
  medianDaysLate: number | null;
  worstDaysLate: number | null;
  outstandingCents: number;
  oldestOutstandingDays: number | null;
  /** Plain words, not a score out of a thousand. */
  verdict: string;
  /** What this is and is not. */
  caveat: string;
}

/**
 * What we actually know about how they pay.
 *
 * The median rather than the mean, because one customer who took 300 days
 * once should not make a reliable payer look terrible. And stated in days,
 * not as a score: "usually pays 9 days late, worst was 40" is something an
 * owner can make a decision with. A number out of a thousand is not.
 */
export async function paymentBehaviour(tenantId: string, partyId: string, now = new Date()): Promise<PaymentBehaviour> {
  const party = await prisma.party.findFirst({ where: { id: partyId, tenantId }, select: { name: true, companyName: true } });
  if (!party) throw new Error("That customer is not in this workspace.");

  const invoices = await prisma.transaction.findMany({
    where: { tenantId, partyId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] } },
    select: {
      amountCents: true,
      status: true,
      dueAt: true,
      createdAt: true,
      children: { where: { type: "PAYMENT" }, select: { createdAt: true, amountCents: true }, orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const lateness: number[] = [];
  let outstanding = 0;
  let oldestOutstanding: number | null = null;

  for (const invoice of invoices) {
    const paid = invoice.children.reduce((sum, payment) => sum + payment.amountCents, 0);
    const settled = paid >= invoice.amountCents;

    if (settled && invoice.dueAt && invoice.children[0]) {
      lateness.push(Math.round((invoice.children[0].createdAt.getTime() - invoice.dueAt.getTime()) / 86_400_000));
    } else if (!settled) {
      outstanding += invoice.amountCents - paid;
      const reference = invoice.dueAt ?? invoice.createdAt;
      const days = Math.floor((now.getTime() - reference.getTime()) / 86_400_000);
      if (days > 0 && (oldestOutstanding === null || days > oldestOutstanding)) oldestOutstanding = days;
    }
  }

  const sorted = [...lateness].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
  const worst = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  let verdict: string;
  if (sorted.length < 3) {
    verdict =
      sorted.length === 0
        ? "Nothing settled yet, so there is no record to go on. Treat them as new."
        : `Only ${sorted.length} settled ${sorted.length === 1 ? "invoice" : "invoices"} — a first impression rather than a pattern.`;
  } else if (median !== null && median <= 0) {
    verdict = `Pays on time or early, across ${sorted.length} invoices. Worst was ${worst} ${Math.abs(worst ?? 0) === 1 ? "day" : "days"}.`;
  } else if (median !== null && median <= 14) {
    verdict = `Usually about ${median} days late, worst ${worst}. Normal for a business customer; price the delay in rather than worrying about it.`;
  } else {
    verdict = `Usually ${median} days late, worst ${worst}. Ask for a deposit, or put them on a payment plan before the work rather than after.`;
  }

  return {
    partyId,
    name: party.companyName ?? party.name,
    settled: sorted.length,
    medianDaysLate: median,
    worstDaysLate: worst,
    outstandingCents: outstanding,
    oldestOutstandingDays: oldestOutstanding,
    verdict,
    caveat:
      "This is how they have paid this business, which is the only credit information anybody here actually owns. A bureau would say how they pay everybody else, and connecting one needs a subscriber agreement and a registered purpose under the National Credit Act.",
  };
}

/**
 * Everything that can be said about a business, from what is here.
 *
 * Collected into one answer because the question is never "check the VAT
 * number" on its own — it is "should I do this job for them".
 */
export async function whoAreThey(tenantId: string, partyId: string) {
  const party = await prisma.party.findFirst({
    where: { id: partyId, tenantId },
    select: { name: true, companyName: true, vatNumber: true, registrationNumber: true },
  });
  if (!party) throw new Error("That customer is not in this workspace.");

  const behaviour = await paymentBehaviour(tenantId, partyId);

  return {
    name: party.companyName ?? party.name,
    vat: party.vatNumber ? { number: party.vatNumber, ...checkVatNumber(party.vatNumber) } : null,
    registration: party.registrationNumber ? { number: party.registrationNumber, ...checkRegistrationNumber(party.registrationNumber) } : null,
    behaviour,
    notConnected: [...REGISTRIES.map((r) => `${r.label}: ${r.needs}`), ...BUREAUX.map((b) => `${b.label}: ${b.needs}`)],
  };
}
