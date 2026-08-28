import { prisma } from "@/lib/db";
import { saveAutomationSettingsAction } from "./actions";

const WINDOW_OPTIONS = [
  { value: 0, label: "Same day" },
  { value: 1, label: "Next day" },
  { value: 3, label: "After 3 days" },
  { value: 7, label: "After a week" },
];

const REPEAT_OPTIONS = [
  { value: 1, label: "Every day" },
  { value: 3, label: "Every 3 days" },
  { value: 7, label: "Weekly" },
  { value: 14, label: "Every 2 weeks" },
];

export default async function AutomationSettingsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Follow-up automation</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Control when follow-ups fire, and whether they need your OK first or send themselves —
        take the daily chase-up task off your plate entirely if you want.
      </p>

      <form action={saveAutomationSettingsAction} className="kb-card mt-6 space-y-5 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />

        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">First follow-up after</label>
          <select name="followUpWindowDays" defaultValue={tenant.followUpWindowDays} className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">Then repeat</label>
          <select name="followUpRepeatDays" defaultValue={tenant.followUpRepeatDays} className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
            {REPEAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-[var(--kb-panel-border)] p-4">
          <input type="checkbox" name="autoRespondEnabled" defaultChecked={tenant.autoRespondEnabled} className="h-4 w-4" />
          <span>
            <span className="block text-sm font-medium text-[var(--kb-text)]">Auto-respond, no approval needed</span>
            <span className="block text-xs text-[var(--kb-text-dim)]">
              When off (default), every AI-drafted follow-up waits in AI Drafts for you to Approve.
              When on, it sends itself the moment it&apos;s due.
            </span>
          </span>
        </label>

        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-2.5">Save</button>
      </form>
    </main>
  );
}
