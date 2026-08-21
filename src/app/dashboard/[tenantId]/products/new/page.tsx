import { createProductAction } from "../actions";
import { ProductForm } from "../ProductForm";

export default async function NewProductPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Add a product or service</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Add it once — every future quote picks it straight from the catalog.
      </p>
      <ProductForm action={createProductAction} tenantId={tenantId} submitLabel="Add product" />
    </main>
  );
}
