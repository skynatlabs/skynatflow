"use client";

// Small reusable chart widgets for page headers across the dashboard —
// one consistent visual language (Recharts + kb-card) instead of every
// list page inventing its own summary block.

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const AXIS_STYLE = { fontSize: 11, fill: "var(--kb-text-dim)" };

function CardTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="kb-card px-3 py-2 text-xs" style={{ boxShadow: "0 8px 24px -8px rgba(0,0,0,0.25)" }}>
      {label && <p className="font-semibold text-[var(--kb-text)]">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.dataKey ?? p.name} className="text-[var(--kb-text-dim)]">
          {p.name}: <span className="font-semibold text-[var(--kb-text)]">{formatter ? formatter(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** A row of small stat+sparkline cards for a page header. */
export function StatSparkRow({
  items,
}: {
  items: { label: string; value: string; trend: { v: number }[]; tint: "blue" | "yellow" | "peach" | "violet" | "mint" }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className={`kb-tile kb-tint-${it.tint}`}>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{it.label}</p>
          <p className="mt-2 truncate text-xl font-extrabold">{it.value}</p>
          <div className="mt-2 h-8">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={it.trend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <Area type="monotone" dataKey="v" stroke="currentColor" fill="currentColor" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal bar breakdown, e.g. counts by status/category. */
export function BreakdownBarChart({ title, data }: { title: string; data: { name: string; value: number; color: string }[] }) {
  return (
    <section className="kb-card p-5">
      <h2 className="text-sm font-semibold text-[var(--kb-text)]">{title}</h2>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={Math.max(90, data.length * 34)}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={AXIS_STYLE} axisLine={false} tickLine={false} width={100} />
            <Tooltip content={<CardTooltip />} cursor={{ fill: "var(--kb-panel-border)", opacity: 0.3 }} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** Small donut with a legend, e.g. distribution by type. */
export function BreakdownDonut({ title, data }: { title: string; data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <section className="kb-card p-5">
      <h2 className="text-sm font-semibold text-[var(--kb-text)]">{title}</h2>
      <div className="mt-3 flex items-center gap-4">
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={34} outerRadius={52} strokeWidth={0} paddingAngle={total > 1 ? 2 : 0}>
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
          {total === 0 && <li className="text-xs text-[var(--kb-text-dim)]">Nothing yet.</li>}
        </ul>
      </div>
    </section>
  );
}

/** Trend area chart over time, e.g. volume/amount per day/week. */
export function TrendAreaChart({ title, data, dataKey = "value" }: { title: string; data: { label: string; value: number }[]; dataKey?: string }) {
  return (
    <section className="kb-card p-5">
      <h2 className="text-sm font-semibold text-[var(--kb-text)]">{title}</h2>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--kb-accent-a)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--kb-accent-a)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--kb-panel-border)" />
            <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip content={<CardTooltip />} />
            <Area type="monotone" dataKey={dataKey} name={title} stroke="var(--kb-accent-a)" fill="url(#trendFill)" strokeWidth={2.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
