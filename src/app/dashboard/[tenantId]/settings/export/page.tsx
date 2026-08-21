export default async function ExportPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const exports = [
    {
      entity: "customers",
      label: "Customers",
      desc: "Every customer/patient/client record, with contact details.",
    },
    {
      entity: "products",
      label: "Products & services",
      desc: "Your full catalog — pricing, cost, tax, stock.",
    },
    {
      entity: "transactions",
      label: "Quotes, invoices & payments",
      desc: "The complete ledger — every transaction, status, and amount.",
    },
  ];

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Export your data</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Everything, in plain CSV, no support ticket required. You can leave any time and take your
        whole business with you.
      </p>

      <div className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {exports.map((e) => (
          <div key={e.entity} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="font-medium text-[var(--kb-text)]">{e.label}</p>
              <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{e.desc}</p>
            </div>
            <a
              href={`/dashboard/${tenantId}/settings/export/${e.entity}`}
              className="kb-pill kb-pill-primary shrink-0 text-xs"
            >
              Download CSV
            </a>
          </div>
        ))}
      </div>
    </main>
  );
}
