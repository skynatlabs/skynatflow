import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";

export default async function CarTenantsPage() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      memberships: {
        where: { role: "OWNER" },
        include: { user: { select: { email: true } } },
        take: 1,
      },
      _count: { select: { memberships: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Tenants</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every business on the platform — {tenants.length} total. This is visibility only, not
        access: opening a tenant&apos;s actual dashboard still requires a real membership on that
        tenant, same as anyone else. Billing/subscription status isn&apos;t tracked yet — there&apos;s
        no plan or payment-gateway model for platform billing built so far.
      </p>

      <div className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {tenants.map((t) => {
          const owner = t.memberships[0]?.user.email ?? "no owner membership";
          return (
            <div key={t.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-semibold text-[var(--kb-text)]">{t.name}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {nicheConfig(t.niche).label} · owner: {owner} · {t._count.memberships} member
                  {t._count.memberships === 1 ? "" : "s"}
                </p>
              </div>
              <p className="text-xs text-[var(--kb-text-dim)]">
                {new Date(t.createdAt).toLocaleDateString()}
              </p>
            </div>
          );
        })}
        {tenants.length === 0 && (
          <p className="p-4 text-sm text-[var(--kb-text-dim)]">No tenants yet.</p>
        )}
      </div>
    </div>
  );
}
