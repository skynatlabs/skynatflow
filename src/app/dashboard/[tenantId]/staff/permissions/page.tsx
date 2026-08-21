import { ALL_ROLES, ALL_CAPABILITIES, capabilityMatrix } from "@/lib/core/access";

const CAPABILITY_LABELS: Record<string, string> = {
  "quote:create": "Create quotes",
  "quote:send": "Send quotes",
  "invoice:create": "Convert to invoice",
  "payment:record": "Record payments & refunds",
  "delivery:log": "Log deliveries/visits",
  "connection:invite": "Invite trading partners",
  "connection:accept": "Accept trading invites",
  "task:manage": "Manage tasks",
  "staff:manage": "Manage staff & roles",
  "product:manage": "Manage product catalog",
};

export default function PermissionsPage() {
  const matrix = capabilityMatrix();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Roles &amp; permissions</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        What each role can do, at a glance. Roles are fixed for now — assign one to each teammate
        from the Staff page.
      </p>

      <div className="kb-card mt-6 overflow-x-auto p-2">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-[var(--kb-panel-border)]">
              <th className="p-3 text-left font-medium text-[var(--kb-text-dim)]">Capability</th>
              {ALL_ROLES.map((role) => (
                <th key={role} className="p-3 text-center font-medium text-[var(--kb-text-dim)]">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_CAPABILITIES.map((cap) => (
              <tr key={cap} className="border-b border-[var(--kb-panel-border)] last:border-0">
                <td className="p-3 text-[var(--kb-text)]">{CAPABILITY_LABELS[cap] ?? cap}</td>
                {ALL_ROLES.map((role) => (
                  <td key={role} className="p-3 text-center">
                    {matrix[role].includes(cap) ? (
                      <span className="text-[var(--kb-tint-mint-ink)]">✓</span>
                    ) : (
                      <span className="text-[var(--kb-text-dim)]">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
