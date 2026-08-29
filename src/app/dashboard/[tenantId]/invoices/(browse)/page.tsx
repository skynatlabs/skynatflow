export default async function InvoicesIndexPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <p className="text-sm text-[var(--kb-text-dim)]">
        Select an invoice from the list. New invoices come from converting an accepted quote or a
        cash sale.
      </p>
    </div>
  );
}
