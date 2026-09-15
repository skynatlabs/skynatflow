// Bring things in — the same intake as setting up, available for good.
//
// Setting up is not an event that happens once. A price list changes, a new
// certificate is issued, a contact list turns up in somebody's email. This is
// where any of it can be dropped in, read, and confirmed, on the same terms
// as the first day: nothing saved until it has been seen.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listIntakeDocuments, onboardingState, STEPS } from "@/lib/onboarding/progress";
import { PageHeader } from "../PageHeader";
import { SetupIntake } from "./SetupIntake";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  company_registration: "Registration certificate",
  vat_registration: "VAT registration",
  tax_certificate: "Tax certificate",
  bbbee_certificate: "B-BBEE certificate",
  bank_letter: "Bank letter",
  sales_document: "Invoice or quote you sent",
  supplier_document: "Supplier invoice",
  price_list: "Price list",
  stock_sheet: "Stock sheet",
  contact_list: "Contact list",
  letterhead: "Letterhead",
  website: "Website",
  spoken: "Something you told me",
  other: "Document",
};

export default async function SetupPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [state, documents, tenant] = await Promise.all([
    onboardingState(tenantId),
    listIntakeDocuments(tenantId),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);
  if (!tenant) notFound();

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Bring things in" crumbs={[{ label: "Bring things in" }]} />

      <p className="-mt-2 mb-5 max-w-prose text-sm text-[var(--kb-text-dim)]">
        A price list, a stock sheet, a certificate, a contact list, an invoice you sent — as a file, a spreadsheet or a photograph. I
        read it and show you what I found; nothing is saved until you say so.
      </p>

      {!state.finished && state.remaining.length > 0 && (
        <div className="kb-card mb-5 flex flex-wrap items-center justify-between gap-3 p-4" style={{ background: "var(--kb-tint-yellow)" }}>
          <p className="text-sm text-[var(--kb-text)]">
            Setting up is not finished — {state.remaining.map((r) => r.label.toLowerCase()).join(", ")} still to go.
          </p>
          <Link href={`/onboarding/${tenantId}/${state.step}`} className="kb-pill kb-pill-primary text-xs">
            Pick up where you left off
          </Link>
        </div>
      )}

      <SetupIntake tenantId={tenantId} />

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">What is already set up</h2>
        <div className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
          {STEPS.filter((s) => s.key !== "business").map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--kb-text)]">{s.label}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">{s.blurb}</p>
              </div>
              {state.done[s.key] ? (
                <span className="kb-pill text-[10px]" style={{ background: "var(--kb-tint-mint)", color: "var(--kb-tint-mint-ink)" }}>
                  done
                </span>
              ) : (
                <Link href={`/onboarding/${tenantId}/${s.key}`} className="kb-pill kb-pill-ghost text-[10px]">
                  finish this
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {documents.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">What I have read</h2>
          <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
            The documents themselves are not kept — only what was read off them, so every field can say where it came from.
          </p>
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--kb-text)]">{d.fileName}</p>
                  <p className="truncate text-xs text-[var(--kb-text-dim)]">
                    {KIND_LABELS[d.kind] ?? "Document"}
                    {d.summary ? ` · ${d.summary}` : ""}
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
                  {d.createdAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
