import Link from "next/link";
import { listPagesForAdmin } from "@/lib/core/cms";
import { prisma } from "@/lib/db";
import { TenantGrowthChart, PlatformRevenueChart, TopTenantsChart } from "./AdminHomeCharts";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR", maximumFractionDigits: 0 });
}

async function loadPlatformStats() {
  const sixMonthsAgo = new Date(Date.now() - 182 * 86_400_000);
  const twelveWeeksAgo = new Date(Date.now() - 84 * 86_400_000);

  const [tenantCount, allTenants, revenueTx, tenantsByName] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.findMany({ where: { createdAt: { gte: sixMonthsAgo } }, select: { createdAt: true } }),
    prisma.transaction.findMany({
      where: { type: "INVOICE", status: { in: ["PAID", "PARTIALLY_PAID"] }, createdAt: { gte: twelveWeeksAgo } },
      select: { createdAt: true, amountCents: true, tenantId: true },
    }),
    prisma.tenant.findMany({ select: { id: true, name: true } }),
  ]);

  const months: { start: Date; end: Date; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    months.push({ start, end, label: start.toLocaleDateString(undefined, { month: "short" }) });
  }
  const growthData = months.map(({ start, end, label }) => ({
    label,
    count: allTenants.filter((t) => t.createdAt >= start && t.createdAt < end).length,
  }));

  const weeks: { start: Date; end: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const end = new Date(Date.now() - i * 7 * 86_400_000);
    const start = new Date(end.getTime() - 7 * 86_400_000);
    weeks.push({ start, end });
  }
  const revenueData = weeks.map(({ start, end }) => ({
    label: end.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    revenue: revenueTx.filter((t) => t.createdAt >= start && t.createdAt < end).reduce((s, t) => s + t.amountCents, 0) / 100,
  }));

  const nameById = new Map(tenantsByName.map((t) => [t.id, t.name]));
  const byTenant = new Map<string, number>();
  for (const t of revenueTx) byTenant.set(t.tenantId, (byTenant.get(t.tenantId) ?? 0) + t.amountCents);
  const topTenants = [...byTenant.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, cents]) => ({ name: nameById.get(id) ?? "Unknown", value: cents / 100 }));

  const totalRevenueCents = revenueTx.reduce((s, t) => s + t.amountCents, 0);

  return { tenantCount, growthData, revenueData, topTenants, totalRevenueCents };
}

export default async function AdminPagesIndex() {
  const [pages, stats] = await Promise.all([listPagesForAdmin(), loadPlatformStats()]);
  const core = pages.filter((p) => p.group === "core");
  const industries = pages.filter((p) => p.group === "industry");

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Platform overview</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        A bird&apos;s-eye view across every tenant.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="kb-tile kb-tint-blue">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Tenants</p>
          <p className="mt-2 text-3xl font-extrabold">{stats.tenantCount}</p>
          <p className="mt-1 text-xs opacity-70">on the platform</p>
        </div>
        <div className="kb-tile kb-tint-mint">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Revenue, 12wk</p>
          <p className="mt-2 truncate text-xl font-extrabold sm:text-2xl">{money(stats.totalRevenueCents)}</p>
          <p className="mt-1 text-xs opacity-70">paid invoices, all tenants</p>
        </div>
        <div className="kb-tile kb-tint-violet">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Top tenant, 12wk</p>
          <p className="mt-2 truncate text-xl font-extrabold sm:text-2xl">
            {stats.topTenants[0] ? money(stats.topTenants[0].value * 100) : "—"}
          </p>
          <p className="mt-1 truncate text-xs opacity-70">{stats.topTenants[0]?.name ?? "No revenue yet"}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TenantGrowthChart data={stats.growthData} />
        <PlatformRevenueChart data={stats.revenueData} />
      </div>
      <div className="mt-5">
        <TopTenantsChart data={stats.topTenants} />
      </div>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
        Marketing pages — core
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {core.map((p) => (
          <PageRow key={p.slug} {...p} />
        ))}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
        Industry pages
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {industries.map((p) => (
          <PageRow key={p.slug} {...p} />
        ))}
      </div>
    </div>
  );
}

function PageRow({
  slug,
  title,
  path,
  updatedAt,
}: {
  slug: string;
  title: string;
  path: string;
  updatedAt: Date | null;
}) {
  return (
    <Link href={`/car/pages/${slug}`} className="kb-card flex items-center justify-between p-4">
      <div>
        <p className="font-semibold text-[var(--kb-text)]">{title}</p>
        <p className="text-xs text-[var(--kb-text-dim)]">{path}</p>
      </div>
      <p className="text-xs text-[var(--kb-text-dim)]">
        {updatedAt ? `Edited ${updatedAt.toLocaleDateString()}` : "Not yet edited"}
      </p>
    </Link>
  );
}
