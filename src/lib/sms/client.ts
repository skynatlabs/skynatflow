// Thin wrapper around a Twilio-class SMS API — same graceful-degradation
// shape as src/lib/whatsapp/client.ts. Needs TWILIO_ACCOUNT_SID /
// TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER in .env — this is a checkpoint,
// same as WhatsApp/R2 storage were: the code path is ready, a real number
// just hasn't been purchased/connected yet.

export interface SendSmsParams {
  to: string; // E.164
  body: string;
}

export async function sendSms({ to, body }: SendSmsParams) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn(`[sms:stub] would send to ${to}: ${body} (TWILIO_* not set)`);
    return { stub: true, to, body };
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SMS send failed: ${res.status} ${text}`);
  }

  return res.json();
}
