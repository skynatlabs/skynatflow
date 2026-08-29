import { ImportClient } from "./ImportClient";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Import from another platform</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Export your customers, products, quotes, or invoices as CSV from Zoho, QuickBooks,
        FreshBooks, Wave, or Xero, then bring them in here. Nothing is imported until you review
        the preview and confirm.
      </p>
      <div className="mt-6">
        <ImportClient tenantId={tenantId} />
      </div>
    </main>
  );
}
