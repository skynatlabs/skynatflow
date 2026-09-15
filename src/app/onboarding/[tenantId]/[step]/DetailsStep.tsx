"use client";

// What a tax invoice has to carry, and what the calendar has to know.
//
// The form is prefilled with whatever the paperwork already gave up. Anything
// still blank can be typed, or another document dropped in — the certificate,
// the VAT letter, the bank confirmation — and the fields fill themselves.

import { useEffect, useState } from "react";
import { IntakeDropZone } from "../../IntakeDropZone";
import { ProposalReview } from "../../ProposalReview";
import { saveDetailsAction } from "../../actions";
import { addPending, adoptPending, clearPending } from "../../pending";
import { emptyProposal, narrate, type Proposal } from "@/lib/onboarding/proposal";

export interface DetailsValues {
  name: string;
  countryCode: string;
  registrationNumber: string;
  vatNumber: string;
  entityType: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankBranchCode: string;
}

const FIELDS: Array<{ key: keyof DetailsValues; label: string; hint?: string; wide?: boolean }> = [
  { key: "name", label: "Business name" },
  { key: "entityType", label: "Type", hint: "Pty Ltd, CC, sole proprietor" },
  { key: "registrationNumber", label: "Registration number" },
  { key: "vatNumber", label: "VAT number", hint: "Leave blank if not registered" },
  { key: "businessAddress", label: "Address", wide: true },
  { key: "businessEmail", label: "Email" },
  { key: "businessPhone", label: "Phone" },
  { key: "bankName", label: "Bank" },
  { key: "bankAccountHolder", label: "Account holder" },
  { key: "bankAccountNumber", label: "Account number" },
  { key: "bankBranchCode", label: "Branch code" },
];

export function DetailsStep({
  tenantId,
  values,
  countries,
}: {
  tenantId: string;
  values: DetailsValues;
  countries: Array<{ code: string; name: string }>;
}) {
  const [form, setForm] = useState(values);
  const [pending, setPending] = useState<Proposal>(emptyProposal());
  const [savedLines, setSavedLines] = useState<string[] | null>(null);

  useEffect(() => {
    const waiting = adoptPending(tenantId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session storage is only readable after mount
    setPending(waiting);
    setForm((current) => fill(current, waiting));
  }, [tenantId]);

  function fill(current: DetailsValues, p: Proposal): DetailsValues {
    const next = { ...current };
    for (const key of Object.keys(next) as Array<keyof DetailsValues>) {
      if (key === "countryCode") continue;
      const found = (p.business as Record<string, { value: string } | undefined>)[key] ?? (p.banking as Record<string, { value: string } | undefined>)[key];
      if (found?.value && !next[key]) next[key] = found.value;
    }
    return next;
  }

  function absorb(read: Proposal) {
    const merged = addPending(tenantId, read);
    setPending(merged);
    setForm((current) => fill(current, merged));
  }

  const certificates = { ...pending, products: [], customers: [], suppliers: [] };

  return (
    <div className="space-y-4">
      <IntakeDropZone
        tenantId={tenantId}
        onRead={absorb}
        hint="Registration certificate, VAT letter, bank confirmation, an old invoice"
        askForWords
      />

      {pending.documents.length > 0 && (
        <div className="kb-card p-4" style={{ background: "var(--kb-tint-blue)" }}>
          <ul className="space-y-0.5">
            {narrate(pending).map((line) => (
              <li key={line} className="text-sm text-[var(--kb-text)]">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(certificates.obligations.length > 0 || savedLines) && (
        <ProposalReview
          key={certificates.obligations.map((o) => o.key).join("|")}
          tenantId={tenantId}
          proposal={certificates}
          sections={["certificates"]}
          offerCalendar
          alsoSave={{ countryCode: form.countryCode }}
          submitLabel="Put these on my calendar"
          onApplied={(lines) => {
            setSavedLines(lines);
            clearPending(tenantId, ["obligations"]);
            setPending((p) => ({ ...p, obligations: [] }));
          }}
        />
      )}

      {certificates.obligations.length === 0 && !savedLines && (
        <CalendarOffer tenantId={tenantId} countryCode={form.countryCode} />
      )}

      <form action={saveDetailsAction.bind(null, tenantId)} className="kb-card p-5">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">Check these over</h2>
        <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
          This is what goes on every quote and invoice you send. Anything you leave blank you can fill in later.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className="block text-xs font-medium text-[var(--kb-text-dim)]">
              Country <span className="font-normal opacity-70">· decides your filings and your currency</span>
            </span>
            <select
              name="countryCode"
              value={form.countryCode}
              onChange={(e) => setForm({ ...form, countryCode: e.target.value })}
              className="kb-input mt-1 w-full text-sm"
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {FIELDS.map((f) => (
            <label key={f.key} className={f.wide ? "sm:col-span-2" : undefined}>
              <span className="block text-xs font-medium text-[var(--kb-text-dim)]">
                {f.label}
                {f.hint && <span className="font-normal opacity-70"> · {f.hint}</span>}
              </span>
              <input
                name={f.key}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="kb-input mt-1 w-full text-sm"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="submit" className="kb-pill kb-pill-primary text-sm">
            Save and carry on
          </button>
        </div>
      </form>
    </div>
  );
}

/** No certificate handed over — the calendar can still be built from what the business is. */
function CalendarOffer({ tenantId, countryCode }: { tenantId: string; countryCode: string }) {
  const [state, setState] = useState<"ask" | "building" | string[]>("ask");
  if (Array.isArray(state)) {
    return (
      <div className="kb-card p-4">
        <ul className="space-y-0.5">
          {state.map((line) => (
            <li key={line} className="text-sm text-[var(--kb-text-dim)]">
              · {line}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="kb-card flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="max-w-md text-sm text-[var(--kb-text-dim)]">
        I can put what a business like yours owes on the calendar — the annual return, the VAT dates, the returns that come with staff
        or vehicles — so each one arrives as work while it is still cheap.
      </p>
      <button
        type="button"
        disabled={state === "building"}
        className="kb-pill kb-pill-ghost text-xs"
        onClick={async () => {
          setState("building");
          const { applyProposalAction } = await import("../../actions");
          const result = await applyProposalAction(tenantId, {
            business: { countryCode },
            banking: {},
            obligations: [],
            customers: [],
            suppliers: [],
            products: [],
            buildCalendar: true,
          });
          setState(result.lines.length ? result.lines : [result.message]);
        }}
      >
        {state === "building" ? "Building…" : "Build my calendar"}
      </button>
    </div>
  );
}
