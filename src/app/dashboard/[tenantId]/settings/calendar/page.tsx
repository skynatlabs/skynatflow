import { prisma } from "@/lib/db";
import { googleCalendarClientCredentials } from "@/lib/calendar/google";
import { disconnectCalendarAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  "not-configured": "Google OAuth isn't set up yet — a super admin needs to add it at /admin/api-keys first.",
  "no-refresh-token": "Google didn't grant offline access. Go to myaccount.google.com/permissions, remove flow's access, then try connecting again.",
  "exchange-failed": "Something went wrong connecting to Google — try again.",
  access_denied: "You cancelled the Google sign-in.",
};

export default async function CalendarSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { tenantId } = await params;
  const { connected, error } = await searchParams;
  const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId } });
  const googleConfigured = (await googleCalendarClientCredentials()) !== null;

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Calendar sync</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Connect Google Calendar so every reminder you set on a quote or invoice shows up there too —
        live, two-way: changing a reminder's date here updates the same calendar event.
      </p>

      {connected === "1" && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          Google Calendar connected.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {ERROR_MESSAGES[error] ?? "Something went wrong — try again."}
        </p>
      )}

      <div className="kb-card mt-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-[var(--kb-text)]">Google Calendar</p>
            {integration ? (
              <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
                Connected{integration.connectedByEmail && ` as ${integration.connectedByEmail}`}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">Not connected</p>
            )}
          </div>
          {integration ? (
            <form action={disconnectCalendarAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                Disconnect
              </button>
            </form>
          ) : googleConfigured ? (
            <a
              href={`/api/integrations/google-calendar/connect?tenantId=${tenantId}`}
              className="kb-pill kb-pill-primary text-xs"
            >
              Connect Google Calendar
            </a>
          ) : (
            <span className="text-xs text-[var(--kb-text-dim)]">Not set up by admin</span>
          )}
        </div>
      </div>
    </main>
  );
}
