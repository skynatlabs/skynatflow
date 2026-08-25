// Missed-call auto-text-back — code-complete and ready the moment a real
// Twilio-class number is connected (see the TWILIO_* checkpoint in
// src/lib/sms/client.ts). Configured as this business's voice webhook, it
// fires the instant a call goes unanswered — the direct fix for the
// research finding that 62% of inbound calls to home-services businesses
// go unanswered, and 85% of those callers never call back.
//
// Expects a query param ?tenantId=... (one number per tenant, matching
// how the mobile driver API is scoped) and Twilio's standard voice-status
// form fields (From, CallStatus).

import { NextRequest, NextResponse } from "next/server";
import { findPartyByPhone, createParty } from "@/lib/core/parties";
import { sendSms } from "@/lib/sms/client";
import { prisma } from "@/lib/db";

const MISSED_STATUSES = new Set(["no-answer", "busy", "failed"]);

export async function POST(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const form = await req.formData();
  const from = String(form.get("From") ?? "");
  const callStatus = String(form.get("CallStatus") ?? "");

  if (!from || !MISSED_STATUSES.has(callStatus)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return NextResponse.json({ error: "Unknown tenant" }, { status: 404 });

  let party = await findPartyByPhone(tenantId, from);
  if (!party) {
    party = await createParty({ tenantId, role: "CUSTOMER", name: "Missed call", phone: from });
  }

  await sendSms({
    to: from,
    body: `Hi! Sorry we missed your call to ${tenant.name} — we'll call you right back. In the meantime, tell us what you need and we'll get started.`,
  });

  await prisma.event.create({
    data: {
      tenantId,
      partyId: party.id,
      type: "FOLLOW_UP_SENT",
      notes: "Missed-call auto-text-back sent",
    },
  });

  return NextResponse.json({ ok: true });
}
