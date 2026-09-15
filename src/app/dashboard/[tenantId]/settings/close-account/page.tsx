// Closing the account.
//
// One page, the owner's only. It says exactly what goes, offers the copy of
// the records the law says a business has to be able to keep, and takes a
// week before anything is actually removed.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { closureState, GRACE_DAYS } from "@/lib/core/accountClosure";
import { PageHeader } from "../../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { cancelClosureAction, requestClosureAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CloseAccountPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  let access;
  try {
    access = await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
  // Closing the business is the owner's decision and nobody else's.
  if (access.role !== "OWNER") notFound();

  const [tenant, closure, counts] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    closureState(tenantId),
    Promise.all([
      prisma.transaction.count({ where: { tenantId } }),
      prisma.party.count({ where: { tenantId } }),
      prisma.expense.count({ where: { tenantId } }),
      prisma.membership.count({ where: { tenantId } }),
    ]),
  ]);
  if (!tenant) notFound();
  const [documents, people, expenses, members] = counts;

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Close this account" crumbs={[{ label: "Settings", href: `/dashboard/${tenantId}/settings` }, { label: "Close this account" }]} />

      {closure.requestedAt ? (
        <div className="kb-card p-5" style={{ background: "var(--kb-tint-peach)" }}>
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">This account closes on {closure.deletesOn!.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</h2>
          <p className="mt-1 max-w-prose text-sm text-[var(--kb-text)]">
            Everything belonging to {tenant.name} is removed on that date and cannot be brought back. Until then nothing has been
            deleted and you can change your mind.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={cancelClosureAction.bind(null, tenantId)}>
              <SubmitButton pendingText="Stopping…">Keep my account</SubmitButton>
            </form>
            <a href={`/dashboard/${tenantId}/settings/close-account/records`} className="kb-pill kb-pill-ghost text-xs">
              Download a copy of my records
            </a>
          </div>
        </div>
      ) : (
        <>
          <section className="kb-card p-5">
            <h2 className="text-sm font-semibold text-[var(--kb-text)]">Take your records first</h2>
            <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
              You have to keep your invoices for five years, whatever you use to run the business. This is one file with everything in
              it — {documents.toLocaleString("en-US")} quotes, invoices and payments, {people.toLocaleString("en-US")} customers and
              suppliers, {expenses.toLocaleString("en-US")} expenses, your books and your compliance calendar — as a spreadsheet for
              each and as data underneath.
            </p>
            <a href={`/dashboard/${tenantId}/settings/close-account/records`} className="kb-pill kb-pill-primary mt-3 inline-flex text-xs">
              Download a copy of my records
            </a>
          </section>

          <section className="kb-card mt-4 p-5">
            <h2 className="text-sm font-semibold text-[var(--kb-text)]">Then close the account</h2>
            <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
              This removes {tenant.name} entirely: every quote, invoice, payment and expense, the books, the compliance calendar, the
              documents, and the access of all {members.toLocaleString("en-US")} {members === 1 ? "person" : "people"} on it. It
              happens {GRACE_DAYS} days from now, and you can stop it at any point before then. After that it cannot be undone.
            </p>
            <form action={requestClosureAction.bind(null, tenantId)} className="mt-4 flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Type the business name to confirm</span>
                <input name="confirmation" required placeholder={tenant.name} className="kb-input mt-1 w-64 text-sm" autoComplete="off" />
              </label>
              <SubmitButton pendingText="Closing…">Close this account</SubmitButton>
            </form>
          </section>
        </>
      )}

      <p className="mt-4 text-xs text-[var(--kb-text-dim)]">
        Changed your mind about something smaller?{" "}
        <Link href={`/dashboard/${tenantId}/settings`} className="underline">
          Back to settings
        </Link>
        .
      </p>
    </div>
  );
}
