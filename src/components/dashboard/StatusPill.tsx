// Shared status pill styling for quotes/invoices — background + ink pair
// per status, themed via the active skin's tint tokens so every skin
// (including jewel) recolors these automatically. Paid and Declined
// deliberately sit in different tint slots — a won deal and a lost one
// used to render as the exact same color, which made lists unreadable
// at a glance.
export const STATUS_PILL: Record<string, { bg: string; ink: string }> = {
  DRAFT: { bg: "var(--kb-panel-border)", ink: "var(--kb-text-dim)" },
  SENT: { bg: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
  ACCEPTED: { bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  PAID: { bg: "var(--kb-tint-peach)", ink: "var(--kb-tint-peach-ink)" },
  PARTIALLY_PAID: { bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  DECLINED: { bg: "var(--kb-tint-violet)", ink: "var(--kb-tint-violet-ink)" },
  OVERDUE: { bg: "var(--kb-status-danger)", ink: "var(--kb-status-danger-ink)" },
  CANCELLED: { bg: "var(--kb-panel-border)", ink: "var(--kb-text-dim)" },
};

export function StatusPill({ status, className = "" }: { status: string; className?: string }) {
  const colors = STATUS_PILL[status] ?? STATUS_PILL.CANCELLED;
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${className}`}
      style={{ background: colors.bg, color: colors.ink }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
