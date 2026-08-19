// Inbound WhatsApp webhook. Every reply from a customer gets matched to a
// Party by phone number and logged — this is what keeps WhatsApp
// conversation history attached to the customer record instead of living
// only inside a chat app, per the strategic report's Section 7.1.

import { NextRequest, NextResponse } from "next/server";
import { findPartyByPhone } from "@/lib/core/parties";

// BSP webhook verification handshake (Meta-style challenge/response).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const payload = await req.json();

  // Shape varies by BSP — this assumes a 360dialog/Meta-style payload.
  // Real parsing gets filled in once a real WhatsApp account is connected
  // (Phase 2 checkpoint) and we can see the actual payload shape.
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) {
    return NextResponse.json({ ok: true }); // ignore non-message webhooks (status updates etc.)
  }

  const fromPhone: string = message.from;
  const text: string | undefined = message.text?.body;

  // NOTE: tenantId resolution by inbound WhatsApp number is not yet wired —
  // needs a tenant<->WhatsApp-number mapping once multiple tenants are live.
  // Left as a TODO rather than guessed, since getting this wrong silently
  // cross-contaminates tenant data.
  // const tenantId = await resolveTenantByWhatsAppNumber(payload.entry[0].changes[0].value.metadata.phone_number_id);

  console.log(`[whatsapp:webhook] inbound from ${fromPhone}: ${text}`);

  // Once tenant resolution above is wired, this looks the sender up against
  // that tenant's Party records so the reply attaches to the right customer.
  // const party = await findPartyByPhone(tenantId, fromPhone);
  void findPartyByPhone;

  return NextResponse.json({ ok: true });
}
