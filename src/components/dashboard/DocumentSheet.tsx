// A quote or invoice, shown as the document the customer receives.
//
// The detail view used to be a card of metadata with the lines as a list.
// Zoho, and every tool people have used before this one, shows the document
// itself — the page as it prints — with the actions in a bar above it, and
// that is what somebody checking a quote before it goes wants to read: does
// it look right, is the address right, do the lines and the tax add up.
//
// Paper is white in both themes on purpose: it is a picture of a printed
// page, and a dark-mode invoice is not what the customer will see.

import { computeDocumentTotal } from "@/lib/core/pricing";
import { formatMoney } from "@/lib/core/currency";

export interface SheetLine {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  unit: string | null;
  quantity: number;
  unitPriceCents: number;
  discountPercent: number | null;
  taxRatePercent: number | null;
}

export interface SheetProps {
  kind: "Quote" | "Proposal" | "Invoice";
  number: string;
  status: string;
  currency: string;
  logoDataUrl?: string | null;
  business: {
    name: string;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
    vatNumber?: string | null;
    registrationNumber?: string | null;
    bankName?: string | null;
    bankAccountHolder?: string | null;
    bankAccountNumber?: string | null;
    bankBranchCode?: string | null;
  };
  customer: {
    name: string;
    companyName?: string | null;
    addressLine?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
    vatNumber?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  issuedAt: Date;
  dueAt?: Date | null;
  subject?: string | null;
  poNumber?: string | null;
  salesperson?: string | null;
  introText?: string | null;
  scopeOfWork?: string | null;
  lines: SheetLine[];
  documentDiscountPercent: number;
  amountCents: number;
  paidCents?: number;
}

const RIBBON: Record<string, { label: string; bg: string }> = {
  DRAFT: { label: "Draft", bg: "#9aa3b2" },
  SENT: { label: "Sent", bg: "#2f6fed" },
  ACCEPTED: { label: "Accepted", bg: "#1e9e6a" },
  DECLINED: { label: "Declined", bg: "#d1453b" },
  PAID: { label: "Paid", bg: "#1e9e6a" },
  PARTIALLY_PAID: { label: "Part paid", bg: "#c98a12" },
  OVERDUE: { label: "Overdue", bg: "#d1453b" },
  CANCELLED: { label: "Cancelled", bg: "#6b7280" },
};

function day(d: Date, locale?: string) {
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

export function DocumentSheet(p: SheetProps) {
  const money = (c: number) => formatMoney(c, p.currency, { decimals: true });
  const totals = computeDocumentTotal(
    p.lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountPercent: l.discountPercent ?? 0, taxRatePercent: l.taxRatePercent ?? undefined })),
    p.documentDiscountPercent
  );
  // The stored amount is what was issued; if the lines disagree (an imported
  // document with no lines, say) the issued amount is the one to show.
  const total = p.lines.length > 0 ? totals.totalCents : p.amountCents;
  const ribbon = RIBBON[p.status] ?? { label: p.status.toLowerCase(), bg: "#6b7280" };
  const balance = p.paidCents !== undefined ? Math.max(0, total - p.paidCents) : null;
  const anyDiscount = p.lines.some((l) => (l.discountPercent ?? 0) > 0);
  const anyTax = p.lines.some((l) => (l.taxRatePercent ?? 0) > 0);
  const customerAddress = [p.customer.addressLine, [p.customer.city, p.customer.postalCode].filter(Boolean).join(" "), p.customer.country].filter(Boolean);

  return (
    <div className="bg-[var(--kb-bg)] px-2 py-6 sm:px-6">
      <article
        className="doc-sheet relative mx-auto max-w-[52rem] overflow-hidden rounded-sm bg-white text-[13px] leading-relaxed text-neutral-800 shadow-[0_2px_24px_-8px_rgba(0,0,0,0.25)]"
        style={{ colorScheme: "light" }}
      >
        <div
          aria-label={`Status: ${ribbon.label}`}
          className="pointer-events-none absolute top-5 -left-12 w-44 -rotate-45 py-1 text-center text-[11px] font-semibold tracking-wide text-white uppercase shadow"
          style={{ background: ribbon.bg }}
        >
          {ribbon.label}
        </div>

        <div className="px-5 pt-10 pb-8 sm:px-10">
          <header className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-xs pl-10 sm:pl-12">
              {p.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logoDataUrl} alt="" className="mb-2 max-h-14 w-auto" />
              ) : null}
              <p className="text-base font-semibold text-neutral-900">{p.business.name}</p>
              {p.business.address && <p className="whitespace-pre-line text-neutral-600">{p.business.address}</p>}
              {(p.business.phone || p.business.email) && <p className="text-neutral-600">{[p.business.phone, p.business.email].filter(Boolean).join(" · ")}</p>}
              {p.business.vatNumber && <p className="text-neutral-600">VAT {p.business.vatNumber}</p>}
              {p.business.registrationNumber && <p className="text-neutral-600">Reg {p.business.registrationNumber}</p>}
            </div>
            <div className="text-right">
              <p className="text-3xl font-light tracking-wide text-neutral-900 uppercase">{p.kind === "Invoice" ? "Tax invoice" : p.kind}</p>
              <p className="mt-1 font-medium text-neutral-700"># {p.number}</p>
              {balance !== null && (
                <div className="mt-3">
                  <p className="text-[11px] text-neutral-500 uppercase">Balance due</p>
                  <p className="text-lg font-semibold text-neutral-900 tabular-nums">{money(balance)}</p>
                </div>
              )}
            </div>
          </header>

          <section className="mt-8 flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[11px] text-neutral-500 uppercase">Bill to</p>
              <p className="font-semibold text-neutral-900">{p.customer.companyName || p.customer.name}</p>
              {p.customer.companyName && p.customer.companyName !== p.customer.name && <p className="text-neutral-600">{p.customer.name}</p>}
              {customerAddress.map((l) => <p key={l} className="text-neutral-600">{l}</p>)}
              {p.customer.vatNumber && <p className="text-neutral-600">VAT {p.customer.vatNumber}</p>}
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-right">
              <dt className="text-neutral-500">{p.kind === "Invoice" ? "Invoice date" : "Date"}</dt>
              <dd className="tabular-nums">{day(p.issuedAt)}</dd>
              {p.dueAt && (
                <>
                  <dt className="text-neutral-500">{p.kind === "Invoice" ? "Due date" : "Valid until"}</dt>
                  <dd className="tabular-nums">{day(p.dueAt)}</dd>
                </>
              )}
              {p.poNumber && (
                <>
                  <dt className="text-neutral-500">Reference</dt>
                  <dd>{p.poNumber}</dd>
                </>
              )}
              {p.salesperson && (
                <>
                  <dt className="text-neutral-500">Salesperson</dt>
                  <dd>{p.salesperson}</dd>
                </>
              )}
            </dl>
          </section>

          {p.subject && (
            <p className="mt-6"><span className="text-neutral-500">Subject: </span><span className="font-medium text-neutral-900">{p.subject}</span></p>
          )}
          {p.introText && <p className="mt-4 whitespace-pre-line text-neutral-700">{p.introText}</p>}
          {p.scopeOfWork && (
            <div className="mt-4">
              <p className="text-[11px] text-neutral-500 uppercase">Scope of work</p>
              <p className="whitespace-pre-line text-neutral-700">{p.scopeOfWork}</p>
            </div>
          )}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[26rem] border-collapse">
              <thead>
                <tr className="bg-neutral-800 text-left text-[11px] tracking-wide text-white uppercase">
                  <th className="w-8 px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Item &amp; description</th>
                  <th className="w-14 px-3 py-2 text-right font-medium">Qty</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">Rate</th>
                  {anyDiscount && <th className="w-16 px-3 py-2 text-right font-medium">Disc</th>}
                  {anyTax && <th className="w-16 px-3 py-2 text-right font-medium">Tax</th>}
                  <th className="w-28 px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="border-b border-neutral-200 px-3 py-6 text-center text-neutral-500">
                      No line items on this document.
                    </td>
                  </tr>
                ) : (
                  p.lines.map((l, i) => {
                    const gross = l.quantity * l.unitPriceCents;
                    const afterDiscount = gross * (1 - (l.discountPercent ?? 0) / 100);
                    return (
                      <tr key={l.id} className="border-b border-neutral-200 align-top">
                        <td className="px-3 py-2.5 text-neutral-500 tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-neutral-900">{l.name}</p>
                          {l.description && <p className="whitespace-pre-line text-[12px] text-neutral-500">{l.description}</p>}
                          {l.sku && <p className="text-[11px] text-neutral-400">SKU {l.sku}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}{l.unit ? <span className="block text-[11px] text-neutral-400">{l.unit}</span> : null}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(l.unitPriceCents)}</td>
                        {anyDiscount && <td className="px-3 py-2.5 text-right tabular-nums">{l.discountPercent ? `${l.discountPercent}%` : "—"}</td>}
                        {anyTax && <td className="px-3 py-2.5 text-right tabular-nums">{l.taxRatePercent ? `${l.taxRatePercent}%` : "—"}</td>}
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(Math.round(afterDiscount))}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <section className="mt-4 flex justify-end">
            <dl className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 tabular-nums">
              {p.lines.length > 0 && (
                <>
                  <dt className="text-neutral-500">Sub total</dt>
                  <dd className="text-right">{money(totals.subtotalCents - totals.lineDiscountCents)}</dd>
                  {totals.taxCents > 0 && (
                    <>
                      <dt className="text-neutral-500">Tax</dt>
                      <dd className="text-right">{money(totals.taxCents)}</dd>
                    </>
                  )}
                  {totals.documentDiscountCents > 0 && (
                    <>
                      <dt className="text-neutral-500">Discount ({p.documentDiscountPercent}%)</dt>
                      <dd className="text-right">−{money(totals.documentDiscountCents)}</dd>
                    </>
                  )}
                </>
              )}
              <dt className="border-t border-neutral-300 pt-2 font-semibold text-neutral-900">Total</dt>
              <dd className="border-t border-neutral-300 pt-2 text-right font-semibold text-neutral-900">{money(total)}</dd>
              {p.paidCents !== undefined && p.paidCents > 0 && (
                <>
                  <dt className="text-neutral-500">Payments made</dt>
                  <dd className="text-right">−{money(p.paidCents)}</dd>
                  <dt className="rounded-l bg-neutral-100 py-1.5 pl-2 font-semibold text-neutral-900">Balance due</dt>
                  <dd className="rounded-r bg-neutral-100 py-1.5 pr-2 text-right font-semibold text-neutral-900">{money(balance ?? 0)}</dd>
                </>
              )}
            </dl>
          </section>

          {p.lines.length > 0 && Math.abs(totals.totalCents - p.amountCents) > 1 && (
            <p className="mt-3 text-right text-[11px] text-amber-700">
              Issued at {money(p.amountCents)}; the lines add up to {money(totals.totalCents)}.
            </p>
          )}

          {p.kind === "Invoice" && p.business.bankAccountNumber && (
            <section className="mt-8 border-t border-neutral-200 pt-4">
              <p className="text-[11px] text-neutral-500 uppercase">Payment details</p>
              <p className="text-neutral-700">
                {[p.business.bankName, p.business.bankAccountHolder, `Account ${p.business.bankAccountNumber}`, p.business.bankBranchCode ? `Branch ${p.business.bankBranchCode}` : null].filter(Boolean).join(" · ")}
              </p>
              <p className="text-neutral-500">Reference: {p.number}</p>
            </section>
          )}
        </div>
      </article>
    </div>
  );
}
