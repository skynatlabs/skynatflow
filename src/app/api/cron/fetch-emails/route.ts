// Hit on a schedule (e.g. every 15 min) to poll every active IMAP
// EmailAccount for new mail. Flow-hosted accounts don't need polling —
// they arrive via the inbound webhook instead.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchNewImapEmails } from "@/lib/core/email";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.emailAccount.findMany({
    where: { provider: "IMAP", isActive: true },
  });

  let totalFetched = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const result = await fetchNewImapEmails(account.id);
      totalFetched += result.fetched;
    } catch (err) {
      errors.push(`${account.emailAddress}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return NextResponse.json({ ok: true, accountsChecked: accounts.length, totalFetched, errors });
}
