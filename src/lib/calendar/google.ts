// Live two-way Google Calendar sync for reminders — a real OAuth
// integration (offline access, refresh token stored encrypted), distinct
// from the Google login provider in src/auth.ts (that one only ever
// needs an id token, never a Calendar-scoped refresh token). Uses raw
// fetch against the Calendar REST API rather than pulling in
// googleapis, matching this app's existing "no SDK unless the API is
// genuinely awkward without one" posture (see src/lib/pdf, src/lib/payments).

import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { getPlatformSecret } from "@/lib/platform/apiKeys";

const SCOPE = "https://www.googleapis.com/auth/calendar.events email";

export async function googleCalendarClientCredentials() {
  const [clientId, clientSecret] = await Promise.all([
    getPlatformSecret("AUTH_GOOGLE_ID"),
    getPlatformSecret("AUTH_GOOGLE_SECRET"),
  ]);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function buildAuthUrl(params: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  // Forces Google to hand back a refresh token even if this Google
  // account already granted this app access before — without this,
  // reconnecting after a disconnect silently gets no refresh token.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  }>;
}

async function refreshAccessToken(tenantId: string): Promise<string | null> {
  const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId } });
  if (!integration) return null;

  const creds = await googleCalendarClientCredentials();
  if (!creds) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decryptSecret(integration.refreshTokenEnc),
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("[calendar:google] refresh failed:", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };

  await prisma.calendarIntegration.update({
    where: { tenantId },
    data: {
      accessTokenEnc: encryptSecret(data.access_token),
      accessTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  return data.access_token;
}

// Returns a valid access token, refreshing first if the cached one has
// expired (or is about to, within a minute) — callers never have to
// think about the refresh cycle themselves.
async function getValidAccessToken(tenantId: string): Promise<string | null> {
  const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId } });
  if (!integration) return null;

  const stillValid =
    integration.accessTokenEnc &&
    integration.accessTokenExpiresAt &&
    integration.accessTokenExpiresAt.getTime() > Date.now() + 60_000;

  if (stillValid) return decryptSecret(integration.accessTokenEnc!);
  return refreshAccessToken(tenantId);
}

export async function isCalendarConnected(tenantId: string): Promise<boolean> {
  const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId } });
  return integration !== null;
}

// Creates the event if the transaction has none yet, otherwise updates
// the existing one in place — real two-way sync means a reminder's date
// changing here updates the same calendar event, not a growing pile of
// duplicates.
export async function syncReminderToCalendar(params: {
  tenantId: string;
  transactionId: string;
  summary: string;
  description: string;
  startAt: Date;
}): Promise<string | null> {
  const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId: params.tenantId } });
  if (!integration) return null;

  const accessToken = await getValidAccessToken(params.tenantId);
  if (!accessToken) return null;

  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  const existingEventId = transaction?.calendarEventId;

  const body = {
    summary: params.summary,
    description: params.description,
    start: { date: params.startAt.toISOString().slice(0, 10) },
    end: { date: params.startAt.toISOString().slice(0, 10) },
  };

  const url = existingEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(integration.calendarId)}/events/${existingEventId}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(integration.calendarId)}/events`;

  const res = await fetch(url, {
    method: existingEventId ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // The event may have been deleted on the Google side (404) — fall
    // back to creating a fresh one rather than failing the reminder save.
    if (existingEventId && res.status === 404) {
      return syncReminderToCalendar({ ...params, transactionId: params.transactionId });
    }
    console.error("[calendar:google] event sync failed:", res.status, await res.text());
    return existingEventId ?? null;
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function deleteCalendarEvent(tenantId: string, eventId: string): Promise<void> {
  const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId } });
  if (!integration) return;

  const accessToken = await getValidAccessToken(tenantId);
  if (!accessToken) return;

  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(integration.calendarId)}/events/${eventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  ).catch((err) => console.error("[calendar:google] delete failed:", err));
}
