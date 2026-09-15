// The sales consultant.
//
// What was quoted against what was won and why, follow-up timing, customer
// health and discounting. Drafts every customer message; sends none. A draft
// lands in the approval queue, where a person reads it before it goes.

import { prisma } from "@/lib/db";
import { observe, handOff, type ObserveParams } from "../observations";
import { may } from "../ladder";
import { draftFollowUpMessage } from "@/lib/ai/followUp";
import { winRate, readingNotAnswering, quietCustomers, discountLeak } from "@/lib/core/salesHealth";
import { formatMoney, tenantCurrency } from "@/lib/core/currency";

type Finding = Omit<ObserveParams, "tenantId" | "officer">;
const DAY = 86_400_000;

async function draftFor(tenantId: string, transactionId: string, partyId: string, reasoning: string) {
  // Only when this officer may draft, and never twice for the same document.
  if (!(await may(tenantId, "SALES", "DRAFT"))) return false;
  const pending = await prisma.aiDraft.findFirst({ where: { tenantId, transactionId, status: "PENDING" }, select: { id: true } });
  if (pending) return false;
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId }, include: { party: true } });
  if (!tx) return false;
  let body: string | null = null;
  try {
    if (!process.env.VITEST) {
      const drafted = await draftFollowUpMessage({ transaction: tx as Parameters<typeof draftFollowUpMessage>[0]["transaction"], touchNumber: 1 });
      body = typeof drafted === "string" ? drafted : (drafted as { body?: string })?.body ?? null;
    }
  } catch {
    body = null;
  }
  body ??= `Hi ${tx.party.name.split(" ")[0]}, just checking in on the quote I sent — happy to walk through anything or adjust it if something doesn't fit. Let me know.`;
  await prisma.aiDraft.create({ data: { tenantId, partyId, transactionId, touchNumber: 1, body, reasoning } });
  return true;
}

export async function runSales(tenantId: string, now = new Date()): Promise<{ checked: number; observed: number; failed: string[] }> {
  const currency = await tenantCurrency(tenantId);
  const money = (c: number) => formatMoney(c, currency);
  let observed = 0;
  const failed: string[] = [];
  const emit = async (f: Finding) => { if (await observe({ ...f, tenantId, officer: "SALES" })) observed++; };

  const checks: Array<[string, () => Promise<void>]> = [
    ["readingNotAnswering", async () => {
      const cold = await readingNotAnswering(tenantId);
      for (const q of cold.slice(0, 3)) {
        const drafted = await draftFor(tenantId, q.transactionId, q.partyId, `Opened ${q.openCount} times without a reply — deciding, not ignoring.`);
        await emit({
          headline: `${q.partyName} has opened a ${money(q.amountCents)} quote ${q.openCount} times and not replied.`,
          detail: `Sent ${q.daysSinceSent} days ago${q.daysSinceOpened !== null ? `, last opened ${q.daysSinceOpened === 0 ? "today" : `${q.daysSinceOpened} days ago`}` : ""}. Someone reading a quote repeatedly is deciding; a call now is worth more than a reminder later.`,
          dedupeKey: `sales:reading:${q.transactionId}`,
          subjectType: "customer",
          subjectId: q.partyId,
          moneyCents: q.amountCents,
          confidence: 70,
          evidence: [{ label: "Opens", value: String(q.openCount) }, { label: "Sent", value: `${q.daysSinceSent} days ago` }],
          proposedAction: drafted ? "A follow-up is drafted and waiting on you — read it, then send or bin it." : "Call them today.",
        });
      }
    }],
    ["quietCustomers", async () => {
      const quiet = await quietCustomers(tenantId, now);
      for (const c of quiet.slice(0, 3)) {
        await emit({
          headline: `${c.partyName} usually orders every ${c.usualGapDays} days and has been silent for ${c.daysSinceLast}.`,
          detail: `${c.orders} invoices so far, worth about ${money(c.annualCents)} a year. A broken rhythm is the earliest sign a customer has gone elsewhere, and the cheapest moment to find out why.`,
          dedupeKey: `sales:quiet:${c.partyId}`,
          subjectType: "customer",
          subjectId: c.partyId,
          moneyCents: c.annualCents,
          confidence: 60,
          evidence: [{ label: "Last order", value: c.lastAt.toISOString().slice(0, 10) }, { label: "Usual gap", value: `${c.usualGapDays} days` }],
          proposedAction: `Check in with ${c.partyName} — not a sales pitch, a question about how the last job went.`,
        });
      }
    }],
    ["winRate", async () => {
      const recent = await winRate(tenantId, new Date(now.getTime() - 90 * DAY), now);
      const before = await winRate(tenantId, new Date(now.getTime() - 180 * DAY), new Date(now.getTime() - 90 * DAY));
      if (recent.winPercent === null || before.winPercent === null || recent.won + recent.lost < 5) return;
      const drop = before.winPercent - recent.winPercent;
      if (drop < 15) return;
      await emit({
        headline: `Quotes are winning ${recent.winPercent}% of the time, down from ${before.winPercent}% the quarter before.`,
        detail: `${recent.won} won and ${recent.lost} lost in the last 90 days. A fall this size is usually price, speed of response, or a competitor — the lost quotes' decline reasons say which.`,
        dedupeKey: "sales:win-rate",
        moneyCents: Math.round((recent.quotedCents * drop) / 100),
        confidence: 55,
        evidence: [{ label: "Last 90 days", value: `${recent.winPercent}% of ${recent.won + recent.lost}` }, { label: "Before", value: `${before.winPercent}% of ${before.won + before.lost}` }],
        proposedAction: "Read the last five lost quotes side by side; the pattern is usually obvious once they are together.",
      });
    }],
    ["discounting", async () => {
      const d = await discountLeak(tenantId, new Date(now.getTime() - 90 * DAY), now);
      if (d.discountCents < 2_000_00) return;
      const obs = await observe({
        tenantId,
        officer: "SALES",
        headline: `${money(d.discountCents)} was given away in discounts over three months, across ${d.documents} invoices.`,
        detail: `${d.topCustomer ? `${d.topCustomer} received the most. ` : ""}Discounts come straight off margin — a 10% discount on a 25% margin gives away 40% of the profit on that job.`,
        dedupeKey: "sales:discounting",
        moneyCents: d.discountCents * 4,
        confidence: 80,
        evidence: [{ label: "Discounted lines", value: String(d.lines) }, { label: "Documents", value: String(d.documents) }],
        proposedAction: "Set a discount ceiling that needs your approval above it.",
      });
      if (obs) {
        observed++;
        // Margin is the CFO's to weigh; one hop, then it stays one item.
        await handOff({ tenantId, observationId: obs.id, to: "CFO", note: "Handed to the CFO: discounting is a margin question." }).catch(() => undefined);
      }
    }],
  ];

  for (const [name, run] of checks) {
    try { await run(); } catch (err) {
      failed.push(name);
      console.error(`[sales] ${name} failed for ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: checks.length, observed, failed };
}
