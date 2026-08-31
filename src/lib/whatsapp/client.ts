// Thin wrapper around the WhatsApp Business API (via a BSP such as
// 360dialog or Twilio). WhatsApp is a first-class channel, not a bolted-on
// integration — every send goes through here so the message also gets
// logged against the right customer record.
//
// Needs WHATSAPP_API_KEY / WHATSAPP_PHONE_NUMBER_ID — settable at
// /admin/api-keys (checked first) or as env vars (fallback).

import { getPlatformSecret } from "@/lib/platform/apiKeys";

export interface SendWhatsAppMessageParams {
  to: string; // E.164, e.g. "+27821234567"
  body: string;
}

export async function sendWhatsAppMessage({ to, body }: SendWhatsAppMessageParams) {
  const [apiKey, phoneNumberId] = await Promise.all([
    getPlatformSecret("WHATSAPP_API_KEY"),
    getPlatformSecret("WHATSAPP_PHONE_NUMBER_ID"),
  ]);

  if (!apiKey || !phoneNumberId) {
    // No credentials configured yet — this is expected until the Phase 2
    // checkpoint is resolved. Log instead of failing so local dev/tests
    // can proceed without a real WhatsApp account.
    console.warn(
      `[whatsapp:stub] would send to ${to}: ${body} (WHATSAPP_API_KEY not set)`
    );
    return { stub: true, to, body };
  }

  const res = await fetch(
    `https://waba-v2.360dialog.io/messages`,
    {
      method: "POST",
      headers: {
        "D360-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        type: "text",
        text: { body },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
