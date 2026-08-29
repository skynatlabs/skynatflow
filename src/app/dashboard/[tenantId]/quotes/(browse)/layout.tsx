import { TransactionListPanel } from "@/components/dashboard/TransactionListPanel";

export default async function QuotesBrowseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  return (
    <div className="flex h-screen">
      <TransactionListPanel tenantId={tenantId} type="QUOTE" basePath={`/dashboard/${tenantId}/quotes`} />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
