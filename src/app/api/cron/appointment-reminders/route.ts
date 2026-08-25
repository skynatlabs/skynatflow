// Hit hourly by Hostinger Cron Jobs. Sends the 48h and 2h appointment
// reminders across every tenant — the direct fix for the no-show research
// (individual practices lose $150K-$1M/year to missed appointments).

import { NextRequest, NextResponse } from "next/server";
import { sendDueReminders } from "@/lib/core/reminders";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [sent48h, sent2h] = await Promise.all([
    sendDueReminders("48h"),
    sendDueReminders("2h"),
  ]);

  return NextResponse.json({ ok: true, sent48h, sent2h });
}
