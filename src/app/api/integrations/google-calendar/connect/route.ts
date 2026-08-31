import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { googleCalendarClientCredentials, buildAuthUrl } from "@/lib/calendar/google";

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

  await requireTenantAccess(tenantId);

  const creds = await googleCalendarClientCredentials();
  if (!creds) {
    return NextResponse.redirect(
      new URL(`/dashboard/${tenantId}/settings/calendar?error=not-configured`, req.url)
    );
  }

  const redirectUri = new URL("/api/integrations/google-calendar/callback", req.url).toString();
  const authUrl = buildAuthUrl({ clientId: creds.clientId, redirectUri, state: tenantId });

  return NextResponse.redirect(authUrl);
}
