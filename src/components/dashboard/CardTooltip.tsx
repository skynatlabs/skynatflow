"use client";

// One typed tooltip for every recharts surface in the app. Previously this
// same component was copy-pasted into MiniCharts, HomeCharts and
// AdminHomeCharts, each typed `any` — so a wrong prop name or a formatter
// handed the wrong value type failed silently at runtime instead of at the
// call site. Recharts doesn't export a usable props type for custom
// tooltip content, so the shape it actually passes is declared here.

export interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
}

export interface CardTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  // Every chart in this app plots numbers; recharts still types the
  // value loosely, so it is coerced once here rather than at each caller.
  formatter?: (value: number) => string;
}

export function CardTooltip({ active, payload, label, formatter }: CardTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="kb-card px-3 py-2 text-xs" style={{ boxShadow: "0 8px 24px -8px rgba(0,0,0,0.25)" }}>
      {label !== undefined && label !== "" && (
        <p className="font-semibold text-[var(--kb-text)]">{label}</p>
      )}
      {payload.map((p, i) => (
        <p key={p.dataKey ?? p.name ?? i} className="text-[var(--kb-text-dim)]">
          {p.name}:{" "}
          <span className="font-semibold text-[var(--kb-text)]">
            {formatter && p.value !== undefined ? formatter(Number(p.value)) : p.value}
          </span>
        </p>
      ))}
    </div>
  );
}
