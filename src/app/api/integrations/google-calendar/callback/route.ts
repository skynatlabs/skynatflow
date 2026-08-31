import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { googleCalendarClientCredentials, exchangeCodeForTokens } from "@/lib/calendar/google";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const tenantId = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (!tenantId) return NextResponse.json({ error: "Missing state" }, { status: 400 });

  // The user themselves cancelling the Google consent screen — not a bug,
  // just send them back to settings with nothing changed.
  if (errorParam) {
    return NextResponse.redirect(new URL(`/dashboard/${tenantId}/settings/calendar?error=${errorParam}`, req.url));
  }
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  // Re-validated here, not just at /connect — the state round-trips
  // through Google, so this is the actual authorization check before
  // anything gets written for this tenant.
  await requireTenantAccess(tenantId);

  const creds = await googleCalendarClientCredentials();
  if (!creds) {
    return NextResponse.redirect(
      new URL(`/dashboard/${tenantId}/settings/calendar?error=not-configured`, req.url)
    );
  }

  const redirectUri = new URL("/api/integrations/google-calendar/callback", req.url).toString();

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri,
    });

    if (!tokens.refresh_token) {
      // Happens if this Google account already granted access before and
      // Google didn't re-issue a refresh token despite prompt=consent —
      // rare, but tell the owner to revoke access at
      // myaccount.google.com/permissions and try again rather than
      // silently storing an integration with no way to refresh.
      return NextResponse.redirect(
        new URL(`/dashboard/${tenantId}/settings/calendar?error=no-refresh-token`, req.url)
      );
    }

    // Fetch the connected account's email for display — small aid so an
    // owner can tell at a glance whether the right Google account is connected.
    let connectedByEmail: string | undefined;
    try {
      const userinfo = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userinfo.ok) connectedByEmail = (await userinfo.json()).email;
    } catch {
      // Non-fatal — the integration still works without a display email.
    }

    await prisma.calendarIntegration.upsert({
      where: { tenantId },
      create: {
        tenantId,
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        accessTokenEnc: encryptSecret(tokens.access_token),
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        connectedByEmail,
      },
      update: {
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        accessTokenEnc: encryptSecret(tokens.access_token),
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        connectedByEmail,
      },
    });

    return NextResponse.redirect(new URL(`/dashboard/${tenantId}/settings/calendar?connected=1`, req.url));
  } catch (err) {
    console.error("[calendar:google] callback failed:", err);
    return NextResponse.redirect(new URL(`/dashboard/${tenantId}/settings/calendar?error=exchange-failed`, req.url));
  }
}
