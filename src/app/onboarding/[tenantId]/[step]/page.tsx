// Moving in, one step at a time.
//
// Every step saves as it goes and every one can be skipped, because a setup
// that has to be finished in one sitting is a setup half of people abandon at
// the school run. Where somebody got to is remembered on the workspace, so
// the link in "finish setting up" comes back to exactly here.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { FlowMark } from "@/components/FlowMark";
import { PDF_STYLE_LIST } from "@/lib/pdf/styles";
import { listCountries } from "@/lib/core/countries";
import { onboardingState, setStep, STEPS, type StepKey } from "@/lib/onboarding/progress";
import { skipToWorkspaceAction } from "../../actions";
import { DetailsStep } from "./DetailsStep";
import { StockStep } from "./StockStep";
import { CustomersStep } from "./CustomersStep";
import { LookStep } from "./LookStep";

export const dynamic = "force-dynamic";

const STEP_KEYS = STEPS.map((s) => s.key);

export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ tenantId: string; step: string }>;
}) {
  const { tenantId, step } = await params;
  if (!STEP_KEYS.includes(step as StepKey) || step === "business") notFound();
  const current = step as Exclude<StepKey, "business">;

  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [tenant, state] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        registrationNumber: true,
        vatNumber: true,
        entityType: true,
        businessAddress: true,
        businessEmail: true,
        businessPhone: true,
        bankName: true,
        bankAccountHolder: true,
        bankAccountNumber: true,
        bankBranchCode: true,
        countryCode: true,
      },
    }),
    onboardingState(tenantId),
  ]);
  if (!tenant) notFound();
  if (state.step !== current) await setStep(tenantId, current);

  const meta = STEPS.find((s) => s.key === current)!;
  const at = STEP_KEYS.indexOf(current);

  return (
    <div className="kb-shell min-h-screen" data-theme="light" data-skin="admina">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FlowMark size={28} />
            <span className="text-lg font-bold text-[var(--kb-text)]">{tenant.name}</span>
          </div>
          <form action={skipToWorkspaceAction.bind(null, tenantId)}>
            <button type="submit" className="text-xs text-[var(--kb-text-dim)] underline">
              Finish setting up later
            </button>
          </form>
        </header>

        <ol className="mt-6 flex flex-wrap gap-1.5" aria-label="Setting up">
          {STEPS.map((s, i) => {
            const done = state.done[s.key] && s.key !== current;
            const here = s.key === current;
            return (
              <li key={s.key}>
                {i <= at || done ? (
                  <Link
                    href={s.key === "business" ? "/onboarding" : `/onboarding/${tenantId}/${s.key}`}
                    className="kb-pill text-[11px]"
                    style={{
                      background: here ? "var(--kb-accent-a)" : done ? "var(--kb-tint-mint)" : "var(--kb-panel)",
                      color: here ? "#fff" : "var(--kb-text-dim)",
                    }}
                    aria-current={here ? "step" : undefined}
                  >
                    {done ? "✓ " : ""}
                    {s.label}
                  </Link>
                ) : (
                  <span className="kb-pill text-[11px] opacity-60" style={{ background: "var(--kb-panel)", color: "var(--kb-text-dim)" }}>
                    {s.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <h1 className="mt-5 text-2xl font-semibold text-[var(--kb-text)]">{meta.label}</h1>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{meta.blurb}</p>

        <div className="mt-5">
          {current === "details" && (
            <DetailsStep
              tenantId={tenantId}
              countries={listCountries()}
              values={{
                name: tenant.name ?? "",
                countryCode: tenant.countryCode ?? "ZA",
                registrationNumber: tenant.registrationNumber ?? "",
                vatNumber: tenant.vatNumber ?? "",
                entityType: tenant.entityType ?? "",
                businessAddress: tenant.businessAddress ?? "",
                businessEmail: tenant.businessEmail ?? "",
                businessPhone: tenant.businessPhone ?? "",
                bankName: tenant.bankName ?? "",
                bankAccountHolder: tenant.bankAccountHolder ?? "",
                bankAccountNumber: tenant.bankAccountNumber ?? "",
                bankBranchCode: tenant.bankBranchCode ?? "",
              }}
            />
          )}
          {current === "stock" && <StockStep tenantId={tenantId} already={state.counts.products} />}
          {current === "customers" && <CustomersStep tenantId={tenantId} already={state.counts.customers} />}
          {current === "look" && (await renderLook(tenantId, tenant.name))}
        </div>
      </div>
    </div>
  );
}

async function renderLook(tenantId: string, businessName: string) {
  const template = await prisma.tenantPdfTemplate.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { logoDataUrl: true, styleKey: true },
  });
  return (
    <LookStep
      tenantId={tenantId}
      businessName={businessName}
      currentLogo={template?.logoDataUrl ?? null}
      currentStyle={template?.styleKey ?? null}
      styles={PDF_STYLE_LIST.filter((s) => !s.isSlip).map((s) => ({ key: s.key, label: s.label, family: s.family }))}
    />
  );
}
