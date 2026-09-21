"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { NicheSkin } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createPdfTemplate } from "@/lib/core/pdfTemplates";
import { applyProposal, describeApplied } from "@/lib/onboarding/apply";
import { finishOnboarding, nextStep, setStep, type StepKey } from "@/lib/onboarding/progress";
import { BANKING_FIELDS, BUSINESS_FIELDS, type AcceptedProposal, type Proposal } from "@/lib/onboarding/proposal";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // Setting up writes the business's own details, so it is the owner's screen.
  assertCan(access, "staff:manage");
  return access;
}

/**
 * The workspace itself.
 *
 * Whatever was read before it existed — the registration certificate, the
 * letterhead, the website — is applied here, so the next screen opens with
 * the business's own details in it rather than empty boxes.
 */
export async function startWorkspaceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const name = String(formData.get("businessName") ?? "").trim();
  const niche = String(formData.get("niche") ?? "") as NicheSkin;
  const ownerPhone = String(formData.get("ownerPhone") ?? "").trim();
  const raw = String(formData.get("proposalJson") ?? "");

  let proposal: Proposal | null = null;
  try {
    proposal = raw ? (JSON.parse(raw) as Proposal) : null;
  } catch {
    // A hint that did not survive the trip is not worth failing setup over.
  }

  const { startWorkspace } = await import("@/lib/onboarding/progress");
  const tenant = await startWorkspace({
    userId: session.user.id,
    name,
    niche,
    ownerPhone,
    countryCode: proposal?.business.countryCode?.value ?? null,
  });

  if (proposal) {
    const values = <T extends string>(keys: readonly T[], found: Record<string, { value: string } | undefined>) =>
      Object.fromEntries(keys.filter((k) => found[k]?.value).map((k) => [k, found[k]!.value])) as Partial<Record<T, string>>;
    // The name the owner typed wins over the name on the paperwork.
    const business = values(BUSINESS_FIELDS, proposal.business as Record<string, { value: string }>);
    delete business.name;
    await applyProposal(tenant.id, {
      business,
      banking: values(BANKING_FIELDS, proposal.banking as Record<string, { value: string }>),
      obligations: [],
      customers: [],
      suppliers: [],
      products: [],
    });

    if (proposal.documents.length > 0) {
      await prisma.intakeDocument.createMany({
        data: proposal.documents.slice(0, 20).map((d) => ({
          tenantId: tenant.id,
          fileName: d.fileName,
          mediaType: d.kind === "website" ? "text/html" : "application/octet-stream",
          kind: d.kind,
          summary: d.summary,
          status: "APPLIED",
          appliedAt: new Date(),
          reading: JSON.parse(JSON.stringify({ confidence: d.confidence, notes: d.notes })),
        })),
      });
    }

    const logo = proposal.logoDataUrl?.value;
    if (logo?.startsWith("data:image/")) {
      try {
        await createPdfTemplate({ tenantId: tenant.id, name: "Default", styleKey: "minimal-mono", logoDataUrl: logo, isDefault: true });
      } catch {
        // The look step asks for a logo again if this did not take.
      }
    }
  }

  redirect(`/onboarding/${tenant.id}/details`);
}

export interface ApplyActionResult {
  ok: boolean;
  message: string;
  lines: string[];
}

/** Write down what the owner ticked on the review screen. */
export async function applyProposalAction(tenantId: string, accepted: AcceptedProposal): Promise<ApplyActionResult> {
  await guard(tenantId);
  try {
    const result = await applyProposal(tenantId, accepted);
    await prisma.intakeDocument.updateMany({
      where: { tenantId, status: "READ" },
      data: { status: "APPLIED", appliedAt: new Date() },
    });
    revalidatePath(`/dashboard/${tenantId}`, "layout");
    const lines = describeApplied(result);
    return { ok: true, message: lines.join(" "), lines: [...lines, ...result.problems] };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "That could not be saved.", lines: [] };
  }
}

/** The details form, typed rather than read off a document. */
export async function saveDetailsAction(tenantId: string, formData: FormData) {
  await guard(tenantId);
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const data: Record<string, string | null> = {};
  for (const key of [...BUSINESS_FIELDS, ...BANKING_FIELDS] as readonly string[]) {
    if (key === "registeredOn" || key === "tradingName" || key === "website" || key === "countryCode") continue;
    if (formData.has(key)) data[key] = text(key) || null;
  }
  const country = text("countryCode").toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) data.countryCode = country;
  if (Object.keys(data).length > 0) await prisma.tenant.update({ where: { id: tenantId }, data });

  await setStep(tenantId, "stock");
  revalidatePath(`/dashboard/${tenantId}`, "layout");
  redirect(`/onboarding/${tenantId}/stock`);
}

/** Move on, whether or not anything was brought in on this step. */
export async function continueAction(tenantId: string, step: StepKey) {
  await guard(tenantId);
  const next = nextStep(step);
  if (!next) {
    await finishOnboarding(tenantId);
    redirect(`/dashboard/${tenantId}/brief/welcome`);
  }
  await setStep(tenantId, next);
  redirect(`/onboarding/${tenantId}/${next}`);
}

/** The logo and the layout every document goes out with. */
export async function saveLookAction(tenantId: string, formData: FormData) {
  await guard(tenantId);
  const logoDataUrl = String(formData.get("logoDataUrl") ?? "").trim();
  const styleKey = String(formData.get("styleKey") ?? "minimal-mono").trim();

  const existing = await prisma.tenantPdfTemplate.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  if (existing) {
    await prisma.tenantPdfTemplate.update({
      where: { id: existing.id },
      data: { styleKey, ...(logoDataUrl.startsWith("data:image/") ? { logoDataUrl } : {}) },
    });
  } else {
    await createPdfTemplate({
      tenantId,
      name: "Default",
      styleKey,
      logoDataUrl: logoDataUrl.startsWith("data:image/") ? logoDataUrl : undefined,
      isDefault: true,
    });
  }

  await finishOnboarding(tenantId);
  revalidatePath(`/dashboard/${tenantId}`, "layout");
  redirect(`/dashboard/${tenantId}/brief/welcome`);
}

/** Leave the rest for later — the officers can finish it from the Brief. */
export async function skipToWorkspaceAction(tenantId: string) {
  await guard(tenantId);
  await finishOnboarding(tenantId);
  redirect(`/dashboard/${tenantId}/brief/welcome`);
}
