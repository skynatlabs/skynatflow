"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { startSubscriptionPayment } from "@/lib/billing/collect";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { recordAudit } from "@/lib/core/audit";
import { AI_PROVIDERS, setTenantAiProvider, type AiProvider } from "@/lib/ai/model";

/**
 * Whose model reads this workspace's books.
 *
 * Owner-only, and audited, because it is a decision about where a business's
 * own data is sent rather than a preference about output. For most workspaces
 * this stays unset and follows the platform.
 */
export async function setWorkspaceAiProviderAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  if (access.role !== "OWNER") throw new Error("Only the owner can change the AI provider.");

  const raw = String(formData.get("provider") ?? "").trim();
  // Empty means "follow the platform", which is the default and has to stay
  // reachable — otherwise a workspace that picks one can never go back.
  const provider: AiProvider | null = raw === "" ? null : (raw as AiProvider);
  if (provider !== null && !AI_PROVIDERS.includes(provider)) {
    throw new Error("That is not a provider we run.");
  }

  await setTenantAiProvider(tenantId, provider);
  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "Tenant",
    targetId: tenantId,
    metadata: { aiProvider: provider ?? "platform default" },
  });

  revalidatePath(`/dashboard/${tenantId}/settings/usage`);
}

/**
 * Start paying for this workspace.
 *
 * The amount is never passed in — it comes from the billing engine inside
 * startSubscriptionPayment, so nothing that reaches here can choose its own
 * price.
 */
export async function startPaymentAction(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  if (access.role !== "OWNER") throw new Error("Only the owner can set up payment.");

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const result = await startSubscriptionPayment({ tenantId, baseUrl: `${proto}://${host}` });

  if (!result.ok || !result.redirectUrl) throw new Error(result.error ?? "Could not start a payment.");
  redirect(result.redirectUrl);
}
