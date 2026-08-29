// Step 2 of onboarding — shown right after workspace creation, while the
// owner still has momentum. Brand your documents (PDF style + accent
// color) and optionally import existing quotes/customers/products from
// wherever they're coming from (Zoho, QuickBooks, etc. — same CSV
// importer as settings, just surfaced here so it's part of the "get
// fully set up" flow instead of something to discover later). Both steps
// are skippable — a workspace works fine with the defaults.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { PDF_STYLE_LIST } from "@/lib/pdf/styles";
import { listPdfTemplates } from "@/lib/core/pdfTemplates";
import { createPdfTemplateAction } from "@/app/dashboard/[tenantId]/settings/pdf-templates/actions";
import { ImportClient } from "@/app/dashboard/[tenantId]/settings/import/ImportClient";
import { FlowMark } from "@/components/FlowMark";

export default async function FinishOnboardingPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) redirect("/onboarding");

  const templates = await listPdfTemplates(tenantId);
  const invoiceStyles = PDF_STYLE_LIST.filter((s) => !s.isSlip);

  return (
    <div className="kb-shell min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-2">
          <FlowMark size={30} />
          <span className="kb-gradient-text text-xl font-extrabold">Almost done</span>
        </div>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
          Two quick things, both optional — skip either and change them later from Settings.
        </p>

        <section className="kb-card mt-6 p-6">
          <h2 className="font-semibold text-[var(--kb-text)]">1. Brand your quotes &amp; invoices</h2>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Pick a layout and an accent color — every PDF you send uses this from now on.
          </p>

          {templates.length > 0 ? (
            <p className="mt-3 text-sm text-[var(--kb-text)]">
              ✓ Using <strong>{templates.find((t) => t.isDefault)?.name ?? templates[0].name}</strong>
            </p>
          ) : (
            <form action={createPdfTemplateAction} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="name" value="Default" />
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Layout</span>
                <select
                  name="styleKey"
                  required
                  defaultValue={invoiceStyles[0]?.key}
                  className="mt-1 w-56 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                >
                  {invoiceStyles.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} ({s.family})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Accent color</span>
                <input
                  name="accentColorHex"
                  type="color"
                  defaultValue="#6d5bff"
                  className="mt-1 h-9 w-16 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)]"
                />
              </label>
              <button type="submit" className="kb-pill kb-pill-primary text-xs">
                Save
              </button>
            </form>
          )}
        </section>

        <section className="kb-card mt-4 p-6">
          <h2 className="font-semibold text-[var(--kb-text)]">2. Bring in your existing customers &amp; quotes</h2>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Already quoting from Zoho, QuickBooks, or a spreadsheet? Import it now so nothing's lost
            in the switch.
          </p>
          <div className="mt-4">
            <ImportClient tenantId={tenantId} />
          </div>
        </section>

        <div className="mt-6 flex justify-end">
          <a href={`/dashboard/${tenantId}`} className="kb-pill kb-pill-primary px-6 py-3">
            Go to my dashboard &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
