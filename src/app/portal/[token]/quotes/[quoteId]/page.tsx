// Quote view + e-signature acceptance — Soler's proven quote-signing UX,
// generalized onto the shared Transaction model. Every load of this page
// by the customer is also a tracked "open" (strategic report's hot-lead
// pattern) — this is a real buying signal the owner should see.

import { notFound } from "next/navigation";
import Link from "next/link";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { trackQuoteOpen, prisma } from "@/lib/core/money";
import { maybeAlertHotLead } from "@/lib/core/notifications";
import { SignatureCapture } from "./SignatureCapture";
import { raiseDisputeAction } from "./actions";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function PortalQuotePage({
  params,
}: {
  params: Promise<{ token: string; quoteId: string }>;
}) {
  const { token, quoteId } = await params;
  const party = await findPartyByPortalToken(token);
  if (!party) notFound();

  const quote = await prisma.transaction.findUnique({
    where: { id: quoteId },
    include: {
      itemLines: { include: { item: true } },
      tenant: true,
      salesPersonMembership: { include: { user: true } },
    },
  });
  if (!quote || quote.partyId !== party.id || quote.type !== "QUOTE") notFound();

  // Track this view, then check whether it just crossed the hot-lead
  // threshold — same "fire once, on open #2" behavior as Soler's alert.
  await trackQuoteOpen(quoteId);
  await maybeAlertHotLead(quoteId);

  const openDispute = await prisma.dispute.findFirst({
    where: { transactionId: quoteId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });

  const isDecided = quote.status === "ACCEPTED" || quote.status === "DECLINED";

  return (
    <div className="kb-shell min-h-screen p-8" data-theme="light">
      <main className="mx-auto max-w-lg">
        <Link href={`/portal/${token}`} className="text-xs text-[var(--kb-text-dim)]">
          &larr; Back
        </Link>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">{quote.tenant.name}</p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kb-text)]">
              {quote.quoteKind === "PROPOSAL" ? "Proposal" : "Quote"} for {party.name}
            </h1>
            {quote.subject && <p className="mt-0.5 text-sm text-[var(--kb-text-dim)]">{quote.subject}</p>}
            {quote.poNumber && <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">PO #: {quote.poNumber}</p>}
          </div>
          <a
            href={`/portal/${token}/quotes/${quoteId}/pdf`}
            className="kb-pill shrink-0 text-xs"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download PDF
          </a>
        </div>

        {quote.quoteKind === "PROPOSAL" && (quote.introText || quote.scopeOfWork) && (
          <div className="kb-card mt-4 space-y-4 p-6">
            {quote.introText && (
              <p className="whitespace-pre-wrap text-sm text-[var(--kb-text)]">{quote.introText}</p>
            )}
            {quote.scopeOfWork && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
                  Scope of work
                </h2>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-[var(--kb-text)]">
                  {quote.scopeOfWork}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="kb-card mt-6 p-6">
          <ul className="divide-y divide-[var(--kb-panel-border)]">
            {quote.itemLines.map((l) => (
              <li key={l.id} className="flex justify-between py-2 text-sm">
                <span className="text-[var(--kb-text)]">
                  {l.quantity} &times; {l.item.name}
                </span>
                <span className="text-[var(--kb-text)]">{money(l.quantity * l.unitPriceCents)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-[var(--kb-panel-border)] pt-3">
            <span className="font-semibold text-[var(--kb-text)]">Total</span>
            <span className="font-bold text-[var(--kb-text)]">{money(quote.amountCents)}</span>
          </div>
        </div>

        <div className="kb-card mt-4 p-6">
          {quote.status === "ACCEPTED" ? (
            <div>
              <p className="text-sm font-semibold text-[var(--kb-tint-mint-ink)]">
                ✓ Accepted{quote.respondedAt ? ` on ${quote.respondedAt.toLocaleDateString()}` : ""}
              </p>
              {quote.signatureDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={quote.signatureDataUrl}
                  alt="Your signature"
                  className="mt-3 h-24 rounded-lg border border-[var(--kb-panel-border)] bg-white"
                />
              )}
              {quote.acceptanceHash && (
                <div className="mt-3 rounded-lg bg-black/5 px-3 py-2 text-[10px] leading-relaxed text-[var(--kb-text-dim)]">
                  <p>Signed record — this acceptance is bound to a verification hash.</p>
                  <p className="mt-0.5 font-mono break-all">{quote.acceptanceHash}</p>
                  {quote.acceptanceIp && <p className="mt-0.5">From {quote.acceptanceIp}</p>}
                </div>
              )}
            </div>
          ) : quote.status === "DECLINED" ? (
            <p className="text-sm font-semibold text-[var(--kb-tint-peach-ink)]">
              You declined this quote.
            </p>
          ) : (
            <SignatureCapture token={token} quoteId={quoteId} />
          )}
        </div>

        {quote.salesPersonMembership && (
          <p className="mt-3 text-xs text-[var(--kb-text-dim)]">
            Prepared by {quote.salesPersonMembership.user.name ?? quote.salesPersonMembership.user.email}
            {quote.salesPersonMembership.user.email && ` · ${quote.salesPersonMembership.user.email}`}
            {quote.salesPersonMembership.user.phone && ` · ${quote.salesPersonMembership.user.phone}`}
          </p>
        )}

        {!isDecided && (
          <p className="mt-3 text-xs text-[var(--kb-text-dim)]">
            Questions? Reply on WhatsApp and {quote.tenant.name} will get back to you.
          </p>
        )}

        {quote.tenant.whatsappVerifyNumber && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2">
            <p className="text-xs text-amber-800">
              Not sure this quote is genuine? Message{" "}
              <a
                href={`https://wa.me/${quote.tenant.whatsappVerifyNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                  `Hi, I'd like to verify a quote from ${quote.tenant.name}.`
                )}`}
                target="_blank"
                className="font-semibold underline"
              >
                {quote.tenant.name} on WhatsApp
              </a>{" "}
              to confirm before accepting.
            </p>
          </div>
        )}

        <div className="kb-card mt-4 p-6">
          {openDispute ? (
            <div>
              <p className="text-sm font-semibold text-[var(--kb-tint-peach-ink)]">
                Your report is with {quote.tenant.name}
              </p>
              <p className="mt-1 text-xs text-[var(--kb-text-dim)]">&ldquo;{openDispute.message}&rdquo;</p>
              <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                Sent {openDispute.createdAt.toLocaleDateString()} — they&apos;ll follow up with you.
              </p>
            </div>
          ) : (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-[var(--kb-text-dim)]">
                Something not right with this {quote.quoteKind === "PROPOSAL" ? "proposal" : "quote"}?
              </summary>
              <form action={raiseDisputeAction} className="mt-3">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="quoteId" value={quoteId} />
                <textarea
                  name="message"
                  required
                  rows={2}
                  placeholder="Tell us what's wrong — wrong price, wrong item, anything."
                  className="w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2 text-sm text-[var(--kb-text)]"
                />
                <button type="submit" className="kb-pill mt-2 text-xs">
                  Send report
                </button>
              </form>
            </details>
          )}
        </div>
      </main>
    </div>
  );
}
