import { listActiveInvolvements, listDonations, listComplianceFilings, totalDonationsByFund } from "@/lib/core/nonprofit";
import { listCustomers } from "@/lib/core/parties";
import { addMemberAction, endInvolvementAction, recordDonationAction, addFilingAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function MembersPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [involvements, donations, filings, funds, members] = await Promise.all([
    listActiveInvolvements(tenantId),
    listDonations(tenantId),
    listComplianceFilings(tenantId),
    totalDonationsByFund(tenantId),
    listCustomers(tenantId, ["MEMBER", "SPONSOR"]),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Members &amp; donors</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Involvement history, donations, and compliance records — kept so &quot;were they involved,
        and when&quot; is always answerable, not lost to a spreadsheet nobody kept up to date.
      </p>

      {/* Active involvements */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Active involvement</h2>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {involvements.map((i) => (
            <li key={i.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{i.party.name}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {i.role} · since {i.startDate.toLocaleDateString()}
                </p>
              </div>
              <form action={endInvolvementAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="involvementId" value={i.id} />
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">End</button>
              </form>
            </li>
          ))}
          {involvements.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">No active members yet.</li>
          )}
        </ul>

        <form action={addMemberAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Name</span>
            <input name="name" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Phone</span>
            <input name="phone" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Role</span>
            <select name="role" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              <option value="MEMBER">Member</option>
              <option value="VOLUNTEER">Volunteer</option>
              <option value="BOARD">Board</option>
              <option value="SPONSOR">Sponsor / Partner</option>
            </select>
          </label>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Add</button>
        </form>
      </section>

      {/* Donations */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Donations</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {funds.map((f) => (
            <span key={f.fund} className="kb-pill kb-pill-ghost text-xs">
              {f.fund}: {money(f.totalCents)}
            </span>
          ))}
        </div>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {donations.slice(0, 10).map((d) => (
            <li key={d.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{d.party.name}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {d.designatedFund ?? "General"} · {d.donatedAt.toLocaleDateString()}
                </p>
              </div>
              <span className="text-sm font-semibold text-[var(--kb-text)]">{money(d.amountCents)}</span>
            </li>
          ))}
          {donations.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">No donations recorded yet.</li>
          )}
        </ul>

        <form action={recordDonationAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Donor</span>
            <select name="partyId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Amount (R)</span>
            <input name="amountRand" type="number" step="0.01" required className="mt-1 w-28 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Fund (optional)</span>
            <input name="designatedFund" placeholder="General" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Record</button>
        </form>
      </section>

      {/* Compliance filings */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Compliance filings</h2>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {filings.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-5 py-3">
              <p className="font-medium text-[var(--kb-text)]">{f.filingType}</p>
              <p className="text-xs text-[var(--kb-text-dim)]">{f.filingDate.toLocaleDateString()}</p>
            </li>
          ))}
          {filings.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">Nothing filed yet.</li>
          )}
        </ul>

        <form action={addFilingAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Filing type</span>
            <input name="filingType" placeholder="Annual Return" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Date</span>
            <input name="filingDate" type="date" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Log filing</button>
        </form>
      </section>
    </main>
  );
}
