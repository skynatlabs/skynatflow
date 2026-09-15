// Moving in, and how far along it is.
//
// The steps are read off the workspace rather than stored as a checklist:
// a business that imported its stock has done that step whether or not it
// walked through the screen, and one that skipped a step is never told it is
// finished. Only where the owner is right now is remembered, so closing the
// laptop halfway through costs nothing.

import { NicheSkin } from "@prisma/client";
import { prisma } from "@/lib/db";

export const STEPS = [
  { key: "business", label: "Your business", blurb: "Who you are and what you do." },
  { key: "details", label: "Details & dates", blurb: "What goes on an invoice, and what the law wants." },
  { key: "stock", label: "What you sell", blurb: "Your products and prices." },
  { key: "customers", label: "Customers", blurb: "Who you sell to, and what they owe." },
  { key: "look", label: "Your look", blurb: "Your logo on every document." },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export const STEP_KEYS = STEPS.map((s) => s.key) as StepKey[];

export function nextStep(step: StepKey): StepKey | null {
  const at = STEP_KEYS.indexOf(step);
  return at >= 0 && at < STEP_KEYS.length - 1 ? STEP_KEYS[at + 1] : null;
}

export interface StartWorkspaceParams {
  userId: string;
  name: string;
  niche: NicheSkin;
  ownerPhone?: string | null;
  countryCode?: string | null;
}

/** The workspace itself, the moment there is a name and a trade to give it. */
export async function startWorkspace(params: StartWorkspaceParams) {
  const name = params.name.trim();
  if (!name) throw new Error("Your business needs a name.");
  if (!Object.values(NicheSkin).includes(params.niche)) throw new Error("Pick what kind of business this is.");

  const tenant = await prisma.tenant.create({
    data: {
      name,
      niche: params.niche,
      countryCode: params.countryCode?.trim().toUpperCase() || null,
      onboardingStep: "details",
    },
  });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: params.userId, role: "OWNER" } });
  if (params.ownerPhone?.trim()) {
    await prisma.user.update({ where: { id: params.userId }, data: { phone: params.ownerPhone.trim() } });
  }
  return tenant;
}

export async function setStep(tenantId: string, step: StepKey) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { onboardingStep: step } });
}

/** Moving in is over: the officers take it from here. */
export async function finishOnboarding(tenantId: string) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { onboardedAt: new Date(), onboardingStep: null },
  });
}

export interface OnboardingState {
  finished: boolean;
  /** Where they were last, for resuming. */
  step: StepKey;
  done: Record<StepKey, boolean>;
  remaining: Array<{ key: StepKey; label: string }>;
  counts: { products: number; customers: number; documents: number };
}

export async function onboardingState(tenantId: string): Promise<OnboardingState> {
  const [tenant, products, customers, templates, documents] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { onboardingStep: true, onboardedAt: true, businessAddress: true, vatNumber: true, bankAccountNumber: true, registrationNumber: true },
    }),
    prisma.item.count({ where: { tenantId } }),
    prisma.party.count({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] } } }),
    prisma.tenantPdfTemplate.count({ where: { tenantId, logoDataUrl: { not: null } } }),
    prisma.intakeDocument.count({ where: { tenantId } }),
  ]);

  const done: Record<StepKey, boolean> = {
    business: true,
    details: Boolean(tenant.businessAddress || tenant.vatNumber || tenant.bankAccountNumber || tenant.registrationNumber),
    stock: products > 0,
    customers: customers > 0,
    look: templates > 0,
  };

  const step = (STEP_KEYS.includes(tenant.onboardingStep as StepKey) ? tenant.onboardingStep : STEP_KEYS.find((k) => !done[k]) ?? "details") as StepKey;

  return {
    finished: Boolean(tenant.onboardedAt),
    step,
    done,
    remaining: STEPS.filter((s) => !done[s.key]).map((s) => ({ key: s.key, label: s.label })),
    counts: { products, customers, documents },
  };
}

/** What was read on the way in, newest first — every field can say where it came from. */
export async function listIntakeDocuments(tenantId: string, take = 20) {
  return prisma.intakeDocument.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, fileName: true, kind: true, summary: true, status: true, createdAt: true },
  });
}
