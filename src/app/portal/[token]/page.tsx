// The customer's own page.
//
// Token-login, no password, no account. What is here is what a customer
// actually opens a portal for: what they owe, what is overdue, every quote
// and invoice, what has been delivered — and the three things they otherwise
// go back to WhatsApp for: sending proof of payment, asking a question about
// an invoice, and correcting the address that keeps coming out wrong.
//
// Everything is scoped by the token to one Party. Nothing on this page takes
// an id from the request.

import { notFound } from "next/navigation";
import Link from "next/link";
import { portalOverview } from "@/lib/core/portal";
import { formatMoney } from "@/lib/format/money";
import { PortalActions } from "./PortalActions";
import { detailsAction, messageAction, paymentProofAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  payment_proof: "Proof of payment",
  message: "Question",
  details: "Details correction",
};

function when(d: Date) {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default async function PortalHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ do?: string }>;
}) {
  const { token } = await params;
  const { do: openTab } = await searchParams;
  const overview = await portalOverview(token);
  if (!overview) notFound();

  const { party, business, documents, deliveries, agreements, submissions } = overview;
  const money = (cents: number) => formatMoney(cents, business.currency, { decimals: true });

  const quotes = documents.filter((d) => d.kind === "QUOTE");
  const invoices = documents.filter((d) => d.kind === "INVOICE");
  const awaitingYou = quotes.filter((q) => q.status === "SENT");
  // "Pay the oldest" means the one that has been owed longest, which is the
  // earliest due date — not the earliest issued, which is a different invoice
  // the moment anything was given longer terms than usual.
  const unpaid = invoices
    .filter((i) => i.outstandingCents > 0)
    .sort((a, b) => (a.dueAt ?? a.issuedAt).getTime() - (b.dueAt ?? b.issuedAt).getTime());
  const openSubmissions = submissions.filter((s) => !s.handledAt);
  const toSign = agreements.filter((a) => a.status === "SENT");

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {business.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logoDataUrl} alt={business.name} className="h-10 w-auto max-w-[9rem] object-contain" />
          ) : null}
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">{business.name}</p>
            <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">Hi {party.name}</h1>
          </div>
        </div>
        {(business.phone || business.email) && (
          <p className="text-xs text-[var(--kb-text-dim)]">
            {business.phone && (
              <a href={`tel:${business.phone}`} className="underline">
                {business.phone}
              </a>
            )}
            {business.phone && business.email ? " · " : ""}
            {business.email && (
              <a href={`mailto:${business.email}`} className="underline">
                {business.email}
              </a>
            )}
          </p>
        )}
      </header>

      {/* What you owe, and what to do about it — the reason anyone opens this link. */}
      <section className="kb-card mt-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">Your balance</p>
            <p className="mt-1 text-3xl font-semibold text-[var(--kb-text)]">{money(overview.balanceCents)}</p>
            {overview.overdueCents > 0 ? (
              <p className="mt-1 text-sm" style={{ color: "var(--kb-status-danger-ink)" }}>
                {money(overview.overdueCents)} of it is past its due date.
              </p>
            ) : overview.balanceCents > 0 ? (
              <p className="mt-1 text-sm text-[var(--kb-text-dim)]">Nothing is overdue.</p>
            ) : (
              <p className="mt-1 text-sm text-[var(--kb-text-dim)]">You are all paid up. Thank you.</p>
            )}
          </div>
          {unpaid.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/portal/${token}/invoices/${unpaid[0].id}`} className="kb-pill kb-pill-primary text-xs">
                Pay {unpaid.length > 1 ? "the oldest" : "now"}
              </Link>
              <Link href={`/portal/${token}?do=paid#send`} className="kb-pill kb-pill-ghost text-xs">
                I&apos;ve already paid
              </Link>
            </div>
          )}
        </div>

        {business.bankAccountNumber && overview.balanceCents > 0 && (
          <div className="mt-4 rounded-xl p-3 text-xs text-[var(--kb-text)]" style={{ background: "var(--kb-tint-blue)" }}>
            <span className="font-medium">Pay by transfer:</span> {business.bankAccountHolder ?? business.name}
            {business.bankName ? ` · ${business.bankName}` : ""} · {business.bankAccountNumber}
            {business.bankBranchCode ? ` · branch ${business.bankBranchCode}` : ""}. Use your name as the reference, then send
            the proof below.
          </div>
        )}
      </section>

      {awaitingYou.length > 0 && (
        <section className="kb-card mt-4 p-5" style={{ background: "var(--kb-tint-mint)" }}>
          <p className="text-sm font-medium text-[var(--kb-text)]">
            {awaitingYou.length === 1
              ? "A quote is waiting for your answer."
              : `${awaitingYou.length} quotes are waiting for your answer.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {awaitingYou.map((q) => (
              <Link key={q.id} href={`/portal/${token}/quotes/${q.id}`} className="kb-pill kb-pill-primary text-xs">
                {q.number} · {money(q.amountCents)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {toSign.length > 0 && (
        <section className="kb-card mt-4 p-5" style={{ background: "var(--kb-tint-violet)" }}>
          <p className="text-sm font-medium text-[var(--kb-text)]">
            {toSign.length === 1 ? "There is an agreement to read and sign." : `${toSign.length} agreements are waiting for your signature.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {toSign.map((a) => (
              <Link key={a.id} href={`/portal/${token}/agreements/${a.id}`} className="kb-pill kb-pill-primary text-xs">
                {a.number} · {a.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      <h2 className="mt-8 text-sm font-semibold text-[var(--kb-text)]">Your documents</h2>
      <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)] p-0">
        {documents.map((d) => {
          const href = d.kind === "QUOTE" ? `/portal/${token}/quotes/${d.id}` : `/portal/${token}/invoices/${d.id}`;
          const overdue = d.outstandingCents > 0 && d.dueAt !== null && d.dueAt < new Date();
          return (
            <li key={d.id}>
              <Link href={href} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-black/[0.02]">
                <div className="min-w-0">
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                    style={
                      overdue
                        ? { background: "var(--kb-status-danger)", color: "var(--kb-status-danger-ink)" }
                        : { background: "var(--kb-tint-violet)", color: "var(--kb-tint-violet-ink)" }
                    }
                  >
                    {d.kind === "QUOTE" ? "Quote" : "Invoice"} ·{" "}
                    {overdue ? "Overdue" : d.status.replace(/_/g, " ").toLowerCase()}
                  </span>
                  <p className="mt-1 truncate text-sm font-medium text-[var(--kb-text)]">
                    {d.number}
                    {d.subject ? ` · ${d.subject}` : ""}
                  </p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {when(d.issuedAt)}
                    {d.dueAt ? ` · due ${when(d.dueAt)}` : ""}
                    {d.paidCents > 0 && d.outstandingCents > 0 ? ` · ${money(d.paidCents)} received` : ""}
                  </p>
                </div>
                <span className="text-right">
                  <span className="block font-semibold text-[var(--kb-text)]">{money(d.amountCents)}</span>
                  {d.outstandingCents > 0 && d.outstandingCents !== d.amountCents && (
                    <span className="block text-xs text-[var(--kb-text-dim)]">{money(d.outstandingCents)} still owing</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
        {documents.length === 0 && <li className="p-4 text-sm text-[var(--kb-text-dim)]">Nothing here yet.</li>}
      </ul>

      {agreements.filter((a) => a.status !== "SENT").length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-[var(--kb-text)]">Agreements</h2>
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)] p-0">
            {agreements
              .filter((a) => a.status !== "SENT")
              .map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/portal/${token}/agreements/${a.id}`}
                    className="flex items-center justify-between gap-3 p-4 hover:bg-black/[0.02]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--kb-text)]">
                        {a.number} · {a.title}
                      </p>
                      <p className="text-xs text-[var(--kb-text-dim)]">
                        {when(a.createdAt)}
                        {a.valueCents !== null ? ` · ${money(a.valueCents)}` : ""}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: "var(--kb-tint-mint)", color: "var(--kb-tint-mint-ink)" }}
                    >
                      {a.status.toLowerCase()}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </>
      )}

      {deliveries.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-[var(--kb-text)]">Deliveries</h2>
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)] p-0">
            {deliveries.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--kb-text)]">{d.number}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {d.lines} {d.lines === 1 ? "item" : "items"} ·{" "}
                    {d.deliveredAt ? `delivered ${when(d.deliveredAt)}` : `sent ${when(d.createdAt)}`}
                  </p>
                </div>
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: "var(--kb-tint-mint)", color: "var(--kb-tint-mint-ink)" }}
                >
                  {d.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div id="send" />
      <PortalActions
        token={token}
        initial={openTab === "ask" ? "ask" : openTab === "details" ? "details" : "paid"}
        documents={documents.map((d) => ({ id: d.id, label: `${d.number} · ${money(d.amountCents)}` }))}
        party={party}
        businessName={business.name}
        paymentProofAction={paymentProofAction}
        messageAction={messageAction}
        detailsAction={detailsAction}
      />

      {openSubmissions.length > 0 && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">Waiting on {business.name}</h2>
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)] p-0">
            {openSubmissions.map((s) => (
              <li key={s.id} className="p-4">
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {KIND_LABEL[s.kind] ?? s.kind} · sent {when(s.createdAt)}
                </p>
                {s.body && <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--kb-text)]">{s.body}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-center text-[11px] text-[var(--kb-text-dim)]">
        This link is yours. Anyone with it can see your documents, so keep it to yourself.
      </p>
    </main>
  );
}
