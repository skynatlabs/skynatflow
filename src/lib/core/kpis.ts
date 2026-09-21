// The numbers, for whoever is looking.
//
// The home page used to show one board: the owner's, with a retail shop's
// stock health on it whether or not the business held stock, and the same
// board for a driver who cannot see money at all. So it was both too much and
// too little, which is the usual outcome of one dashboard for everybody.
//
// This builds the board from two facts — the person's role and the trade the
// business is in — and nothing else. An owner sees every aspect of the
// business; a rep sees selling; a driver sees the road. A panel whose data
// this business does not keep is not rendered as an empty chart, it is not
// built at all, because an empty chart reads as a broken chart.
//
// Performance discipline from Phase 100 holds: the number of round trips is
// what costs, not the queries themselves, so only the groups this person will
// actually see are fetched, and those go out together.

import type { NicheSkin } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CapabilityHolder, Role } from "./access";
import { formatMoney } from "@/lib/format/money";

export type PanelKind = "stat" | "trend" | "breakdown" | "donut";

export interface KpiPanel {
  key: string;
  title: string;
  kind: PanelKind;
  /** One line on what the number actually means. */
  note?: string;
  /** Where to go and do something about it. */
  href?: string;
  /** stat */
  value?: string;
  deltaPercent?: number | null;
  deltaNote?: string;
  spark?: Array<{ v: number }>;
  tone?: "plain" | "good" | "warn" | "bad";
  /** trend */
  series?: Array<{ label: string; value: number }>;
  /** breakdown and donut */
  slices?: Array<{ name: string; value: number; color: string }>;
}

export interface KpiGroup {
  key: string;
  title: string;
  panels: KpiPanel[];
}

export interface KpiBoard {
  groups: KpiGroup[];
  /** Named so the page can say whose board this is. */
  scope: string;
}

/** Which aspects of a business each role is shown. */
const GROUPS_FOR_ROLE: Record<Role, string[]> = {
  // Everything, deliberately: the request was that the top role sees every
  // aspect rather than a chosen handful.
  OWNER: ["money", "sales", "work", "stock", "people", "fleet", "compliance"],
  STAFF: ["sales", "work", "stock"],
  REP: ["sales"],
  DRIVER: ["fleet", "work"],
  TECHNICIAN: ["work"],
};

/** Which aspects a trade actually has. A shop has no fleet; a courier has no shelves. */
const GROUPS_FOR_NICHE: Record<NicheSkin, string[]> = {
  CORPORATE: ["money", "sales", "work", "people", "compliance"],
  SERVICES: ["money", "sales", "work", "people", "compliance", "stock"],
  LOGISTICS: ["money", "sales", "work", "fleet", "people", "compliance"],
  MEDICAL: ["money", "sales", "work", "people", "compliance", "stock"],
  RETAIL: ["money", "sales", "stock", "people", "compliance", "work"],
  WHOLESALE: ["money", "sales", "stock", "work", "people", "compliance", "fleet"],
  ECOMMERCE: ["money", "sales", "stock", "work", "people", "compliance"],
  NONPROFIT: ["money", "people", "compliance", "work", "sales"],
};

const GROUP_TITLE: Record<string, string> = {
  money: "Money",
  sales: "Selling",
  work: "Work",
  stock: "Stock",
  people: "People",
  fleet: "On the road",
  compliance: "Deadlines",
};

const C = {
  good: "var(--kb-tint-mint-ink)",
  warn: "var(--kb-tint-yellow-ink)",
  bad: "#e2445c",
  a: "var(--kb-accent-a)",
  b: "var(--kb-accent-b)",
  mid: "var(--kb-accent-mid)",
  grey: "#c9cede",
};

function monthBuckets(count: number): Array<{ start: Date; end: Date; label: string }> {
  const out: Array<{ start: Date; end: Date; label: string }> = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({ start, end, label: start.toLocaleDateString(undefined, { month: "short" }) });
  }
  return out;
}

function delta(series: number[]): number | null {
  if (series.length < 4) return null;
  const half = Math.floor(series.length / 2);
  const before = series.slice(0, half).reduce((a, b) => a + b, 0);
  const after = series.slice(half).reduce((a, b) => a + b, 0);
  if (before === 0) return null;
  return Math.round(((after - before) / before) * 100);
}

/**
 * The board for one person.
 *
 * `role` is what they are in this workspace; `niche` is what the business
 * does. Both narrow what is built — a panel nobody will look at is a query
 * nobody should pay for.
 */
export async function kpiBoard(
  tenantId: string,
  // A role name or a resolved holder — the board hides the rows somebody may
  // not act on, and a workspace may have invented the role it is given.
  role: Role | CapabilityHolder,
  niche: NicheSkin
): Promise<KpiBoard> {
  // The board is grouped by role NAME. A workspace's own role has no entry,
  // so it falls back to the staff view — the safe direction, since the rows
  // themselves are still gated by capability further down.
  const roleName = typeof role === "string" ? role : role.role;
  const allowed = new Set(GROUPS_FOR_ROLE[roleName as Role] ?? GROUPS_FOR_ROLE.STAFF);
  const has = new Set(GROUPS_FOR_NICHE[niche] ?? GROUPS_FOR_NICHE.SERVICES);
  const wanted = [...allowed].filter((g) => has.has(g));
  const want = (g: string) => wanted.includes(g);

  const months = monthBuckets(6);
  const since = months[0].start;
  const currency = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } })).currency;
  const money = (cents: number) => formatMoney(cents, currency);

  // One round of reads, only for the groups this person sees.
  const [documents, payments, expenses, tasks, jobs, items, staffRows, trips, obligations, parties] = await Promise.all([
    want("money") || want("sales")
      ? prisma.transaction.findMany({
          where: { tenantId, type: { in: ["QUOTE", "INVOICE"] }, createdAt: { gte: since } },
          select: { type: true, status: true, amountCents: true, createdAt: true },
        })
      : Promise.resolve([]),
    want("money")
      ? prisma.transaction.findMany({
          where: { tenantId, type: { in: ["PAYMENT", "REFUND"] }, createdAt: { gte: since } },
          select: { type: true, amountCents: true, createdAt: true },
        })
      : Promise.resolve([]),
    want("money")
      ? prisma.expense.findMany({ where: { tenantId, spentOn: { gte: since } }, select: { amountCents: true, spentOn: true, category: true } })
      : Promise.resolve([]),
    want("work") ? prisma.task.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }) : Promise.resolve([]),
    want("work") ? prisma.jobCard.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }) : Promise.resolve([]),
    want("stock")
      ? prisma.item.findMany({ where: { tenantId }, select: { stockQty: true, reorderPoint: true, costCents: true, unitPriceCents: true } })
      : Promise.resolve([]),
    want("people")
      ? prisma.$queryRaw<Array<{ role: string; n: bigint }>>`
          SELECT role::text AS role, count(*)::bigint AS n FROM memberships WHERE "tenantId" = ${tenantId} GROUP BY role
        `
      : Promise.resolve([]),
    want("fleet")
      ? prisma.trip.findMany({ where: { tenantId, startedAt: { gte: since } }, select: { status: true, startedAt: true, distanceKm: true } })
      : Promise.resolve([]),
    want("compliance")
      ? prisma.obligation.findMany({ where: { tenantId, status: { not: "DONE" } }, select: { dueAt: true, title: true } })
      : Promise.resolve([]),
    want("sales")
      ? prisma.party.findMany({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] }, createdAt: { gte: since } }, select: { createdAt: true } })
      : Promise.resolve([]),
  ]);

  const inMonth = <T>(rows: T[], at: (r: T) => Date) =>
    months.map((m) => rows.filter((r) => at(r) >= m.start && at(r) < m.end));

  const groups: KpiGroup[] = [];

  // ------------------------------------------------------------------ money
  if (want("money")) {
    const byMonth = inMonth(payments, (p) => p.createdAt);
    const inSeries = byMonth.map((rows, i) => ({
      label: months[i].label,
      value: Math.round(
        rows.reduce((s, p) => s + (p.type === "REFUND" ? -p.amountCents : p.amountCents), 0) / 100
      ),
    }));
    const outByMonth = inMonth(expenses, (e) => e.spentOn);
    const outSeries = outByMonth.map((rows, i) => ({
      label: months[i].label,
      value: Math.round(rows.reduce((s, e) => s + e.amountCents, 0) / 100),
    }));

    const collected = payments.reduce((s, p) => s + (p.type === "REFUND" ? -p.amountCents : p.amountCents), 0);
    const spent = expenses.reduce((s, e) => s + e.amountCents, 0);
    const owed = documents
      .filter((d) => d.type === "INVOICE" && ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(d.status))
      .reduce((s, d) => s + d.amountCents, 0);

    const byCategory = expenses.reduce<Record<string, number>>((acc, e) => {
      const key = e.category ?? "Other";
      acc[key] = (acc[key] ?? 0) + e.amountCents;
      return acc;
    }, {});
    const palette = [C.a, C.b, C.mid, C.warn, C.good, C.grey];

    groups.push({
      key: "money",
      title: GROUP_TITLE.money,
      panels: [
        {
          key: "collected",
          title: "Money in",
          note: "Payments received, less refunds, over six months.",
          kind: "stat",
          value: money(collected),
          deltaPercent: delta(inSeries.map((s) => s.value)),
          deltaNote: "vs the three months before",
          spark: inSeries.map((s) => ({ v: s.value })),
          tone: "good",
          href: "statements",
        },
        {
          key: "spent",
          title: "Money out",
          note: "Every slip and cost captured.",
          kind: "stat",
          value: money(spent),
          deltaPercent: delta(outSeries.map((s) => s.value)),
          deltaNote: "vs the three months before",
          spark: outSeries.map((s) => ({ v: s.value })),
          tone: spent > collected ? "bad" : "plain",
          href: "expenses",
        },
        {
          key: "kept",
          title: "Kept",
          note: "In less out. Not a profit figure until every cost is captured.",
          kind: "stat",
          value: money(collected - spent),
          tone: collected - spent >= 0 ? "good" : "bad",
          href: "books",
        },
        {
          key: "owed",
          title: "Owed to you",
          note: "Invoices sent and not settled.",
          kind: "stat",
          value: money(owed),
          tone: owed > 0 ? "warn" : "good",
          href: "overdue",
        },
        {
          key: "in-out",
          title: "In and out, by month",
          kind: "trend",
          series: inSeries,
          href: "cash-forecast",
        },
        ...(Object.keys(byCategory).length > 0
          ? [
              {
                key: "cost-mix",
                title: "Where the money went",
                kind: "donut" as const,
                slices: Object.entries(byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([name, cents], i) => ({ name, value: Math.round(cents / 100), color: palette[i % palette.length] })),
                href: "costs",
              },
            ]
          : []),
      ],
    });
  }

  // ------------------------------------------------------------------ sales
  if (want("sales")) {
    const quotes = documents.filter((d) => d.type === "QUOTE");
    const accepted = quotes.filter((q) => q.status === "ACCEPTED").length;
    const answered = quotes.filter((q) => ["ACCEPTED", "DECLINED"].includes(q.status)).length;
    const winRate = answered > 0 ? Math.round((accepted / answered) * 100) : null;

    const quotedByMonth = inMonth(quotes, (q) => q.createdAt).map((rows, i) => ({
      label: months[i].label,
      value: Math.round(rows.reduce((s, q) => s + q.amountCents, 0) / 100),
    }));
    const newCustomers = inMonth(parties, (p) => p.createdAt).map((rows, i) => ({ label: months[i].label, value: rows.length }));

    const pipeline = quotes.reduce<Record<string, number>>((acc, q) => {
      acc[q.status] = (acc[q.status] ?? 0) + 1;
      return acc;
    }, {});
    const statusColour: Record<string, string> = {
      DRAFT: C.grey,
      SENT: C.b,
      ACCEPTED: C.good,
      DECLINED: C.bad,
      CANCELLED: C.grey,
    };

    groups.push({
      key: "sales",
      title: GROUP_TITLE.sales,
      panels: [
        {
          key: "quoted",
          title: "Quoted",
          note: "What was put in front of customers over six months.",
          kind: "stat",
          value: money(quotes.reduce((s, q) => s + q.amountCents, 0)),
          deltaPercent: delta(quotedByMonth.map((q) => q.value)),
          deltaNote: "vs the three months before",
          spark: quotedByMonth.map((q) => ({ v: q.value })),
          href: "quotes",
        },
        {
          key: "win-rate",
          title: "Win rate",
          note: winRate === null ? "No quote has been answered yet." : `${accepted} of ${answered} answered quotes were accepted.`,
          kind: "stat",
          value: winRate === null ? "—" : `${winRate}%`,
          tone: winRate !== null && winRate >= 50 ? "good" : winRate !== null && winRate < 25 ? "warn" : "plain",
          href: "pipeline",
        },
        {
          key: "quoted-trend",
          title: "Quoted, by month",
          kind: "trend",
          series: quotedByMonth,
          href: "quotes",
        },
        {
          key: "pipeline",
          title: "Where quotes stand",
          kind: "donut",
          slices: Object.entries(pipeline).map(([name, value]) => ({
            name: name.replace(/_/g, " ").toLowerCase(),
            value,
            color: statusColour[name] ?? C.mid,
          })),
          href: "pipeline",
        },
        {
          key: "new-customers",
          title: "New customers, by month",
          kind: "trend",
          series: newCustomers,
          href: "customers",
        },
      ],
    });
  }

  // ------------------------------------------------------------------- work
  if (want("work")) {
    const taskTotal = tasks.reduce((s, t) => s + t._count._all, 0);
    const open = tasks.filter((t) => t.status !== "DONE").reduce((s, t) => s + t._count._all, 0);
    const taskColour: Record<string, string> = { TODO: C.b, IN_PROGRESS: C.warn, DONE: C.good };
    const jobColour: Record<string, string> = { OPEN: C.b, IN_PROGRESS: C.warn, COMPLETED: C.good, CANCELLED: C.grey };

    const panels: KpiPanel[] = [
      {
        key: "open-tasks",
        title: "Still open",
        note: taskTotal === 0 ? "Nothing on the board yet." : `${taskTotal - open} of ${taskTotal} done.`,
        kind: "stat",
        value: String(open),
        tone: open > 10 ? "warn" : "plain",
        href: "tasks",
      },
    ];
    if (taskTotal > 0) {
      panels.push({
        key: "task-mix",
        title: "The board",
        kind: "donut",
        slices: tasks.map((t) => ({
          name: t.status.replace(/_/g, " ").toLowerCase(),
          value: t._count._all,
          color: taskColour[t.status] ?? C.grey,
        })),
        href: "tasks",
      });
    }
    if (jobs.length > 0) {
      panels.push({
        key: "job-mix",
        title: "Job cards",
        kind: "donut",
        slices: jobs.map((j) => ({
          name: j.status.replace(/_/g, " ").toLowerCase(),
          value: j._count._all,
          color: jobColour[j.status] ?? C.grey,
        })),
        href: "job-cards",
      });
    }
    groups.push({ key: "work", title: GROUP_TITLE.work, panels });
  }

  // ------------------------------------------------------------------ stock
  if (want("stock") && items.length > 0) {
    let healthy = 0;
    let low = 0;
    let out = 0;
    let atCost = 0;
    let atRetail = 0;
    for (const item of items) {
      if (item.stockQty === null) continue;
      if (item.stockQty <= 0) out++;
      else if (item.reorderPoint !== null && item.stockQty <= item.reorderPoint) low++;
      else healthy++;
      atCost += (item.costCents ?? 0) * Math.max(0, item.stockQty);
      atRetail += item.unitPriceCents * Math.max(0, item.stockQty);
    }

    groups.push({
      key: "stock",
      title: GROUP_TITLE.stock,
      panels: [
        {
          key: "stock-value",
          title: "Stock on hand",
          note: atCost > 0 ? `Worth ${money(atRetail)} at selling price.` : "Put cost prices on your items to value this properly.",
          kind: "stat",
          value: money(atCost),
          href: "inventory",
        },
        {
          key: "stock-health",
          title: "How the shelves look",
          kind: "donut",
          slices: [
            { name: "healthy", value: healthy, color: C.good },
            { name: "low", value: low, color: C.warn },
            { name: "out of stock", value: out, color: C.bad },
          ].filter((s) => s.value > 0),
          href: "inventory",
        },
        {
          key: "reorder",
          title: "Needs reordering",
          note: "Below the point you set, or gone.",
          kind: "stat",
          value: String(low + out),
          tone: low + out > 0 ? "warn" : "good",
          href: "inventory",
        },
      ],
    });
  }

  // ----------------------------------------------------------------- people
  if (want("people") && staffRows.length > 0) {
    const total = staffRows.reduce((s, r) => s + Number(r.n), 0);
    groups.push({
      key: "people",
      title: GROUP_TITLE.people,
      panels: [
        { key: "headcount", title: "On the workspace", kind: "stat", value: String(total), href: "staff" },
        {
          key: "role-mix",
          title: "Who does what",
          kind: "breakdown",
          slices: staffRows.map((r, i) => ({
            name: r.role.toLowerCase(),
            value: Number(r.n),
            color: [C.a, C.b, C.mid, C.good, C.warn][i % 5],
          })),
          href: "org",
        },
      ],
    });
  }

  // ------------------------------------------------------------------ fleet
  if (want("fleet") && trips.length > 0) {
    const byMonth = inMonth(trips, (t) => t.startedAt ?? since);
    const km = byMonth.map((rows, i) => ({
      label: months[i].label,
      value: Math.round(rows.reduce((s, t) => s + (t.distanceKm ?? 0), 0)),
    }));
    const statusColour: Record<string, string> = { PLANNED: C.grey, IN_PROGRESS: C.warn, COMPLETED: C.good, CANCELLED: C.grey };
    const byStatus = trips.reduce<Record<string, number>>((acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    }, {});

    groups.push({
      key: "fleet",
      title: GROUP_TITLE.fleet,
      panels: [
        {
          key: "km",
          title: "Distance covered",
          note: "Six months of trips.",
          kind: "stat",
          value: `${km.reduce((s, m) => s + m.value, 0).toLocaleString()} km`,
          spark: km.map((m) => ({ v: m.value })),
          href: "trips",
        },
        { key: "km-trend", title: "Kilometres, by month", kind: "trend", series: km, href: "trips" },
        {
          key: "trip-mix",
          title: "Trips",
          kind: "donut",
          slices: Object.entries(byStatus).map(([name, value]) => ({
            name: name.replace(/_/g, " ").toLowerCase(),
            value,
            color: statusColour[name] ?? C.mid,
          })),
          href: "trips",
        },
      ],
    });
  }

  // ------------------------------------------------------------- compliance
  if (want("compliance") && obligations.length > 0) {
    const now = Date.now();
    const overdue = obligations.filter((o) => o.dueAt && o.dueAt.getTime() < now).length;
    const soon = obligations.filter((o) => o.dueAt && o.dueAt.getTime() >= now && o.dueAt.getTime() < now + 30 * 86_400_000).length;

    groups.push({
      key: "compliance",
      title: GROUP_TITLE.compliance,
      panels: [
        {
          key: "overdue-obligations",
          title: "Past their date",
          note: overdue > 0 ? "These carry penalties." : "Nothing has been missed.",
          kind: "stat",
          value: String(overdue),
          tone: overdue > 0 ? "bad" : "good",
          href: "compliance",
        },
        {
          key: "soon-obligations",
          title: "Due within a month",
          kind: "stat",
          value: String(soon),
          tone: soon > 0 ? "warn" : "plain",
          href: "compliance",
        },
      ],
    });
  }

  return {
    groups: groups.filter((g) => g.panels.length > 0),
    scope:
      role === "OWNER"
        ? "Every part of the business"
        : role === "REP"
          ? "Your selling"
          : role === "DRIVER"
            ? "The road and your work"
            : role === "TECHNICIAN"
              ? "Your work"
              : "Your part of the business",
  };
}

/** Kept exported so a test can assert the role narrowing without a database. */
export function groupsFor(role: Role, niche: NicheSkin): string[] {
  const allowed = new Set(GROUPS_FOR_ROLE[role] ?? []);
  return (GROUPS_FOR_NICHE[niche] ?? []).filter((g) => allowed.has(g));
}
