"use client";

// What was read, before it is written down.
//
// Every value is editable and every one says which document it came from,
// because a VAT number read off a photograph of a certificate is a claim
// until a person looks at it. Anything can be unticked; nothing is saved
// until the button at the bottom.

import { useMemo, useState } from "react";
import { applyProposalAction } from "./actions";
import {
  BANKING_FIELDS,
  BUSINESS_FIELDS,
  FIELD_LABELS,
  type AcceptedProposal,
  type BankingField,
  type BusinessField,
  type Proposal,
  type ProposedObligation,
  type ProposedParty,
  type ProposedProduct,
} from "@/lib/onboarding/proposal";

export type Section = "business" | "banking" | "certificates" | "products" | "customers" | "suppliers";

interface FieldRow {
  field: string;
  label: string;
  value: string;
  source: string;
  include: boolean;
}

type Row<T> = T & { include: boolean };

function money(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/** The tick is a screen concern; it never travels with the row. */
function without<T extends { include: boolean }>(row: T): Omit<T, "include"> {
  const copy: Partial<T> = { ...row };
  delete copy.include;
  return copy as Omit<T, "include">;
}

function cents(text: string): number | null {
  const n = Number(text.replace(/[^\d.-]/g, ""));
  return text.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
}

export function ProposalReview({
  tenantId,
  proposal,
  sections,
  offerCalendar = false,
  alsoSave,
  submitLabel = "Save these to my workspace",
  onApplied,
}: {
  tenantId: string;
  proposal: Proposal;
  sections: Section[];
  /** Offer to build the whole compliance calendar for this jurisdiction. */
  offerCalendar?: boolean;
  /** Saved alongside whatever is ticked — the country the calendar depends on. */
  alsoSave?: Record<string, string>;
  submitLabel?: string;
  onApplied?: (lines: string[]) => void;
}) {
  const initial = useMemo(() => {
    const fields = (keys: readonly string[], found: Record<string, { value: string; source: string } | undefined>): FieldRow[] =>
      keys
        .filter((k) => found[k])
        .map((k) => ({ field: k, label: FIELD_LABELS[k as BusinessField | BankingField] ?? k, value: found[k]!.value, source: found[k]!.source, include: true }));
    return {
      business: fields(BUSINESS_FIELDS, proposal.business as Record<string, { value: string; source: string }>),
      banking: fields(BANKING_FIELDS, proposal.banking as Record<string, { value: string; source: string }>),
      certificates: proposal.obligations.map((o) => ({ ...o, include: true })),
      products: proposal.products.map((p) => ({ ...p, include: true })),
      customers: proposal.customers.map((c) => ({ ...c, include: true })),
      suppliers: proposal.suppliers.map((s) => ({ ...s, include: true })),
    };
  }, [proposal]);

  const [business, setBusiness] = useState<FieldRow[]>(initial.business);
  const [banking, setBanking] = useState<FieldRow[]>(initial.banking);
  const [certificates, setCertificates] = useState<Row<ProposedObligation>[]>(initial.certificates);
  const [products, setProducts] = useState<Row<ProposedProduct>[]>(initial.products);
  const [customers, setCustomers] = useState<Row<ProposedParty>[]>(initial.customers);
  const [suppliers, setSuppliers] = useState<Row<ProposedParty>[]>(initial.suppliers);
  const [buildCalendar, setBuildCalendar] = useState(offerCalendar);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = (s: Section) => sections.includes(s);
  const counts = {
    business: business.filter((r) => r.include).length,
    banking: banking.filter((r) => r.include).length,
    certificates: certificates.filter((r) => r.include).length,
    products: products.filter((r) => r.include).length,
    customers: customers.filter((r) => r.include).length,
    suppliers: suppliers.filter((r) => r.include).length,
  };
  const total =
    (show("business") ? counts.business : 0) +
    (show("banking") ? counts.banking : 0) +
    (show("certificates") ? counts.certificates : 0) +
    (show("products") ? counts.products : 0) +
    (show("customers") ? counts.customers : 0) +
    (show("suppliers") ? counts.suppliers : 0);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const values = (rows: FieldRow[]) =>
        Object.fromEntries(rows.filter((r) => r.include && r.value.trim()).map((r) => [r.field, r.value.trim()]));
      const accepted: AcceptedProposal = {
        business: { ...(alsoSave ?? {}), ...(show("business") ? values(business) : {}) },
        banking: show("banking") ? values(banking) : {},
        obligations: show("certificates") ? certificates.filter((r) => r.include).map(without) : [],
        customers: show("customers") ? customers.filter((r) => r.include).map(without) : [],
        suppliers: show("suppliers") ? suppliers.filter((r) => r.include).map(without) : [],
        products: show("products") ? products.filter((r) => r.include).map(without) : [],
        buildCalendar: show("certificates") && buildCalendar,
      };
      const result = await applyProposalAction(tenantId, accepted);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(result.lines);
      onApplied?.(result.lines);
    } catch {
      setError("That did not save. Try once more.");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="kb-card p-5">
        <p className="text-sm font-semibold text-[var(--kb-text)]">Saved.</p>
        <ul className="mt-2 space-y-1">
          {saved.map((line) => (
            <li key={line} className="text-sm text-[var(--kb-text-dim)]">
              · {line}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const tick = (checked: boolean, onChange: (v: boolean) => void) => (
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 shrink-0" />
  );

  const fieldList = (rows: FieldRow[], set: (rows: FieldRow[]) => void, title: string) =>
    rows.length === 0 ? null : (
      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">{title}</h3>
        <div className="mt-2 space-y-2">
          {rows.map((row, i) => (
            <label key={row.field} className="flex items-start gap-2">
              {tick(row.include, (v) => set(rows.map((r, j) => (i === j ? { ...r, include: v } : r))))}
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-[var(--kb-text-dim)]">
                  {row.label} <span className="opacity-70">· from {row.source}</span>
                </span>
                <input
                  value={row.value}
                  onChange={(e) => set(rows.map((r, j) => (i === j ? { ...r, value: e.target.value } : r)))}
                  className="kb-input mt-1 w-full text-sm"
                />
              </span>
            </label>
          ))}
        </div>
      </section>
    );

  return (
    <div className="kb-card p-5">
      {fieldList(show("business") ? business : [], setBusiness, "Your business")}
      {fieldList(show("banking") ? banking : [], setBanking, "Where you get paid")}

      {show("certificates") && certificates.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Dates to keep</h3>
          <div className="mt-2 space-y-2">
            {certificates.map((c, i) => (
              <label key={c.key} className="flex items-start gap-2">
                {tick(c.include, (v) => setCertificates(certificates.map((r, j) => (i === j ? { ...r, include: v } : r))))}
                <span className="min-w-0 flex-1">
                  <input
                    value={c.title}
                    onChange={(e) => setCertificates(certificates.map((r, j) => (i === j ? { ...r, title: e.target.value } : r)))}
                    className="kb-input w-full text-sm"
                  />
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--kb-text-dim)]">
                    <span>Expires</span>
                    <input
                      type="date"
                      value={c.expiresOn ?? ""}
                      onChange={(e) => setCertificates(certificates.map((r, j) => (i === j ? { ...r, expiresOn: e.target.value || null } : r)))}
                      className="kb-input !py-1 text-xs"
                    />
                    <span className="opacity-70">from {c.source}</span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      {show("certificates") && offerCalendar && (
        <label className="mt-4 flex items-start gap-2 rounded-lg p-3" style={{ background: "var(--kb-tint-blue)" }}>
          {tick(buildCalendar, setBuildCalendar)}
          <span className="text-xs text-[var(--kb-text)]">
            Put everything this kind of business owes on the calendar — the annual return, the VAT dates, the returns that follow from
            having staff or vehicles. Each one arrives as work while it is still cheap.
          </span>
        </label>
      )}

      {show("products") && products.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
            What you sell · {counts.products} of {products.length}
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
                  <th className="w-6 py-1"></th>
                  <th className="w-[40%] py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">Code</th>
                  <th className="py-1 pr-2 text-right">Price</th>
                  <th className="py-1 pr-2 text-right">Cost</th>
                  <th className="py-1 text-right">In stock</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => {
                  const set = (patch: Partial<Row<ProposedProduct>>) =>
                    setProducts(products.map((r, j) => (i === j ? { ...r, ...patch } : r)));
                  return (
                    <tr key={p.key} className="border-t border-[var(--kb-panel-border)]">
                      <td className="py-1">{tick(p.include, (v) => set({ include: v }))}</td>
                      <td className="min-w-[12rem] py-1 pr-2">
                        <input value={p.name} onChange={(e) => set({ name: e.target.value })} className="kb-input w-full !py-1 text-sm" />
                      </td>
                      <td className="py-1 pr-2">
                        <input value={p.sku ?? ""} onChange={(e) => set({ sku: e.target.value || null })} className="kb-input w-24 !py-1 text-sm" />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          value={money(p.unitPriceCents)}
                          onChange={(e) => set({ unitPriceCents: cents(e.target.value) })}
                          inputMode="decimal"
                          className="kb-input w-24 !py-1 text-right text-sm"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          value={money(p.costCents)}
                          onChange={(e) => set({ costCents: cents(e.target.value) })}
                          inputMode="decimal"
                          className="kb-input w-24 !py-1 text-right text-sm"
                        />
                      </td>
                      <td className="py-1">
                        <input
                          value={p.quantityOnHand ?? ""}
                          onChange={(e) => set({ quantityOnHand: e.target.value.trim() === "" ? null : Math.round(Number(e.target.value)) || 0 })}
                          inputMode="numeric"
                          className="kb-input w-20 !py-1 text-right text-sm"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(["customers", "suppliers"] as const).map((which) => {
        const rows = which === "customers" ? customers : suppliers;
        const setRows = which === "customers" ? setCustomers : setSuppliers;
        if (!show(which) || rows.length === 0) return null;
        return (
          <section key={which} className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
              {which === "customers" ? "Who you sell to" : "Who you buy from"} · {counts[which]} of {rows.length}
            </h3>
            <div className="mt-2 space-y-2">
              {rows.map((p, i) => {
                const set = (patch: Partial<Row<ProposedParty>>) => setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
                return (
                  <label key={p.key} className="flex items-start gap-2">
                    {tick(p.include, (v) => set({ include: v }))}
                    <span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-3">
                      <input value={p.name} onChange={(e) => set({ name: e.target.value })} className="kb-input !py-1 text-sm" />
                      <input
                        value={p.email ?? ""}
                        placeholder="email"
                        onChange={(e) => set({ email: e.target.value || null })}
                        className="kb-input !py-1 text-sm"
                      />
                      <input
                        value={p.phone ?? ""}
                        placeholder="phone"
                        onChange={(e) => set({ phone: e.target.value || null })}
                        className="kb-input !py-1 text-sm"
                      />
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}

      {error && <p className="mt-3 text-xs text-[var(--kb-tint-peach-ink)]">{error}</p>}

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--kb-text-dim)]">{total === 0 ? "Nothing ticked." : `${total} things ticked.`}</span>
        <button type="button" onClick={save} disabled={saving || total === 0} className="kb-pill kb-pill-primary text-sm">
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
