import { TransactionListPanel } from "@/components/dashboard/TransactionListPanel";
import { BrowseShell } from "@/components/dashboard/BrowseShell";

export default async function QuotesBrowseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const basePath = `/dashboard/${tenantId}/quotes`;

  return (
    <BrowseShell basePath={basePath} listLabel="All quotes" list={<TransactionListPanel tenantId={tenantId} type="QUOTE" basePath={basePath} />}>
      {children}
    </BrowseShell>
  );
}
