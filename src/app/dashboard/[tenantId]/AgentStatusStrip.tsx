// "Is anything happening right now?" — the strip that makes the platform feel
// like it's running rather than sitting still.
//
// Server-rendered from real rows, not decoration: a run that is RUNNING is
// genuinely mid-flight, and a count of waiting approvals is a real queue. The
// only thing that ticks on its own is the relative timestamp, so the page
// doesn't claim freshness it doesn't have.

import Link from "next/link";

export interface AgentStatus {
  running: number;
  awaitingApproval: number;
  lastRunAt: Date | null;
  lastRunSummary: string | null;
  proactive: boolean;
  activeAgents: number;
}

function ago(date: Date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AgentStatusStrip({
  tenantId,
  status,
}: {
  tenantId: string;
  status: AgentStatus;
}) {
  const { running, awaitingApproval, lastRunAt, lastRunSummary, proactive, activeAgents } = status;

  // The state worth leading with, in order of how much it wants attention.
  const headline =
    running > 0
      ? { label: `Working on ${running === 1 ? "something" : `${running} things`} now`, tone: "busy" as const }
      : awaitingApproval > 0
        ? {
            label: `${awaitingApproval} ${awaitingApproval === 1 ? "action needs" : "actions need"} your approval`,
            tone: "waiting" as const,
          }
        : proactive
          ? { label: "Watching the business", tone: "idle" as const }
          : { label: "Only responds when asked", tone: "off" as const };

  const toneStyles = {
    busy: { background: "var(--kb-tint-blue)", color: "var(--kb-tint-blue-ink)" },
    waiting: { background: "var(--kb-tint-yellow)", color: "var(--kb-tint-yellow-ink)" },
    idle: { background: "var(--kb-tint-mint)", color: "var(--kb-tint-mint-ink)" },
    off: { background: "var(--kb-panel-border)", color: "var(--kb-text-dim)" },
  }[headline.tone];

  return (
    <section className="kb-card flex flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:px-4">
      <span
        className="inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={toneStyles}
      >
        <span className="relative flex h-1.5 w-1.5">
          {headline.tone === "busy" && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:animate-none"
              style={{ background: "currentColor" }}
            />
          )}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
        </span>
        {headline.label}
      </span>

      {lastRunSummary && (
        <p className="min-w-0 flex-1 truncate text-xs text-[var(--kb-text-dim)]">
          <span className="font-medium text-[var(--kb-text)]">Last:</span> {lastRunSummary}
          {lastRunAt && <span> · {ago(lastRunAt)}</span>}
        </p>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
        {activeAgents > 0 && (
          <span className="text-[var(--kb-text-dim)]">
            {activeAgents} {activeAgents === 1 ? "agent" : "agents"} on the job
          </span>
        )}
        <Link
          href={`/dashboard/${tenantId}/agent`}
          className="font-semibold hover:underline"
          style={{ color: "var(--kb-accent-a)" }}
        >
          {awaitingApproval > 0 ? "Review →" : "Agent console →"}
        </Link>
      </div>
    </section>
  );
}
