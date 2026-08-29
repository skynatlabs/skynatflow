// The two operations behind "connect WooCommerce": pull products on
// demand, and turn an incoming order webhook into a real flow invoice —
// same append-only ledger (createQuote → sendQuote → convertToInvoice
// path is for the owner's own quoting flow; a Woo order already has an
// agreed price, so this writes the INVOICE Transaction directly, the
// same way recordCashSale does for an in-person sale).

import { PartyRole, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { getOrCreatePortalToken } from "@/lib/core/parties";
import { sendEmail } from "@/lib/email/client";
import { fetchWooProducts, wooPriceToCents, type WooOrder } from "./woocommerce";

export async function syncWooProducts(integrationId: string) {
  const integration = await prisma.ecommerceIntegration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  if (!integration.consumerKey || !integration.consumerSecretEnc) {
    throw new Error("Connect your WooCommerce store's API keys first.");
  }

  const products = await fetchWooProducts({
    storeUrl: integration.storeUrl,
    consumerKey: integration.consumerKey,
    consumerSecret: decryptSecret(integration.consumerSecretEnc),
  });

  let created = 0;
  let updated = 0;

  for (const p of products) {
    const unitPriceCents = wooPriceToCents(p.price || p.regular_price);
    const existing = p.sku
      ? await prisma.item.findFirst({ where: { tenantId: integration.tenantId, sku: p.sku } })
      : null;

    if (existing) {
      await prisma.item.update({
        where: { id: existing.id },
        data: {
          name: p.name,
          unitPriceCents,
          stockQty: p.stock_quantity ?? existing.stockQty,
          category: p.categories?.[0]?.name ?? existing.category,
        },
      });
      updated++;
    } else {
      await prisma.item.create({
        data: {
          tenantId: integration.tenantId,
          name: p.name,
          sku: p.sku || undefined,
          unitPriceCents,
          stockQty: p.stock_quantity ?? undefined,
          category: p.categories?.[0]?.name,
        },
      });
      created++;
    }
  }

  await prisma.ecommerceIntegration.update({
    where: { id: integrationId },
    data: { lastProductSyncAt: new Date() },
  });

  return { created, updated, total: products.length };
}

// Idempotent by design: EcommerceOrder has a unique (integrationId,
// externalOrderId), so a WooCommerce webhook retry — which WooCommerce
// does on anything but a 200 response — just finds the existing row and
// returns instead of creating a second invoice for the same order.
export async function processWooOrder(integrationId: string, order: WooOrder) {
  const integration = await prisma.ecommerceIntegration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const existing = await prisma.ecommerceOrder.findUnique({
    where: { integrationId_externalOrderId: { integrationId, externalOrderId: String(order.id) } },
  });
  if (existing) return existing;

  const customerName = [order.billing.first_name, order.billing.last_name].filter(Boolean).join(" ") || "WooCommerce customer";

  const party =
    (order.billing.email &&
      (await prisma.party.findFirst({ where: { tenantId: integration.tenantId, email: order.billing.email } }))) ||
    (await prisma.party.create({
      data: {
        tenantId: integration.tenantId,
        role: PartyRole.CUSTOMER,
        name: customerName,
        email: order.billing.email || undefined,
        phone: order.billing.phone || undefined,
      },
    }));

  // Match line items to the synced catalog by SKU when possible; fall
  // back to a throwaway Item so an order never fails to invoice just
  // because a product wasn't in the last catalog sync.
  const lines = [];
  for (const li of order.line_items) {
    const item =
      (li.sku && (await prisma.item.findFirst({ where: { tenantId: integration.tenantId, sku: li.sku } }))) ||
      (await prisma.item.create({
        data: {
          tenantId: integration.tenantId,
          name: li.name,
          sku: li.sku || undefined,
          unitPriceCents: li.quantity > 0 ? Math.round(wooPriceToCents(li.total) / li.quantity) : wooPriceToCents(li.total),
        },
      }));
    lines.push({
      itemId: item.id,
      quantity: li.quantity,
      unitPriceCents: li.quantity > 0 ? Math.round(wooPriceToCents(li.total) / li.quantity) : wooPriceToCents(li.total),
    });
  }

  const amountCents = wooPriceToCents(order.total);

  const invoice = await prisma.transaction.create({
    data: {
      tenantId: integration.tenantId,
      partyId: party.id,
      type: TransactionType.INVOICE,
      status: TransactionStatus.SENT,
      amountCents,
      itemLines: { create: lines },
    },
  });

  const ecommerceOrder = await prisma.ecommerceOrder.create({
    data: {
      tenantId: integration.tenantId,
      integrationId,
      externalOrderId: String(order.id),
      invoiceId: invoice.id,
    },
  });

  if (order.billing.email) {
    const token = await getOrCreatePortalToken(party.id);
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://skynatflow.com";
    const amountFormatted = (amountCents / 100).toLocaleString(undefined, {
      style: "currency",
      currency: order.currency || "ZAR",
    });
    await sendEmail({
      to: order.billing.email,
      subject: `Your invoice for order #${order.id}`,
      html: `
        <p>Hi ${customerName},</p>
        <p>Thanks for your order! Here's your invoice for <strong>${amountFormatted}</strong>.</p>
        <p><a href="${base}/portal/${token}/invoices/${invoice.id}">View and download your invoice</a></p>
      `,
    });
  }

  return ecommerceOrder;
}
