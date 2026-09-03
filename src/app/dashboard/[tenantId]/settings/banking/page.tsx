import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { updateBankingDetailsAction } from "./actions";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

const inputClass =
  "mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2.5 text-sm text-[var(--kb-text)]";

export default async function BankingSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { tenantId } = await params;
  const { saved } = await searchParams;
  const access = await requireTenantAccess(tenantId);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const isOwner = access.role === "OWNER";

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Banking &amp; verification</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        These details print on every invoice for EFT payment, and the WhatsApp number lets a
        customer verify a document really came from you. Owner-only, on purpose — staff accounts
        can never see or change where money gets paid to, which closes off the most common
        invoice-fraud path (someone with staff access swapping the bank details).
      </p>

      {saved === "1" && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Banking details saved.
        </p>
      )}

      {!isOwner && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          You're signed in as {access.role.toLowerCase()} — only the owner account can view or
          change these fields.
        </p>
      )}

      {isOwner && (
        <form action={updateBankingDetailsAction} className="kb-card mt-6 space-y-4 p-6">
          <input type="hidden" name="tenantId" value={tenantId} />
          <div>
            <label className="text-sm font-medium text-[var(--kb-text)]">Bank name</label>
            <input name="bankName" defaultValue={tenant.bankName ?? ""} className={inputClass} />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--kb-text)]">Account holder</label>
            <input
              name="bankAccountHolder"
              defaultValue={tenant.bankAccountHolder ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--kb-text)]">Account number</label>
            <input
              name="bankAccountNumber"
              defaultValue={tenant.bankAccountNumber ?? ""}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-[var(--kb-text)]">Branch code</label>
              <input
                name="bankBranchCode"
                defaultValue={tenant.bankBranchCode ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--kb-text)]">SWIFT (if international)</label>
              <input name="bankSwift" defaultValue={tenant.bankSwift ?? ""} className={inputClass} />
            </div>
          </div>
          <div className="border-t border-[var(--kb-panel-border)] pt-4">
            <label className="text-sm font-medium text-[var(--kb-text)]">
              Official WhatsApp number for document verification
            </label>
            <input
              name="whatsappVerifyNumber"
              placeholder="+27821234567"
              defaultValue={tenant.whatsappVerifyNumber ?? ""}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
              Printed on every PDF and shown on the online view page as "Verify this document via
              WhatsApp" — a customer messages this number directly to confirm a quote/invoice is
              real before paying or accepting.
            </p>
          </div>
          <SubmitButton className="kb-pill kb-pill-primary w-full justify-center py-3" pendingText="Saving…">
            Save
          </SubmitButton>
        </form>
      )}
    </main>
  );
}
