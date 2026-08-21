import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { updateProductAction, toggleProductActiveAction } from "../actions";
import { ProductForm } from "../ProductForm";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ tenantId: string; productId: string }>;
}) {
  const { tenantId, productId } = await params;
  const product = await prisma.item.findUnique({ where: { id: productId } });
  if (!product || product.tenantId !== tenantId) notFound();

  return (
    <main className="mx-auto max-w-md p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Edit product</h1>
        <form action={toggleProductActiveAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="nextActive" value={(!product.isActive).toString()} />
          <button type="submit" className="kb-pill text-xs">
            {product.isActive ? "Hide from catalog" : "Unhide"}
          </button>
        </form>
      </div>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        {product.isActive
          ? "Visible in the catalog picker on new quotes."
          : "Hidden — won't show up when building a new quote, but past quotes referencing it are unaffected."}
      </p>
      <ProductForm
        action={updateProductAction}
        tenantId={tenantId}
        productId={productId}
        initial={product}
        submitLabel="Save changes"
      />
    </main>
  );
}
