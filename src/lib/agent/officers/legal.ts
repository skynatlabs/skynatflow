// The legal consultant.
//
// Obligations, contracts and their notice windows, what a tender desk will
// ask for, and the paperwork that is missing on the day it goes wrong.
// Advises and blocks — through an obligation's blocksWork flag, which the
// trip and dispatch paths already refuse on — and signs nothing.
//
// The compliance watch still raises each deadline as it worsens. The legal
// consultant reads the calendar as a whole and says what the pattern means.

import { prisma } from "@/lib/db";
import { observe, type ObserveParams } from "../observations";
import { daysBetween } from "@/lib/core/obligations";
import { formatMoney, tenantCurrency } from "@/lib/core/currency";

type Finding = Omit<ObserveParams, "tenantId" | "officer">;
const DAY = 86_400_000;

/** What a tender or a main contractor will ask to see, and which of it is stale. */
export async function tenderReadiness(tenantId: string, now = new Date()) {
  const docs = await prisma.obligation.findMany({
    where: { tenantId, status: "OPEN", kind: { in: ["CERTIFICATE", "COMPLIANCE_FILING", "TAX", "LICENCE", "INSURANCE"] } },
    select: { id: true, title: true, kind: true, dueAt: true, authority: true, documentDataUrl: true },
    orderBy: { dueAt: "asc" },
  });
  const rows = docs.map((d) => {
    const days = daysBetween(now, d.dueAt);
    return { ...d, daysUntil: days, state: days < 0 ? "LAPSED" : days <= 30 ? "EXPIRING" : "CURRENT", hasCopy: Boolean(d.documentDataUrl) };
  });
  return {
    documents: rows,
    lapsed: rows.filter((r) => r.state === "LAPSED"),
    expiring: rows.filter((r) => r.state === "EXPIRING"),
    missingCopies: rows.filter((r) => !r.hasCopy),
    ready: rows.length > 0 && rows.every((r) => r.state === "CURRENT" && r.hasCopy),
  };
}

export async function runLegal(tenantId: string, now = new Date()): Promise<{ checked: number; observed: number; failed: string[] }> {
  const currency = await tenantCurrency(tenantId);
  const money = (c: number) => formatMoney(c, currency);
  let observed = 0;
  const failed: string[] = [];
  const emit = async (f: Finding) => { if (await observe({ ...f, tenantId, officer: "LEGAL" })) observed++; };

  const checks: Array<[string, () => Promise<void>]> = [
    ["noticeWindows", async () => {
      const contracts = await prisma.obligation.findMany({
        where: { tenantId, status: "OPEN", kind: "CONTRACT", autoRenews: true, noticeDays: { not: null } },
        select: { id: true, title: true, dueAt: true, noticeDays: true, amountCents: true, recurrence: true, party: { select: { name: true } } },
      });
      for (const c of contracts) {
        const actBy = new Date(c.dueAt.getTime() - (c.noticeDays ?? 0) * DAY);
        const days = daysBetween(now, actBy);
        if (days < 0 || days > 21) continue;
        await emit({
          headline: `${c.title}${c.party ? ` with ${c.party.name}` : ""} renews by itself unless notice is given by ${actBy.toISOString().slice(0, 10)} — ${days} day${days === 1 ? "" : "s"} away.`,
          detail: "Silence is a signature on an auto-renewing contract. This is the last point at which the terms, the price, or whether to keep it at all, can be renegotiated.",
          dedupeKey: `legal:notice:${c.id}`,
          subjectType: "obligation",
          subjectId: c.id,
          moneyCents: c.amountCents ? c.amountCents * (c.recurrence === "MONTHLY" ? 12 : 1) : null,
          confidence: 100,
          urgentBy: actBy,
          evidence: [{ label: "Notice by", value: actBy.toISOString().slice(0, 10) }, { label: "Renews", value: c.dueAt.toISOString().slice(0, 10) }, ...(c.amountCents ? [{ label: "Worth", value: money(c.amountCents) }] : [])],
          proposedAction: "Decide now whether to renew as is, renegotiate, or give notice. I can list what it cost you this year.",
        });
      }
    }],
    ["tenderReadiness", async () => {
      const t = await tenderReadiness(tenantId, now);
      if (t.documents.length === 0) return;
      const stale = [...t.lapsed, ...t.expiring];
      if (stale.length === 0 && t.missingCopies.length === 0) return;
      await emit({
        headline: stale.length > 0
          ? `If a tender asked today, ${stale.length} of your ${t.documents.length} compliance documents would be out of date or about to be.`
          : `${t.missingCopies.length} compliance document${t.missingCopies.length === 1 ? " has" : "s have"} a date but no copy on file — a tender desk wants the certificate, not the date.`,
        detail: "Tender and main-contractor desks check these first and disqualify on the first stale one — usually discovered the week the submission is due.",
        dedupeKey: "legal:tender-readiness",
        moneyCents: null,
        confidence: 90,
        evidence: [...stale.slice(0, 4).map((d) => ({ label: d.title, value: d.state === "LAPSED" ? `lapsed ${Math.abs(d.daysUntil)} days ago` : `expires in ${d.daysUntil} days` })), ...t.missingCopies.slice(0, 2).map((d) => ({ label: d.title, value: "no copy uploaded" }))],
        proposedAction: "Renew what is stale and upload a copy of each certificate to the compliance page, so the pack assembles itself when it is asked for.",
      });
    }],
    ["staffWithoutContracts", async () => {
      const staff = await prisma.membership.findMany({
        where: { tenantId, role: { not: "OWNER" }, createdAt: { lt: new Date(now.getTime() - 14 * DAY) } },
        select: { id: true, user: { select: { name: true, email: true } }, employmentRecords: { where: { kind: "CONTRACT" }, select: { id: true } } },
      });
      const missing = staff.filter((s) => s.employmentRecords.length === 0);
      if (missing.length === 0) return;
      await emit({
        headline: `${missing.length} team member${missing.length === 1 ? " has" : "s have"} no employment contract on file.`,
        detail: "The day a dispute, a dismissal or an injury happens is the day the signed contract is needed, and the worst day to discover there is not one.",
        dedupeKey: "legal:no-contracts",
        moneyCents: null,
        confidence: 95,
        evidence: missing.slice(0, 5).map((m) => ({ label: m.user.name ?? m.user.email, value: "no contract recorded" })),
        proposedAction: "Upload the signed contracts on each person's record, or issue contracts to those who never got one.",
      });
    }],
    ["documentsThatShouldBlock", async () => {
      const soft = await prisma.obligation.findMany({
        where: { tenantId, status: "OPEN", kind: "DOCUMENT", blocksWork: false, OR: [{ membershipId: { not: null } }, { party: { role: "SUBCONTRACTOR" } }] },
        select: { id: true, title: true },
        take: 10,
      });
      const driving = soft.filter((o) => /pdp|licen|permit|roadworth|operator|cover|insurance/i.test(o.title));
      if (driving.length === 0) return;
      await emit({
        headline: `${driving.length} driver document${driving.length === 1 ? " is" : "s are"} tracked but would not stop a run if lapsed.`,
        detail: "A reminder about an expired PDP is advice; refusing to dispatch the driver is protection. Right now these only warn.",
        dedupeKey: "legal:should-block",
        moneyCents: null,
        confidence: 80,
        evidence: driving.slice(0, 5).map((d) => ({ label: d.title, value: "warns only" })),
        proposedAction: "Turn on 'stops work' for these on the compliance page, so a lapse refuses the run instead of hoping someone reads the warning.",
      });
    }],
  ];

  for (const [name, run] of checks) {
    try { await run(); } catch (err) {
      failed.push(name);
      console.error(`[legal] ${name} failed for ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: checks.length, observed, failed };
}
