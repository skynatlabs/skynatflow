"use client";

// The board, drawn.
//
// One component for every panel the board can produce, so a new aspect of the
// business is a shape in core/kpis.ts and nothing here. Each panel is a card
// that lifts slightly off the ground and a link to where you would act on it
// — a number nobody can do anything about is decoration.

import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CardTooltip } from "@/components/dashboard/CardTooltip";
import type { KpiGroup, KpiPanel } from "@/lib/core/kpis";

const AXIS = { fontSize: 11, fill: "var(--kb-text-dim)" };

/**
 * 12 400 as "12k".
 *
 * A six-month money chart hits five and six figures, and an axis wide enough
 * to print those in full eats a third of a card this size — which is how the
 * labels ended up clipped to a single bracket. Short labels, full numbers in
 * the tooltip.
 */
function tick(value: number): string {
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (n >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value));
}

const TONE_INK: Record<string, string> = {
  plain: "var(--kb-text)",
  good: "var(--kb-tint-mint-ink)",
  warn: "var(--kb-tint-yellow-ink)",
  bad: "var(--kb-status-danger-ink)",
};

function Shell({ panel, base, children }: { panel: KpiPanel; base: string; children: React.ReactNode }) {
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">{panel.title}</h3>
        {panel.href && <span className="text-[10px] text-[var(--kb-text-dim)]">→</span>}
      </div>
      {children}
      {panel.note && <p className="mt-1.5 text-[11px] leading-snug text-[var(--kb-text-dim)]">{panel.note}</p>}
    </>
  );

  const className = "kb-card kb-float block p-4";
  return panel.href ? (
    <Link href={`${base}/${panel.href}`} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function Stat({ panel, base }: { panel: KpiPanel; base: string }) {
  return (
    <Shell panel={panel} base={base}>
      <p className="mt-1.5 truncate text-2xl font-semibold" style={{ color: TONE_INK[panel.tone ?? "plain"] }}>
        {panel.value}
      </p>
      {typeof panel.deltaPercent === "number" && (
        <p className="mt-0.5 text-[11px] text-[var(--kb-text-dim)]">
          {panel.deltaPercent >= 0 ? "↑" : "↓"} {Math.abs(panel.deltaPercent)}% {panel.deltaNote ?? ""}
        </p>
      )}
      {panel.spark && panel.spark.length > 1 && (
        <div className="mt-2 h-8" style={{ color: TONE_INK[panel.tone ?? "plain"] }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={panel.spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area type="monotone" dataKey="v" stroke="currentColor" fill="currentColor" fillOpacity={0.14} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Shell>
  );
}

function Trend({ panel, base }: { panel: KpiPanel; base: string }) {
  const id = `fill-${panel.key}`;
  return (
    <Shell panel={panel} base={base}>
      <div className="mt-2">
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={panel.series ?? []} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--kb-accent-a)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--kb-accent-a)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} allowDecimals={false} tickFormatter={tick} />
            <Tooltip content={<CardTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              name={panel.title}
              stroke="var(--kb-accent-a)"
              fill={`url(#${id})`}
              strokeWidth={2.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Shell>
  );
}

function Donut({ panel, base }: { panel: KpiPanel; base: string }) {
  const slices = panel.slices ?? [];
  const total = slices.reduce((s, d) => s + d.value, 0);
  return (
    <Shell panel={panel} base={base}>
      <div className="mt-2 flex items-center gap-3">
        <ResponsiveContainer width={96} height={96}>
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius={30} outerRadius={46} strokeWidth={0} paddingAngle={total > 1 ? 2 : 0}>
              {slices.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <ul className="flex-1 space-y-1">
          {slices.map((d) => (
            <li key={d.name} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 truncate text-[var(--kb-text-dim)]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                {d.name}
              </span>
              <span className="font-semibold text-[var(--kb-text)]">{d.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}

function Breakdown({ panel, base }: { panel: KpiPanel; base: string }) {
  const slices = panel.slices ?? [];
  return (
    <Shell panel={panel} base={base}>
      <div className="mt-2">
        <ResponsiveContainer width="100%" height={Math.max(80, slices.length * 30)}>
          <BarChart data={slices} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={86} />
            <Tooltip content={<CardTooltip />} cursor={{ fill: "var(--kb-panel-border)", opacity: 0.3 }} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
              {slices.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Shell>
  );
}

export function KpiBoardView({ groups, base }: { groups: KpiGroup[]; base: string }) {
  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">{group.title}</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {group.panels.map((panel) => {
              const props = { panel, base, key: panel.key };
              switch (panel.kind) {
                case "trend":
                  return <Trend {...props} />;
                case "donut":
                  return <Donut {...props} />;
                case "breakdown":
                  return <Breakdown {...props} />;
                default:
                  return <Stat {...props} />;
              }
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
