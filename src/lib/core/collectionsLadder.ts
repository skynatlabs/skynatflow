// Chasing, properly.
//
// A business that sends the same polite reminder six times is not chasing. A
// business that opens with a lawyer's letter loses the customer. The ladder
// is the difference, and it only works if every rung is written down —
// otherwise the next message has no idea what the last one said.
//
// Three rules the ladder obeys, all of them about not being stupid:
//
//   It stops the moment money lands. Not on the next run — immediately, by
//   reading what is actually outstanding rather than a flag set last week.
//
//   It never chases somebody on a payment plan who is paying as agreed. That
//   is what paymentPlans.ts exists for, and skipping this check is how a
//   business insults its best-behaved debtor.
//
//   It takes the customer's history into account. Somebody who has paid on
//   time for two years and is four days late gets a different first message
//   from somebody who is late every single time.
//
// The wording is drafted, never sent from here. Sending is a separate,
// gated act — see the agent's ALWAYS_ASK set.

import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";
import { netPaidByInvoice } from "./money";
import { plannedArrears } from "./paymentPlans";

export type Tone = "gentle" | "firm" | "final";

export interface Rung {
  step: number;
  /** Days past due at which this rung becomes appropriate. */
  afterDays: number;
  tone: Tone;
  label: string;
  /** What this rung is for, in the words of somebody deciding whether to send it. */
  intent: string;
}

/**
 * The ladder itself.
 *
 * Deliberately short. Six rungs is a collections department; four is what a
 * business with other work to do will actually follow, and the last one is
 * the one that says what happens next — which is the only rung that ever
 * changes behaviour.
 */
export const LADDER: Rung[] = [
  { step: 1, afterDays: 3, tone: "gentle", label: "A nudge", intent: "Assume it was missed. Most late invoices are an oversight and nothing else." },
  { step: 2, afterDays: 14, tone: "gentle", label: "A reminder", intent: "Say the amount and the date plainly, and offer to resend the invoice." },
  { step: 3, afterDays: 30, tone: "firm", label: "A firm request", intent: "Ask for a payment date. A date is what turns a debtor into a plan." },
  { step: 4, afterDays: 45, tone: "final", label: "Final notice", intent: "Say what happens next — interest, suspension of work, handover — and mean it." },
];

export interface ChaseCandidate {
  transactionId: string;
  number: string | null;
  partyId: string;
  customer: string;
  phone: string | null;
  email: string | null;
  amountCents: number;
  outstandingCents: number;
  dueAt: Date | null;
  daysLate: number;
  /** The rung to send next, or null when nothing is due yet. */
  rung: Rung | null;
  lastAttemptAt: Date | null;
  attemptsSoFar: number;
  /** How this customer normally behaves, which softens or hardens the wording. */
  history: { invoicesPaid: number; averageDaysLate: number; usuallyOnTime: boolean };
  /** Why this one is being skipped, when it is. */
  skip: string | null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Everybody who could be chased today, with the rung each is on.
 *
 * Nothing is sent. This is the list a person or the agent looks at.
 */
export async function chaseList(tenantId: string, now = new Date()): Promise<ChaseCandidate[]> {
  const invoices = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: "INVOICE",
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      dueAt: { not: null, lt: now },
    },
    select: {
      id: true,
      externalRef: true,
      amountCents: true,
      dueAt: true,
      partyId: true,
      party: { select: { id: true, name: true, companyName: true, phone: true, email: true } },
    },
    take: 300,
  });
  if (invoices.length === 0) return [];

  const ids = invoices.map((i) => i.id);
  const [paidMap, plans, attempts, settledHistory] = await Promise.all([
    netPaidByInvoice(ids),
    plannedArrears(tenantId, now),
    prisma.collectionAttempt.findMany({
      where: { tenantId, transactionId: { in: ids } },
      orderBy: { sentAt: "desc" },
      select: { transactionId: true, step: true, sentAt: true },
    }),
    // How each customer has behaved on everything they have already settled.
    prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE", status: "PAID", dueAt: { not: null }, partyId: { in: invoices.map((i) => i.partyId) } },
      select: { partyId: true, dueAt: true, children: { where: { type: "PAYMENT" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } },
      take: 800,
    }),
  ]);

  const behaviour = new Map<string, { total: number; lateDays: number }>();
  for (const settled of settledHistory) {
    const paidOn = settled.children[0]?.createdAt;
    if (!paidOn || !settled.dueAt) continue;
    const row = behaviour.get(settled.partyId) ?? { total: 0, lateDays: 0 };
    row.total += 1;
    row.lateDays += Math.max(0, daysBetween(paidOn, settled.dueAt));
    behaviour.set(settled.partyId, row);
  }

  const attemptsByInvoice = new Map<string, { count: number; lastStep: number; lastAt: Date }>();
  for (const a of attempts) {
    const row = attemptsByInvoice.get(a.transactionId);
    if (row) row.count += 1;
    else attemptsByInvoice.set(a.transactionId, { count: 1, lastStep: a.step, lastAt: a.sentAt });
  }

  const out: ChaseCandidate[] = [];
  for (const invoice of invoices) {
    const paid = paidMap.get(invoice.id) ?? 0;
    const outstanding = Math.max(0, invoice.amountCents - paid);
    // Money landed. Nothing else matters.
    if (outstanding === 0) continue;

    const daysLate = invoice.dueAt ? daysBetween(now, invoice.dueAt) : 0;
    const plan = plans.get(invoice.id);
    const prior = attemptsByInvoice.get(invoice.id);
    const hist = behaviour.get(invoice.partyId) ?? { total: 0, lateDays: 0 };
    const averageDaysLate = hist.total > 0 ? Math.round(hist.lateDays / hist.total) : 0;
    const usuallyOnTime = hist.total >= 2 && averageDaysLate <= 3;

    let skip: string | null = null;
    // Paying as agreed is not being late, whatever the invoice date says.
    if (plan && plan.overdueCents === 0) {
      skip = plan.nextDue
        ? `On a payment plan and up to date. Next instalment ${plan.nextDue.toISOString().slice(0, 10)}.`
        : "On a payment plan and up to date.";
    }

    // Somebody who always pays on time gets one extra day before the first
    // nudge — the cost of annoying a good payer is higher than a day's wait.
    const grace = usuallyOnTime && !prior ? 2 : 0;
    const reached = [...LADDER].reverse().find((r) => daysLate >= r.afterDays + grace) ?? null;
    const nextStep = prior ? Math.max(prior.lastStep + 1, 1) : 1;
    const rung = skip ? null : reached && reached.step >= nextStep ? LADDER.find((r) => r.step === nextStep) ?? reached : null;

    out.push({
      transactionId: invoice.id,
      number: invoice.externalRef,
      partyId: invoice.partyId,
      customer: invoice.party.companyName ?? invoice.party.name,
      phone: invoice.party.phone,
      email: invoice.party.email,
      amountCents: invoice.amountCents,
      outstandingCents: plan ? plan.overdueCents || outstanding : outstanding,
      dueAt: invoice.dueAt,
      daysLate,
      rung,
      lastAttemptAt: prior?.lastAt ?? null,
      attemptsSoFar: prior?.count ?? 0,
      history: { invoicesPaid: hist.total, averageDaysLate, usuallyOnTime },
      skip,
    });
  }

  return out.sort((a, b) => b.outstandingCents - a.outstandingCents);
}

/**
 * The wording for one rung, written here rather than by a model.
 *
 * Fixed text so the tone is predictable and a business is never surprised by
 * what went out in its name. The agent may rewrite it before sending; this is
 * what it starts from, and what goes out when nothing is configured to draft.
 */
export function draftChase(params: {
  candidate: ChaseCandidate;
  businessName: string;
  currency: string;
  /** How this business's country writes a date. Defaults to the reader's own. */
  locale?: string;
  /** The customer's own portal link, so they can see and pay it. */
  portalUrl?: string | null;
}): { tone: Tone; step: number; subject: string; body: string } {
  const c = params.candidate;
  const rung = c.rung ?? LADDER[0];
  const amount = formatMoney(c.outstandingCents, params.currency);
  const ref = c.number ? `invoice ${c.number}` : "the invoice";
  const link = params.portalUrl ? `\n\nYou can see it and pay it here: ${params.portalUrl}` : "";

  if (rung.tone === "gentle" && rung.step === 1) {
    return {
      tone: rung.tone,
      step: rung.step,
      subject: `${params.businessName} — ${ref}`,
      body:
        `Hi ${c.customer},\n\n` +
        `Just a note that ${ref} for ${amount} went past its date on ${c.dueAt?.toLocaleDateString(params.locale) ?? "its due date"}. ` +
        `It is probably nothing — if it has already gone out, ignore this and thank you.` +
        link +
        `\n\n${params.businessName}`,
    };
  }

  if (rung.tone === "gentle") {
    return {
      tone: rung.tone,
      step: rung.step,
      subject: `${params.businessName} — ${ref} still outstanding`,
      body:
        `Hi ${c.customer},\n\n` +
        `${ref.charAt(0).toUpperCase() + ref.slice(1)} for ${amount} is now ${c.daysLate} days past its date. ` +
        `Happy to resend it or send a statement if that helps.` +
        link +
        `\n\n${params.businessName}`,
    };
  }

  if (rung.tone === "firm") {
    return {
      tone: rung.tone,
      step: rung.step,
      subject: `${params.businessName} — payment date needed on ${ref}`,
      body:
        `Hi ${c.customer},\n\n` +
        `${amount} on ${ref} is ${c.daysLate} days overdue. Could you let us know the date it will be paid? ` +
        `If the amount is in dispute, tell us which part and we will look at it straight away — but we do need a date.` +
        link +
        `\n\n${params.businessName}`,
    };
  }

  return {
    tone: "final",
    step: rung.step,
    subject: `${params.businessName} — final notice on ${ref}`,
    body:
      `${c.customer},\n\n` +
      `${amount} on ${ref} is ${c.daysLate} days overdue and we have not had a payment date.\n\n` +
      `Unless it is settled or a date is agreed within seven days, we will suspend further work and hand the account over. ` +
      `We would much rather not, so please call us today.` +
      link +
      `\n\n${params.businessName}`,
  };
}

/** A rung was climbed. Recorded so the next one knows. */
export async function recordChase(params: {
  tenantId: string;
  transactionId: string;
  step: number;
  channel: "whatsapp" | "email" | "call" | "letter";
  tone: Tone;
  body?: string | null;
  sentById?: string | null;
}) {
  const invoice = await prisma.transaction.findFirst({
    where: { id: params.transactionId, tenantId: params.tenantId },
    select: { id: true, partyId: true },
  });
  if (!invoice) throw new Error("That invoice is not in this workspace.");

  return prisma.collectionAttempt.create({
    data: {
      tenantId: params.tenantId,
      transactionId: invoice.id,
      partyId: invoice.partyId,
      step: params.step,
      channel: params.channel,
      tone: params.tone,
      body: params.body ?? null,
      sentById: params.sentById ?? null,
    },
  });
}

export async function chaseHistory(tenantId: string, transactionId: string) {
  return prisma.collectionAttempt.findMany({
    where: { tenantId, transactionId },
    orderBy: { sentAt: "desc" },
  });
}

/** Does the ladder work? The only question worth asking of a collections feature. */
export async function ladderEffect(tenantId: string, now = new Date()) {
  const attempts = await prisma.collectionAttempt.findMany({
    where: { tenantId, sentAt: { gte: new Date(now.getTime() - 180 * 86_400_000) } },
    select: { transactionId: true, step: true, sentAt: true },
  });
  if (attempts.length === 0) return { chased: 0, settledAfter: 0, medianDaysToPay: null, summary: "Nothing has been chased yet." };

  const ids = [...new Set(attempts.map((a) => a.transactionId))];
  const settled = await prisma.transaction.findMany({
    where: { id: { in: ids }, status: "PAID" },
    select: { id: true, children: { where: { type: "PAYMENT" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const firstChase = new Map<string, Date>();
  for (const a of [...attempts].sort((x, y) => x.sentAt.getTime() - y.sentAt.getTime())) {
    if (!firstChase.has(a.transactionId)) firstChase.set(a.transactionId, a.sentAt);
  }

  const gaps: number[] = [];
  for (const s of settled) {
    const paidOn = s.children[0]?.createdAt;
    const chasedOn = firstChase.get(s.id);
    if (paidOn && chasedOn && paidOn >= chasedOn) gaps.push(daysBetween(paidOn, chasedOn));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length === 0 ? null : gaps[Math.floor(gaps.length / 2)];

  return {
    chased: ids.length,
    settledAfter: settled.length,
    medianDaysToPay: median,
    summary:
      settled.length === 0
        ? `${ids.length} chased in the last six months, none settled yet.`
        : `${settled.length} of ${ids.length} chased invoices were paid` +
          (median !== null ? `, typically ${median} ${median === 1 ? "day" : "days"} after the first message.` : "."),
  };
}
