"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { syncWooProducts } from "@/lib/ecommerce/sync";
import { registerWooOrderWebhook } from "@/lib/ecommerce/woocommerce";

export async function connectWooCommerceAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const storeUrl = String(formData.get("storeUrl") ?? "").trim().replace(/\/$/, "");
  const consumerKey = String(formData.get("consumerKey") ?? "").trim() || null;
  const consumerSecretRaw = String(formData.get("consumerSecret") ?? "").trim();

  if (!storeUrl) throw new Error("Store URL is required.");

  const existing = await prisma.ecommerceIntegration.findUnique({
    where: { tenantId_platform: { tenantId, platform: "WOOCOMMERCE" } },
  });

  // A generated webhook secret so WooCommerce's signature can actually be
  // verified — generated once on first connect, never regenerated on
  // update, so an already-configured WooCommerce webhook doesn't silently
  // start failing signature checks.
  const webhookSecretEnc = existing?.webhookSecretEnc ?? encryptSecret(randomBytes(24).toString("hex"));

  const integration = await prisma.ecommerceIntegration.upsert({
    where: { tenantId_platform: { tenantId, platform: "WOOCOMMERCE" } },
    create: {
      tenantId,
      platform: "WOOCOMMERCE",
      storeUrl,
      consumerKey,
      consumerSecretEnc: consumerSecretRaw ? encryptSecret(consumerSecretRaw) : null,
      webhookSecretEnc,
      isActive: true,
    },
    update: {
      storeUrl,
      consumerKey,
      ...(consumerSecretRaw ? { consumerSecretEnc: encryptSecret(consumerSecretRaw) } : {}),
      isActive: true,
    },
  });

  // Auto-registers the order webhook against WooCommerce's own API so the
  // owner never has to touch wp-admin — failure here isn't fatal to
  // connecting (keys might be read-only, or store might block outbound
  // webhook registration), it just means orders won't auto-invoice until
  // fixed, same graceful-degradation posture as the rest of this app.
  if (integration.consumerKey && consumerSecretRaw) {
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://skynatflow.com";
    await registerWooOrderWebhook({
      storeUrl,
      consumerKey: integration.consumerKey,
      consumerSecret: consumerSecretRaw,
      deliveryUrl: `${base}/api/webhooks/woocommerce/${integration.id}`,
      secret: decryptSecret(integration.webhookSecretEnc!),
    }).catch((err) => console.error("[woocommerce] webhook registration failed:", err));
  }

  revalidatePath(`/dashboard/${tenantId}/settings/ecommerce`);
}

export async function disconnectWooCommerceAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await prisma.ecommerceIntegration.updateMany({
    where: { tenantId, platform: "WOOCOMMERCE" },
    data: { isActive: false },
  });
  revalidatePath(`/dashboard/${tenantId}/settings/ecommerce`);
}

export async function syncWooProductsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "product:manage");

  const integration = await prisma.ecommerceIntegration.findUniqueOrThrow({
    where: { tenantId_platform: { tenantId, platform: "WOOCOMMERCE" } },
  });
  await syncWooProducts(integration.id);
  revalidatePath(`/dashboard/${tenantId}/settings/ecommerce`);
}
