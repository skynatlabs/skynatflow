import Link from "next/link";

export default async function QuotesIndexPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <p className="text-sm text-[var(--kb-text-dim)]">Select a quote from the list, or</p>
      <Link href={`/dashboard/${tenantId}/quotes/new`} className="kb-pill kb-pill-primary mt-3 text-sm">
        + New quote
      </Link>
    </div>
  );
}
