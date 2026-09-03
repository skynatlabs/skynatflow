// Staff/roles management (per your "user roles for staff under business"
// request). Built on the Membership model: one login, any role, on any
// number of businesses. Inviting/removing is OWNER-only (enforced in
// actions.ts); this page hides those controls from non-owners so they
// don't hit a permission error trying to use them.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { inviteStaffAction, removeStaffAction } from "./actions";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const ROLES = ["OWNER", "STAFF", "DRIVER", "REP", "TECHNICIAN"] as const;

export default async function StaffPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const canManage = can(access.role, "staff:manage");

  const memberships = await prisma.membership.findMany({
    where: { tenantId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Staff &amp; roles</h1>
        <div className="flex gap-2">
          <Link href={`/dashboard/${tenantId}/settings/audit-log`} className="kb-pill text-xs">
            Audit log
          </Link>
          <Link href={`/dashboard/${tenantId}/staff/permissions`} className="kb-pill text-xs">
            What can each role do?
          </Link>
        </div>
      </div>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        {canManage
          ? "Add anyone by email — if they already have a login on the platform (say, they own another workspace), this just adds them here with the role you pick."
          : "Only the workspace owner can add or remove team members."}
      </p>

      {canManage && (
        <form action={inviteStaffAction} className="kb-card mt-6 space-y-3 p-6">
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-[var(--kb-text)]">Name</label>
              <input name="name" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--kb-text)]">Email</label>
              <input name="email" type="email" required className={inputClass} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">Role</label>
            <select name="role" defaultValue="STAFF" className={inputClass}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton className="kb-pill kb-pill-primary" pendingText="Adding…">
            Add to team
          </SubmitButton>
        </form>
      )}

      <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {memberships.map((m) => (
          <li key={m.id} className="flex items-center justify-between p-4 text-sm">
            <div>
              <p className="font-medium text-[var(--kb-text)]">{m.user.name ?? m.user.email}</p>
              <p className="text-[var(--kb-text-dim)]">
                {m.user.email}
                {m.user.isSuperAdmin && " · platform admin"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: "var(--kb-tint-blue)", color: "var(--kb-tint-blue-ink)" }}
              >
                {m.role}
              </span>
              {canManage && m.role !== "OWNER" && (
                <form action={removeStaffAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="membershipId" value={m.id} />
                  <SubmitButton className="text-xs text-red-400 hover:underline" pendingText="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
