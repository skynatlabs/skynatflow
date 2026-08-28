// Receives an inbound-parse webhook for a flow-hosted forwarding address
// (e.g. "acme-co@mail.flow.skynat.co"). Checkpoint: this endpoint is real
// code, but actually receiving mail here needs an inbound-parse provider
// (Postmark/Mailgun/SendGrid-class) configured with MX records pointed
// at it — that's an external account + DNS setup, not something this
// code can complete on its own. Shaped generically (to/from/subject/text)
// so swapping providers later doesn't change this handler.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ingestEmail } from "@/lib/core/email";

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.INBOUND_EMAIL_WEBHOOK_SECRET && secret !== process.env.INBOUND_EMAIL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const to = String(body.to ?? "").toLowerCase().trim();
  const from = String(body.from ?? "").trim();
  const subject = String(body.subject ?? "(no subject)");
  const text = String(body.text ?? "");

  const account = await prisma.emailAccount.findFirst({
    where: { provider: "FLOW_HOSTED", flowInboundAddress: to, isActive: true },
  });
  if (!account) {
    return NextResponse.json({ error: "No matching flow-hosted address" }, { status: 404 });
  }

  await ingestEmail({
    tenantId: account.tenantId,
    emailAccountId: account.id,
    fromAddress: from,
    subject,
    bodyText: text,
    receivedAt: new Date(),
  });

  return NextResponse.json({ ok: true });
}
