// The form a stranger fills in.
//
// Public, so there is no session and nothing on this page may assume one. It
// takes the tenant from the address and shows only what the form declares —
// no workspace data, no customer list, nothing that is not the questions.
//
// The whole point is speed: the answer goes back the moment they submit, and
// the customer record exists before anybody has opened a laptop.

import { notFound } from "next/navigation";
import { publicForm } from "@/lib/core/leadForms";
import { EnquiryForm } from "./EnquiryForm";
import { submitEnquiryAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ tenantId: string; slug: string }> }) {
  const { tenantId, slug } = await params;
  const form = await publicForm(tenantId, slug);
  return form
    ? { title: `${form.title} — ${form.businessName}`, robots: { index: false, follow: false } }
    : { title: "Not found" };
}

export default async function EnquirePage({ params }: { params: Promise<{ tenantId: string; slug: string }> }) {
  const { tenantId, slug } = await params;
  const form = await publicForm(tenantId, slug);
  if (!form) notFound();

  return (
    <div className="kb-shell kb-warm min-h-screen" data-theme="light">
      <main className="mx-auto max-w-lg p-4 py-10 sm:p-8">
        <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">{form.businessName}</p>
        <h1 className="mt-1 text-2xl font-semibold text-balance text-[var(--kb-text)]">{form.title}</h1>
        {form.intro && <p className="mt-2 text-sm text-[var(--kb-text-dim)]">{form.intro}</p>}

        <EnquiryForm
          tenantId={tenantId}
          slug={slug}
          fields={form.fields}
          businessName={form.businessName}
          submitAction={submitEnquiryAction}
        />

        <p className="mt-6 text-center text-[11px] text-[var(--kb-text-dim)]">
          Your details go to {form.businessName} and nobody else.
        </p>
      </main>
    </div>
  );
}
