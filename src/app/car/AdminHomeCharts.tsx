"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

const AXIS_STYLE = { fontSize: 11, fill: "var(--kb-text-dim)" };

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="kb-card p-5">
      <h2 className="text-sm font-semibold text-[var(--kb-text)]">{title}</h2>
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

export function TenantGrowthChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ChartCard title="Tenant growth, last 6 months">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="tenantFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--kb-accent-a)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--kb-accent-a)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--kb-panel-border)" />
          <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip content={<CardTooltip />} />
          <Area type="monotone" dataKey="count" name="New tenants" stroke="var(--kb-accent-a)" fill="url(#tenantFill)" strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PlatformRevenueChart({ data }: { data: { label: string; revenue: number }[] }) {
  return (
    <ChartCard title="Platform revenue (paid invoices), last 12 weeks">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--kb-panel-border)" />
          <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
          <Tooltip content={<CardTooltip formatter={(v: number) => `R${v.toLocaleString()}`} />} cursor={{ fill: "var(--kb-panel-border)", opacity: 0.3 }} />
          <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]} fill="var(--kb-accent-mid)" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function TopTenantsChart({ data }: { data: { name: string; value: number }[] }) {
  const colors = ["var(--kb-accent-a)", "var(--kb-accent-mid)", "var(--kb-accent-b)", "#94a3b8", "#cbd5e1"];
  return (
    <ChartCard title="Top tenants by revenue">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tick={AXIS_STYLE} axisLine={false} tickLine={false} width={110} />
          <Tooltip content={<CardTooltip formatter={(v: number) => `R${v.toLocaleString()}`} />} cursor={{ fill: "var(--kb-panel-border)", opacity: 0.3 }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={colors[i % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
