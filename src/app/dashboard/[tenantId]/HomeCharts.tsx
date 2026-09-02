"use client";

// Client-side chart wrapper for the home dashboard — Recharts needs the
// browser, so all chart rendering lives here while the page.tsx server
// component does the data fetching/aggregation.

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

const AXIS_STYLE = { fontSize: 11, fill: "var(--kb-text-dim)" };

function ChartCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="kb-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CardTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="kb-card px-3 py-2 text-xs" style={{ boxShadow: "0 8px 24px -8px rgba(0,0,0,0.25)" }}>
      <p className="font-semibold text-[var(--kb-text)]">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-[var(--kb-text-dim)]">
          {p.name}: <span className="font-semibold text-[var(--kb-text)]">{formatter ? formatter(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function RevenueTrendChart({ data }: { data: { label: string; revenue: number; quoted: number }[] }) {
  return (
    <ChartCard title="Revenue vs quoted, last 12 weeks">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--kb-accent-a)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--kb-accent-a)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="quoFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--kb-accent-b)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--kb-accent-b)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--kb-panel-border)" />
          <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
          <Tooltip content={<CardTooltip formatter={(v: number) => `R${v.toLocaleString()}`} />} />
          <Area type="monotone" dataKey="quoted" name="Quoted" stroke="var(--kb-accent-b)" fill="url(#quoFill)" strokeWidth={2} />
          <Area type="monotone" dataKey="revenue" name="Collected" stroke="var(--kb-accent-a)" fill="url(#revFill)" strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function QuotePipelineChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartCard title="Quote pipeline">
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={total > 1 ? 2 : 0} strokeWidth={0}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <ul className="flex-1 space-y-1.5">
          {data.map((d) => (
            <li key={d.name} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-[var(--kb-text-dim)]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                {d.name}
              </span>
              <span className="font-semibold text-[var(--kb-text)]">{d.value}</span>
            </li>
          ))}
          {total === 0 && <li className="text-xs text-[var(--kb-text-dim)]">No quotes yet.</li>}
        </ul>
      </div>
    </ChartCard>
  );
}

export function TaskStatusChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ChartCard title="Tasks by status">
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tick={AXIS_STYLE} axisLine={false} tickLine={false} width={90} />
          <Tooltip content={<CardTooltip />} cursor={{ fill: "var(--kb-panel-border)", opacity: 0.3 }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function InventoryHealthChart({ healthy, low, outOfStock }: { healthy: number; low: number; outOfStock: number }) {
  const data = [
    { name: "Healthy", value: healthy, color: "var(--kb-tint-mint-ink)" },
    { name: "Low stock", value: low, color: "var(--kb-tint-yellow-ink)" },
    { name: "Out of stock", value: outOfStock, color: "#e2445c" },
  ];
  const total = healthy + low + outOfStock;
  return (
    <ChartCard title="Inventory health">
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={34} outerRadius={52} strokeWidth={0}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <ul className="flex-1 space-y-1.5">
          {data.map((d) => (
            <li key={d.name} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-[var(--kb-text-dim)]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                {d.name}
              </span>
              <span className="font-semibold text-[var(--kb-text)]">{d.value}</span>
            </li>
          ))}
          {total === 0 && <li className="text-xs text-[var(--kb-text-dim)]">No stock-tracked items yet.</li>}
        </ul>
      </div>
    </ChartCard>
  );
}

export function NotificationsChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ChartCard title="Notifications, last 30 days">
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--kb-panel-border)" />
          <XAxis dataKey="name" tick={AXIS_STYLE} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={40} />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip content={<CardTooltip />} cursor={{ fill: "var(--kb-panel-border)", opacity: 0.3 }} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={22}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CustomerGrowthChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ChartCard title="New customers, last 6 months">
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--kb-panel-border)" />
          <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip content={<CardTooltip />} cursor={{ fill: "var(--kb-panel-border)", opacity: 0.3 }} />
          <Bar dataKey="count" name="New customers" radius={[6, 6, 0, 0]} barSize={22} fill="var(--kb-accent-mid)" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
