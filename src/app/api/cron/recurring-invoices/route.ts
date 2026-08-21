// Hit on a schedule (e.g. daily) by Hostinger Cron Jobs. Generates every
// invoice whose recurring template has come due, and advances the
// template's schedule — the actual send-notification step reuses whatever
// channel the owner already uses (WhatsApp), same as a manually-created
// invoice would, once that's wired up; for now the invoice lands as SENT
// and is visible on the customer's portal + dashboard immediately.

import { NextRequest, NextResponse } from "next/server";
import { runDueRecurringInvoices } from "@/lib/core/recurring";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runDueRecurringInvoices();
  return NextResponse.json({ ok: true, ...result });
}
