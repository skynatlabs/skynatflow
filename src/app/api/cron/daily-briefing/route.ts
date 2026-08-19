// Hit once a day by Hostinger Cron Jobs. Sends each tenant's owner the
// "one daily action, not a dashboard" WhatsApp summary from the strategic
// report (Section 12) — cash position and what's gone stale, in plain
// language, so the owner never has to open the app to know what needs them.

import { NextRequest, NextResponse } from "next/server";
import { findStaleTransactions } from "@/lib/core/money";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { prisma } from "@/lib/db";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenants = await prisma.tenant.findMany({
    include: { memberships: { where: { role: "OWNER" }, include: { user: true } } },
  });
  let sent = 0;

  for (const tenant of tenants) {
    // Briefs whoever holds the OWNER membership on this tenant — with the
    // Membership model, a login can own multiple businesses, so this
    // correctly targets per-business rather than per-login.
    const owner = tenant.memberships[0]?.user;
    if (!owner) continue;

    const stale = await findStaleTransactions({ tenantId: tenant.id, staleAfterDays: 3 });
    const staleTotal = stale.reduce((sum, t) => sum + t.amountCents, 0);

    const body =
      stale.length === 0
        ? `Morning! Nothing overdue right now — all quotes and invoices are up to date. Have a good one.`
        : `Morning! ${stale.length} quote${stale.length === 1 ? "" : "s"}/invoice${
            stale.length === 1 ? "" : "s"
          } gone quiet, worth ${money(staleTotal)}. The follow-up engine is already chasing them, but worth a look if any need your personal touch.`;

    if (!owner.phone) {
      console.warn(`[daily-briefing] tenant ${tenant.id} owner has no phone on file, skipping`);
      continue;
    }

    await sendWhatsAppMessage({ to: owner.phone, body });
    sent++;
  }

  return NextResponse.json({ ok: true, briefingsSent: sent });
}
