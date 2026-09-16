import { TransactionListPanel } from "@/components/dashboard/TransactionListPanel";
import { BrowseShell } from "@/components/dashboard/BrowseShell";

export default async function InvoicesBrowseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const basePath = `/dashboard/${tenantId}/invoices`;

  return (
    <BrowseShell basePath={basePath} listLabel="All invoices" list={<TransactionListPanel tenantId={tenantId} type="INVOICE" basePath={basePath} />}>
      {children}
    </BrowseShell>
  );
}
