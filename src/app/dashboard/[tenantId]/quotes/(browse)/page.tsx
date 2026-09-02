import Link from "next/link";
import { prisma } from "@/lib/db";
import { BreakdownDonut, TrendAreaChart } from "@/components/dashboard/MiniCharts";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#94a3b8",
  SENT: "var(--kb-accent-b)",
  ACCEPTED: "var(--kb-tint-mint-ink)",
  PARTIALLY_PAID: "var(--kb-tint-yellow-ink)",
  PAID: "var(--kb-accent-a)",
  DECLINED: "var(--kb-tint-peach-ink)",
  CANCELLED: "#94a3b8",
};

export default async function QuotesIndexPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const twelveWeeksAgo = new Date(Date.now() - 84 * 86_400_000);

  const quotes = await prisma.transaction.findMany({
    where: { tenantId, type: "QUOTE", createdAt: { gte: twelveWeeksAgo } },
    select: { status: true, amountCents: true, createdAt: true },
  });

  const statusCounts = quotes.reduce<Record<string, number>>((acc, q) => {
    acc[q.status] = (acc[q.status] ?? 0) + 1;
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
    value: quotes.filter((q) => q.createdAt >= start && q.createdAt < end).reduce((s, q) => s + q.amountCents, 0) / 100,
  }));

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--kb-text)]">Quotes overview</h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">Select a quote from the list, or start a new one.</p>
        </div>
        <Link href={`/dashboard/${tenantId}/quotes/new`} className="kb-pill kb-pill-primary text-sm">
          + New quote
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TrendAreaChart title="Quoted amount, last 12 weeks" data={trendData} />
        <BreakdownDonut title="By status, last 12 weeks" data={donutData} />
      </div>
    </div>
  );
}
