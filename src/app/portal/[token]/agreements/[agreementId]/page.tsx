// A proposal or contract, on the customer's side.
//
// The whole document, readable on a phone, and a signature block at the
// bottom. Nothing about it takes an id from the request: the token resolves
// to a party, and an agreement that does not belong to that party is not
// found rather than refused, so a stranger with a guessed id learns nothing.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolvePortal } from "@/lib/core/portal";
import { parseClauses } from "@/lib/core/agreements";
import { formatMoney } from "@/lib/format/money";
import { SignAgreement } from "./SignAgreement";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  PROPOSAL: "Proposal",
  SERVICE: "Service agreement",
  RETAINER: "Maintenance agreement",
  SUPPLY: "Supply agreement",
  NDA: "Non-disclosure agreement",
  SUBCONTRACT: "Sub-contract",
  OTHER: "Agreement",
};

function when(d: Date | null) {
  return d ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : null;
}

export default async function PortalAgreementPage({
  params,
}: {
  params: Promise<{ token: string; agreementId: string }>;
}) {
  const { token, agreementId } = await params;
  const party = await resolvePortal(token);
  if (!party) notFound();

  const agreement = await prisma.agreement.findFirst({
    where: { id: agreementId, partyId: party.id },
    include: { tenant: { select: { name: true, currency: true, businessEmail: true, businessPhone: true } } },
  });
  // A draft has not been sent to anybody, so on this side it does not exist.
  if (!agreement || agreement.status === "DRAFT") notFound();

  const clauses = parseClauses(agreement.clauses);
  const currency = agreement.currency ?? agreement.tenant.currency;
  const per =
    agreement.recurrence === "monthly"
      ? " a month"
      : agreement.recurrence === "quarterly"
        ? " a quarter"
        : agreement.recurrence === "annually"
          ? " a year"
          : "";

  const terms = [
    agreement.valueCents !== null ? ["Value", `${formatMoney(agreement.valueCents, currency, { decimals: true })}${per}`] : null,
    when(agreement.startsAt) ? ["Starts", when(agreement.startsAt)!] : null,
    when(agreement.endsAt) ? ["Ends", when(agreement.endsAt)!] : null,
    when(agreement.validUntil) ? ["Valid until", when(agreement.validUntil)!] : null,
  ].filter(Boolean) as string[][];

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16 sm:p-8">
      <Link href={`/portal/${token}`} className="text-xs text-[var(--kb-text-dim)]">
        &larr; All your documents
      </Link>

      <div className="kb-card mt-2 p-6">
        <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
          {KIND_LABEL[agreement.kind] ?? "Agreement"} · {agreement.number}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-[var(--kb-text)]">{agreement.title}</h1>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Between {agreement.tenant.name} and {party.companyName ?? party.name} · {when(agreement.createdAt)}
        </p>

        {terms.length > 0 && (
          <dl className="mt-4 rounded-xl p-3 text-sm" style={{ background: "var(--kb-tint-blue)" }}>
            {terms.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-[var(--kb-text-dim)]">{label}</dt>
                <dd className="text-[var(--kb-text)]">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <ol className="mt-5 space-y-4">
          {clauses.map((c, i) => (
            <li key={`${i}-${c.heading}`}>
              <h2 className="text-sm font-semibold text-[var(--kb-text)]">
                {i + 1}. {c.heading}
              </h2>
              <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--kb-text)]">{c.body}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="kb-card mt-4 p-6">
        {agreement.status === "SIGNED" ? (
          <>
            <p className="text-sm font-semibold" style={{ color: "var(--kb-tint-mint-ink)" }}>
              ✓ Signed by {agreement.signerName} on {when(agreement.signedAt)}
            </p>
            {agreement.signatureDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agreement.signatureDataUrl}
                alt="Your signature"
                className="mt-3 h-24 rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)]"
              />
            )}
            {agreement.acceptanceHash && (
              <div className="mt-3 rounded-lg bg-black/5 px-3 py-2 text-[10px] leading-relaxed text-[var(--kb-text-dim)]">
                <p>Signed record — this acceptance is bound to a verification hash.</p>
                <p className="mt-0.5 font-mono break-all">{agreement.acceptanceHash}</p>
              </div>
            )}
          </>
        ) : agreement.status === "DECLINED" ? (
          <p className="text-sm font-semibold" style={{ color: "var(--kb-status-danger-ink)" }}>
            You said you are not signing this. {agreement.tenant.name} has been told.
          </p>
        ) : agreement.status === "EXPIRED" ? (
          <p className="text-sm text-[var(--kb-text)]">
            This expired on {when(agreement.validUntil)}. Ask {agreement.tenant.name} for a fresh one if you still want it.
          </p>
        ) : (
          <SignAgreement token={token} agreementId={agreement.id} defaultName={party.name} />
        )}
      </div>

      {(agreement.tenant.businessPhone || agreement.tenant.businessEmail) && (
        <p className="mt-4 text-center text-xs text-[var(--kb-text-dim)]">
          Questions before you sign?{" "}
          <Link href={`/portal/${token}?do=ask#send`} className="underline">
            Ask {agreement.tenant.name}
          </Link>
          .
        </p>
      )}
    </main>
  );
}
