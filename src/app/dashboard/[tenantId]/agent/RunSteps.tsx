// "Here is exactly what it did" — the reasoning trail behind one run.
//
// Collapsed by default: an owner deciding whether to approve needs the
// summary, not a wall of JSON. But the detail has to be one click away, or
// "the agent decided" is something they're asked to take on faith.

"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { approveActionAction, rejectActionAction } from "./actions";
import { toolLabel } from "@/lib/agent/toolLabels";

interface Step {
  tool?: string;
  input?: unknown;
  output?: unknown;
  isMutation?: boolean;
  blockedReason?: string;
}

interface PendingAction {
  tool?: string;
  input?: unknown;
  reason?: string;
}

function asSteps(value: unknown): Step[] {
  return Array.isArray(value) ? (value as Step[]) : [];
}

function asPending(value: unknown): PendingAction[] {
  return Array.isArray(value) ? (value as PendingAction[]) : [];
}

/** Arguments matter more than tool names to a non-technical reader. */
function summariseInput(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input !== "object") return String(input);
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return entries.join(" · ");
}

export function RunSteps({
  steps,
  pendingActions,
  tenantId,
  runId,
  canApprove = false,
}: {
  steps: unknown;
  pendingActions?: unknown;
  /** All three are needed to offer per-action approval; omit for read-only. */
  tenantId?: string;
  runId?: string;
  canApprove?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parsed = asSteps(steps);
  const pending = asPending(pendingActions);

  if (parsed.length === 0 && pending.length === 0) return null;

  return (
    <div className="mt-3">
      {pending.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {pending.map((action, i) => (
            <li
              key={i}
              className="rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2.5 text-xs"
            >
              <p className="font-medium text-[var(--kb-text)]">{action.tool ? toolLabel(action.tool) : "An action"}</p>
              {summariseInput(action.input) && (
                <p className="mt-0.5 break-words font-mono text-[11px] text-[var(--kb-text-dim)]">
                  {summariseInput(action.input)}
                </p>
              )}
              {action.reason && (
                <p className="mt-1 text-[11px] text-[var(--kb-text-dim)]">{action.reason}</p>
              )}

              {canApprove && tenantId && runId && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <form action={approveActionAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="runId" value={runId} />
                    <input type="hidden" name="index" value={i} />
                    <SubmitButton
                      className="kb-pill kb-pill-primary text-[11px]"
                      pendingText="Running…"
                    >
                      Approve this
                    </SubmitButton>
                  </form>
                  <form action={rejectActionAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="runId" value={runId} />
                    <input type="hidden" name="index" value={i} />
                    <SubmitButton
                      className="kb-pill kb-pill-ghost text-[11px]"
                      pendingText="…"
                    >
                      Not this one
                    </SubmitButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {parsed.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-[var(--kb-text-dim)] underline hover:text-[var(--kb-text)]"
          >
            {open ? "Hide" : `Show what it checked (${parsed.length})`}
          </button>

          {open && (
            <ol className="mt-2 space-y-1.5">
              {parsed.map((step, i) => (
                <li
                  key={i}
                  className="overflow-x-auto rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-[var(--kb-text)]">
                      {step.tool ? toolLabel(step.tool) : "A step"}
                    </span>
                    {step.isMutation && !step.blockedReason && (
                      <span
                        className="kb-pill text-[10px]"
                        style={{ background: "var(--kb-tint-mint)", color: "var(--kb-tint-mint-ink)" }}
                      >
                        changed data
                      </span>
                    )}
                    {step.blockedReason && (
                      <span
                        className="kb-pill text-[10px]"
                        style={{ background: "var(--kb-tint-yellow)", color: "var(--kb-tint-yellow-ink)" }}
                      >
                        held
                      </span>
                    )}
                  </div>
                  {summariseInput(step.input) && (
                    <p className="mt-1 break-words font-mono text-[11px] text-[var(--kb-text-dim)]">
                      {summariseInput(step.input)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
