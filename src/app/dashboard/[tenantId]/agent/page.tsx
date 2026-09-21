// The agent console: what it's doing, what it wants permission for, what it
// has learned, and which named agents are running.
//
// The approval queue is first deliberately. Everything else here is
// informational; that list is the only part that's blocking.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { listPendingRuns, listRecentRuns } from "@/lib/agent/approvals";
import { listAgents, AGENT_TEMPLATES, selectableToolNames } from "@/lib/agent/named";
import { AUTONOMY_LABELS, AUTONOMY_DESCRIPTIONS } from "@/lib/agent/autonomy";
import { recentEvents, EVENT_LABELS, type DomainEventType } from "@/lib/agent/events";
import { describeCron, DEFAULT_TIMEZONE } from "@/lib/agent/schedule";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { RunSteps } from "./RunSteps";
import {
  approveRunAction,
  rejectRunAction,
  setAutonomyAction,
  createAgentAction,
  toggleAgentAction,
  deleteAgentAction,
  runAgentNowAction,
  forgetFactAction,
} from "./actions";

export const dynamic = "force-dynamic";

const AUTONOMY_ORDER = ["SUGGEST_ONLY", "REVERSIBLE", "FULL"] as const;

// Cron is the storage format, not something to put in front of a business
// owner. These are the slots people actually pick; the brief is where the
// thinking goes, not the timetable.
const SCHEDULE_CHOICES = [
  { value: "", label: "Only when I ask" },
  { value: "0 6 * * 1-5", label: "Weekday mornings, 06:00" },
  { value: "0 9 * * 1-5", label: "Weekday mornings, 09:00" },
  { value: "0 17 * * 1-5", label: "Weekday evenings, 17:00" },
  { value: "0 8 * * *", label: "Every day, 08:00" },
  { value: "0 7 * * 1", label: "Every Monday, 07:00" },
  { value: "0 9 1 * *", label: "First of each month, 09:00" },
] as const;

function ago(date: Date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function AgentPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const isManager = can(access, "staff:manage");

  const [tenant, pending, recent, agents, facts, events] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { agentAutonomy: true, agentProactiveEnabled: true },
    }),
    listPendingRuns(tenantId),
    listRecentRuns(tenantId, 15),
    listAgents(tenantId),
    prisma.tenantFact.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    recentEvents(tenantId, 10),
  ]);

  const tools = selectableToolNames();

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">Your agent</h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            What it&apos;s doing, what it needs you for, and what it has learned about the business.
          </p>
        </div>
        <span
          className="kb-pill text-xs"
          style={{
            background: tenant.agentProactiveEnabled ? "var(--kb-tint-mint)" : "var(--kb-panel-border)",
            color: tenant.agentProactiveEnabled ? "var(--kb-tint-mint-ink)" : "var(--kb-text-dim)",
          }}
        >
          {tenant.agentProactiveEnabled ? "● Watching the business" : "○ Only responds when asked"}
        </span>
      </div>

      {/* ---------------------------------------------------- approval queue */}
      <section className="mt-6 sm:mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Waiting for you {pending.length > 0 && `(${pending.length})`}
        </h2>

        {pending.length === 0 ? (
          <p className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            Nothing needs approving. Anything that would move money or message a customer lands
            here first.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {pending.map((run) => (
              <article key={run.id} className="kb-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--kb-text-dim)]">
                  <span className="kb-pill" style={{ background: "var(--kb-tint-yellow)", color: "var(--kb-tint-yellow-ink)" }}>
                    Needs approval
                  </span>
                  <span>{run.trigger === "USER" ? "You asked" : run.trigger === "SCHEDULE" ? "Scheduled review" : run.trigger === "EVENT" ? "Reacting to an event" : "Named agent"}</span>
                  <span>·</span>
                  <span>{ago(run.createdAt)}</span>
                </div>

                <p className="mt-2 text-sm text-[var(--kb-text)]">{run.reply}</p>
                <RunSteps
                  steps={run.steps}
                  pendingActions={run.pendingActions}
                  tenantId={tenantId}
                  runId={run.id}
                  canApprove={isManager}
                />

                {isManager ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <form action={approveRunAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="runId" value={run.id} />
                      <SubmitButton className="kb-pill kb-pill-primary text-xs" pendingText="Running…">
                        Approve all
                      </SubmitButton>
                    </form>
                    <form action={rejectRunAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="runId" value={run.id} />
                      <SubmitButton className="kb-pill kb-pill-ghost text-xs" pendingText="Dismissing…">
                        Dismiss all
                      </SubmitButton>
                    </form>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[var(--kb-text-dim)]">
                    An owner or manager needs to approve this.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ autonomy */}
      {isManager && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
            How much it may do alone
          </h2>
          <form action={setAutonomyAction} className="kb-card mt-3 p-4 sm:p-5">
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="space-y-3">
              {AUTONOMY_ORDER.map((level) => (
                <label key={level} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="autonomy"
                    value={level}
                    defaultChecked={tenant.agentAutonomy === level}
                    className="mt-1 shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-medium text-[var(--kb-text)]">
                      {AUTONOMY_LABELS[level]}
                    </span>
                    <span className="block text-xs text-[var(--kb-text-dim)]">
                      {AUTONOMY_DESCRIPTIONS[level]}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-[var(--kb-panel-border)] pt-4">
              <input
                type="checkbox"
                name="proactive"
                defaultChecked={tenant.agentProactiveEnabled}
                className="mt-1 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium text-[var(--kb-text)]">
                  Watch the business without being asked
                </span>
                <span className="block text-xs text-[var(--kb-text-dim)]">
                  Reacts when something happens, and reviews the numbers a few times a day. Turn
                  off to make the agent answer only when spoken to.
                </span>
              </span>
            </label>

            <SubmitButton className="kb-pill kb-pill-primary mt-4 text-xs" pendingText="Saving…">
              Save
            </SubmitButton>
          </form>
        </section>
      )}

      {/* -------------------------------------------------------- named agents */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Agents on the job
        </h2>

        {agents.length === 0 ? (
          <p className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            No named agents yet. Add one below — a collections agent that chases overdue money
            every weekday morning is the usual first hire.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {agents.map((agent) => (
              <article key={agent.id} className="kb-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-[var(--kb-text)]">{agent.name}</p>
                  <span
                    className="kb-pill shrink-0 text-[10px]"
                    style={{
                      background: agent.isActive ? "var(--kb-tint-mint)" : "var(--kb-panel-border)",
                      color: agent.isActive ? "var(--kb-tint-mint-ink)" : "var(--kb-text-dim)",
                    }}
                  >
                    {agent.isActive ? "Active" : "Paused"}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-xs text-[var(--kb-text-dim)]">{agent.brief}</p>
                <p className="mt-2 text-[11px] text-[var(--kb-text-dim)]">
                  {describeCron(agent.schedule)}
                  {agent.lastRunAt && ` · last ran ${ago(agent.lastRunAt)}`}
                </p>

                {isManager && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={runAgentNowAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="agentId" value={agent.id} />
                      <SubmitButton className="kb-pill kb-pill-ghost text-[11px]" pendingText="Running…">
                        Run now
                      </SubmitButton>
                    </form>
                    <form action={toggleAgentAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="agentId" value={agent.id} />
                      <input type="hidden" name="isActive" value={String(!agent.isActive)} />
                      <SubmitButton className="kb-pill kb-pill-ghost text-[11px]" pendingText="…">
                        {agent.isActive ? "Pause" : "Resume"}
                      </SubmitButton>
                    </form>
                    <form action={deleteAgentAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="agentId" value={agent.id} />
                      <SubmitButton
                        className="text-[11px] text-[var(--kb-text-dim)] hover:underline"
                        pendingText="…"
                      >
                        Remove
                      </SubmitButton>
                    </form>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {isManager && (
          <details className="kb-card mt-3 p-4 sm:p-5">
            <summary className="cursor-pointer text-sm font-medium text-[var(--kb-text)]">
              Hire an agent
            </summary>
            <form action={createAgentAction} className="mt-4 space-y-3">
              <input type="hidden" name="tenantId" value={tenantId} />

              <div className="flex flex-wrap gap-2">
                {AGENT_TEMPLATES.map((t) => (
                  <span key={t.name} className="kb-pill text-[11px] text-[var(--kb-text-dim)]">
                    {t.name}
                  </span>
                ))}
              </div>
              <p className="text-xs text-[var(--kb-text-dim)]">
                Common starting points — or describe your own below. Write the brief the way
                you&apos;d explain the job to a new hire.
              </p>

              <label className="block text-xs">
                <span className="font-medium text-[var(--kb-text-dim)]">Name</span>
                <input
                  name="name"
                  required
                  placeholder="Collections"
                  className="mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] px-3 py-2 text-sm text-[var(--kb-text)]"
                />
              </label>

              <label className="block text-xs">
                <span className="font-medium text-[var(--kb-text-dim)]">What is it for?</span>
                <textarea
                  name="brief"
                  required
                  rows={4}
                  defaultValue={AGENT_TEMPLATES[0].brief}
                  className="mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] px-3 py-2 text-sm text-[var(--kb-text)]"
                />
              </label>

              <label className="block text-xs">
                <span className="font-medium text-[var(--kb-text-dim)]">When should it run?</span>
                <select
                  name="schedule"
                  defaultValue=""
                  className="mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] px-3 py-2 text-sm text-[var(--kb-text)]"
                >
                  {SCHEDULE_CHOICES.map((choice) => (
                    <option key={choice.label} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-[var(--kb-text-dim)]">
                  Times are on {DEFAULT_TIMEZONE.replace(/_/g, " ")} time.
                </span>
              </label>

              <fieldset className="text-xs">
                <legend className="font-medium text-[var(--kb-text-dim)]">
                  Actions it may take (leave all unticked to allow everything it has permission for)
                </legend>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                  {tools.map((t) => (
                    <label key={t} className="flex items-center gap-1.5 text-[var(--kb-text)]">
                      <input type="checkbox" name="toolNames" value={t} />
                      <span className="font-mono text-[11px]">{t}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <SubmitButton className="kb-pill kb-pill-primary text-xs" pendingText="Hiring…">
                Add agent
              </SubmitButton>
            </form>
          </details>
        )}
      </section>

      {/* ------------------------------------------------------------- history */}
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
            Recent runs
          </h2>
          {recent.length === 0 ? (
            <p className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
              Nothing yet. Ask it something from the box on your home page.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {recent.map((run) => (
                <li key={run.id} className="kb-card p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--kb-text-dim)]">
                    <span
                      className="kb-pill text-[10px]"
                      style={{
                        background:
                          run.status === "FAILED"
                            ? "var(--kb-status-danger)"
                            : run.status === "AWAITING_APPROVAL"
                              ? "var(--kb-tint-yellow)"
                              : "var(--kb-tint-mint)",
                        color:
                          run.status === "FAILED"
                            ? "var(--kb-status-danger-ink)"
                            : run.status === "AWAITING_APPROVAL"
                              ? "var(--kb-tint-yellow-ink)"
                              : "var(--kb-tint-mint-ink)",
                      }}
                    >
                      {run.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span>{ago(run.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--kb-text-dim)]">{run.input}</p>
                  {run.reply && (
                    <p className="mt-1 line-clamp-3 text-sm text-[var(--kb-text)]">{run.reply}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
            What it has learned
          </h2>
          {facts.length === 0 ? (
            <p className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
              Nothing yet. As it works, things worth remembering about how this business runs get
              kept here — and you can delete anything it has wrong.
            </p>
          ) : (
            <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
              {facts.map((fact) => (
                <li key={fact.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[var(--kb-text-dim)]">
                      {fact.key}
                    </p>
                    <p className="text-sm text-[var(--kb-text)]">{fact.value}</p>
                  </div>
                  {isManager && (
                    <form action={forgetFactAction} className="shrink-0">
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="key" value={fact.key} />
                      <SubmitButton
                        className="text-[11px] text-[var(--kb-text-dim)] hover:underline"
                        pendingText="…"
                      >
                        Forget
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
            What it noticed
          </h2>
          {events.length === 0 ? (
            <p className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
              Nothing has happened worth flagging yet.
            </p>
          ) : (
            <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
              {events.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="text-[var(--kb-text)]">
                    {EVENT_LABELS[event.type as DomainEventType] ?? event.type}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--kb-text-dim)]">
                    {ago(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="mt-8 text-xs text-[var(--kb-text-dim)]">
        Every run is recorded with what it saw and what it changed.{" "}
        <Link href={`/dashboard/${tenantId}/settings/audit-log`} className="underline">
          Full audit log
        </Link>
      </p>
    </main>
  );
}
