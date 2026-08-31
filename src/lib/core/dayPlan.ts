// The Today planner — merges real, calendar-backed appointments (actual
// times, never guessed) with everything else worth attention today
// (overdue invoices, follow-ups due, stale quotes, unscheduled job
// cards), proactively pulled in even when nothing formally scheduled it
// for today. Untimed items never get an invented time slot — they're
// ranked by urgency instead, per the user's own call: "must link to
// calendar or not have time if not allocated."

import { prisma } from "@/lib/db";
import { getOverdueInvoices } from "./collections";
import { findStaleTransactions } from "./money";
import { listThisWeekFollowUps } from "./followUpReminders";

export interface TimedPlanItem {
  kind: "appointment" | "job_card";
  id: string;
  title: string;
  partyName: string;
  scheduledAt: Date;
}

export type UntimedReason = "overdue_invoice" | "follow_up_due" | "stale" | "unscheduled_job_card";

export interface UntimedPlanItem {
  kind: "quote" | "invoice" | "job_card";
  id: string;
  title: string;
  partyName: string;
  reason: UntimedReason;
  urgencyRank: number; // lower = more urgent, used for sort only
  detail: string; // human-readable "why this is here"
}

export interface DayPlan {
  timed: TimedPlanItem[];
  untimed: UntimedPlanItem[];
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function endOfToday() {
  const start = startOfToday();
  return new Date(start.getTime() + 86400000);
}

export async function getTodayPlan(tenantId: string): Promise<DayPlan> {
  const todayStart = startOfToday();
  const todayEnd = endOfToday();

  const [appointmentsToday, jobCardsToday, jobCardsUnscheduled, overdueInvoices, thisWeek, stale] = await Promise.all([
    prisma.event.findMany({
      where: { tenantId, type: { in: ["SITE_VISIT", "CONSULTATION"] }, scheduledAt: { gte: todayStart, lt: todayEnd }, noShow: false },
      include: { party: true },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.jobCard.findMany({
      where: { tenantId, status: { not: "DONE" }, scheduledAt: { gte: todayStart, lt: todayEnd } },
      include: { party: true },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.jobCard.findMany({
      where: { tenantId, status: { not: "DONE" }, scheduledAt: null },
      include: { party: true },
    }),
    getOverdueInvoices(tenantId),
    listThisWeekFollowUps(tenantId),
    findStaleTransactions({ tenantId, staleAfterDays: 3 }),
  ]);

  const timed: TimedPlanItem[] = [
    ...appointmentsToday.map((e) => ({
      kind: "appointment" as const,
      id: e.id,
      title: e.type === "CONSULTATION" ? "Consultation" : "Site visit",
      partyName: e.party?.name ?? "Unknown",
      scheduledAt: e.scheduledAt!,
    })),
    ...jobCardsToday.map((jc) => ({
      kind: "job_card" as const,
      id: jc.id,
      title: jc.title,
      partyName: jc.party.name,
      scheduledAt: jc.scheduledAt!,
    })),
  ].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  // Dedup as we build the untimed list — the same transaction can
  // legitimately show up in more than one of these queries (an overdue
  // invoice is also "stale"), and it should only ever appear once, at
  // its most urgent reason.
  const seenTransactionIds = new Set<string>();
  const untimed: UntimedPlanItem[] = [];

  for (const inv of overdueInvoices) {
    seenTransactionIds.add(inv.id);
    untimed.push({
      kind: "invoice", id: inv.id, title: "Invoice overdue", partyName: inv.partyName,
      reason: "overdue_invoice", urgencyRank: 0,
      detail: `${inv.daysOverdue} day${inv.daysOverdue === 1 ? "" : "s"} overdue`,
    });
  }

  const todayOrEarlier = thisWeek.filter((t) => t.nextFollowUpAt && t.nextFollowUpAt < todayEnd);
  for (const t of todayOrEarlier) {
    if (seenTransactionIds.has(t.id)) continue;
    seenTransactionIds.add(t.id);
    untimed.push({
      kind: t.type === "INVOICE" ? "invoice" : "quote", id: t.id, title: `${t.type === "INVOICE" ? "Invoice" : "Quote"} follow-up due`,
      partyName: t.party.name, reason: "follow_up_due", urgencyRank: 1,
      detail: t.followUpNote ?? "Follow-up due today",
    });
  }

  for (const t of stale) {
    if (seenTransactionIds.has(t.id)) continue;
    seenTransactionIds.add(t.id);
    untimed.push({
      kind: t.type === "INVOICE" ? "invoice" : "quote", id: t.id, title: `${t.type === "INVOICE" ? "Invoice" : "Quote"} gone quiet`,
      partyName: t.party.name, reason: "stale", urgencyRank: 2,
      detail: "Worth a nudge — no response in a few days",
    });
  }

  for (const jc of jobCardsUnscheduled) {
    untimed.push({
      kind: "job_card", id: jc.id, title: jc.title, partyName: jc.party.name,
      reason: "unscheduled_job_card", urgencyRank: 3, detail: "Not yet scheduled",
    });
  }

  untimed.sort((a, b) => a.urgencyRank - b.urgencyRank);

  return { timed, untimed };
}
