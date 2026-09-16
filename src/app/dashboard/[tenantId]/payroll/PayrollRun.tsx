"use client";

// Run the month, and see the arithmetic.
//
// Every payslip can be opened to show how its number was reached. That is not
// a nicety: the reason small businesses will not move payroll off a
// spreadsheet is that they cannot see inside the software, and a PAYE figure
// somebody cannot check is one they will not deduct.

import { useState } from "react";
import type { PayrollResult } from "./actions";
import { useMoney } from "@/components/WorkspaceRegionProvider";


export function PayrollRun({
  tenantId,
  people,
  defaultMonth,
  runAction,
}: {
  tenantId: string;
  people: Array<{ id: string; name: string; costRateCents: number | null }>;
  defaultMonth: string;
  runAction: (formData: FormData) => Promise<PayrollResult>;
}) {
  const money = useMoney();
  const [result, setResult] = useState<PayrollResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="grid gap-4">
      <form
        action={async (formData) => {
          setBusy(true);
          setError(null);
          try {
            setResult(await runAction(formData));
          } catch (e) {
            setError(e instanceof Error ? e.message : "That did not run.");
          } finally {
            setBusy(false);
          }
        }}
        className="kb-card p-4 sm:p-5"
      >
        <input type="hidden" name="tenantId" value={tenantId} />

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--kb-text-dim)]">
            Month
            <input
              type="month"
              name="month"
              defaultValue={defaultMonth}
              className="mt-1 w-44 rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
            />
          </label>
        </div>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--kb-text-dim)]">
              <th className="pb-2">Person</th>
              <th className="pb-2">Monthly salary</th>
              <th className="pb-2">Or per hour</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--kb-panel-border)]">
            {people.map((person) => (
              <tr key={person.id}>
                <td className="py-2 pr-3 text-[var(--kb-text)]">{person.name}</td>
                <td className="py-2 pr-3">
                  <input
                    name={`salary-${person.id}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-32 rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2 py-1.5 text-sm text-[var(--kb-text)]"
                  />
                </td>
                <td className="py-2">
                  <input
                    name={`hourly-${person.id}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-28 rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2 py-1.5 text-sm text-[var(--kb-text)]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-2 text-[11px] text-[var(--kb-text-dim)]">
          An hourly rate is paid against the hours actually clocked that month. Leave both blank for somebody who is not
          on this run.
        </p>

        <button type="submit" disabled={busy} className="kb-pill kb-pill-primary mt-4 text-xs disabled:opacity-50">
          {busy ? "Working it out…" : "Work out the month"}
        </button>
      </form>

      {error && <p className="text-xs text-[var(--kb-tint-rose-ink)]">{error}</p>}

      {result && (
        <>
          <section className="kb-card p-4 sm:p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">The payslips</h2>
            <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
              {result.payslips.map((slip) => (
                <li key={slip.name} className="py-3">
                  <button
                    type="button"
                    onClick={() => setOpen(open === slip.name ? null : slip.name)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
                  >
                    <span className="text-sm font-medium text-[var(--kb-text)]">{slip.name}</span>
                    <span className="text-sm tabular-nums text-[var(--kb-text)]">
                      {money(slip.net)}
                      <span className="ml-2 text-[11px] text-[var(--kb-text-dim)]">of {money(slip.gross)}</span>
                    </span>
                  </button>

                  {slip.warnings.map((warning) => (
                    <p key={warning} className="mt-1 text-xs text-[var(--kb-tint-amber-ink)]">
                      {warning}
                    </p>
                  ))}

                  {open === slip.name && (
                    <div className="mt-3 rounded-xl border border-[var(--kb-panel-border)] p-3">
                      <ul className="grid gap-1 text-xs">
                        {slip.lines.map((line, index) => (
                          <li key={`${line.label}-${index}`} className="flex justify-between gap-2">
                            <span className="text-[var(--kb-text-dim)]">
                              {line.label}
                              {line.kind === "employer" && " (the business pays this, not the employee)"}
                            </span>
                            <span className="tabular-nums text-[var(--kb-text)]">
                              {line.kind === "deduction" ? "−" : ""}
                              {money(line.amountCents)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <ul className="mt-3 grid gap-1 text-[11px] text-[var(--kb-text-dim)]">
                        {slip.workings.map((working, index) => (
                          <li key={index}>{working}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="kb-card p-4 sm:p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
              EMP201 — due {result.emp201.dueOn}
            </h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--kb-text-dim)]">PAYE</dt>
                <dd className="tabular-nums text-[var(--kb-text)]">{money(result.emp201.paye)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--kb-text-dim)]">UIF (both sides)</dt>
                <dd className="tabular-nums text-[var(--kb-text)]">{money(result.emp201.uif)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--kb-text-dim)]">SDL</dt>
                <dd className="tabular-nums text-[var(--kb-text)]">{money(result.emp201.sdl)}</dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-[var(--kb-panel-border)] pt-2">
                <dt className="font-medium text-[var(--kb-text)]">To SARS</dt>
                <dd className="font-medium tabular-nums text-[var(--kb-text)]">{money(result.emp201.total)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--kb-text-dim)]">To staff</dt>
                <dd className="tabular-nums text-[var(--kb-text)]">{money(result.wagesTotal)}</dd>
              </div>
            </dl>
            <ul className="mt-3 grid gap-1 text-[11px] text-[var(--kb-text-dim)]">
              {result.emp201.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
