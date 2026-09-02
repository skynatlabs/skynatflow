import { prisma } from "@/lib/db";
import { BreakdownDonut, TrendAreaChart } from "@/components/dashboard/MiniCharts";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#94a3b8",
  SENT: "var(--kb-accent-b)",
  PARTIALLY_PAID: "var(--kb-tint-yellow-ink)",
  PAID: "var(--kb-tint-mint-ink)",
  OVERDUE: "#e2445c",
  CANCELLED: "#94a3b8",
};

export default async function InvoicesIndexPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const twelveWeeksAgo = new Date(Date.now() - 84 * 86_400_000);

  const invoices = await prisma.transaction.findMany({
    where: { tenantId, type: "INVOICE", createdAt: { gte: twelveWeeksAgo } },
    select: { status: true, amountCents: true, createdAt: true },
  });

  const statusCounts = invoices.reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, {});
  const donutData = Object.entries(statusCounts).map(([status, count]) => ({
    name: status.replace(/_/g, " "),
    value: count,
    color: STATUS_COLORS[status] ?? "#94a3b8",
  }));

  const weeks: { start: Date; end: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const end = new Date(Date.now() - i * 7 * 86_400_000);
    const start = new Date(end.getTime() - 7 * 86_400_000);
    weeks.push({ start, end });
  }
  const trendData = weeks.map(({ start, end }) => ({
    label: end.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: invoices
      .filter((i) => i.createdAt >= start && i.createdAt < end && (i.status === "PAID" || i.status === "PARTIALLY_PAID"))
      .reduce((s, i) => s + i.amountCents, 0) / 100,
  }));

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-[var(--kb-text)]">Invoices overview</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Select an invoice from the list. New invoices come from converting an accepted quote or a cash sale.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TrendAreaChart title="Collected, last 12 weeks" data={trendData} />
        <BreakdownDonut title="By status, last 12 weeks" data={donutData} />
      </div>
    </div>
  );
}
