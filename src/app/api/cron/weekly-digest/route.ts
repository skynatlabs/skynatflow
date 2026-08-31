// Hit once a week (Monday morning) by Hostinger Cron Jobs — the PA job
// "what moved, what stalled, who to watch" so an owner never has to pull
// last week's numbers together by hand. Sent by email since it's a
// heavier read than the daily WhatsApp nudge (src/app/api/cron/daily-briefing).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findStaleTransactions } from "@/lib/core/money";
import { sendEmail } from "@/lib/email/client";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const tenants = await prisma.tenant.findMany({
    include: { memberships: { where: { role: "OWNER" }, include: { user: true } } },
  });

  let sent = 0;
  for (const tenant of tenants) {
    const owner = tenant.memberships[0]?.user;
    if (!owner?.email) continue;

    const [quotesThisWeek, invoicesPaidThisWeek, newCustomers, stale] = await Promise.all([
      prisma.transaction.findMany({ where: { tenantId: tenant.id, type: "QUOTE", createdAt: { gte: weekAgo } } }),
      prisma.transaction.findMany({
        where: { tenantId: tenant.id, type: "INVOICE", status: { in: ["PAID", "PARTIALLY_PAID"] }, createdAt: { gte: weekAgo } },
      }),
      prisma.party.count({ where: { tenantId: tenant.id, role: "CUSTOMER", createdAt: { gte: weekAgo } } }),
      findStaleTransactions({ tenantId: tenant.id, staleAfterDays: 3 }),
    ]);

    const quotedTotal = quotesThisWeek.reduce((s, t) => s + t.amountCents, 0);
    const collectedTotal = invoicesPaidThisWeek.reduce((s, t) => s + t.amountCents, 0);

    const html = `
      <h2>Your week at a glance</h2>
      <ul>
        <li><strong>${quotesThisWeek.length}</strong> quotes sent, worth ${money(quotedTotal)}</li>
        <li><strong>${money(collectedTotal)}</strong> collected from invoices this week</li>
        <li><strong>${newCustomers}</strong> new ${newCustomers === 1 ? "customer" : "customers"} on file</li>
        <li><strong>${stale.length}</strong> quote${stale.length === 1 ? "" : "s"}/invoice${stale.length === 1 ? "" : "s"} gone quiet, worth ${money(stale.reduce((s, t) => s + t.amountCents, 0))}</li>
      </ul>
      <p>The follow-up engine is already chasing the quiet ones — this is just so you have the full picture without opening the dashboard.</p>
    `;

    await sendEmail({ to: owner.email, subject: `${tenant.name} — your week at a glance`, html });
    sent++;
  }

  return NextResponse.json({ ok: true, digestsSent: sent });
}
