// One proposal or contract: the words, the terms, and what state it is in.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { getAgreement, signatureStillMatches } from "@/lib/core/agreements";
import { signingCertificate } from "@/lib/core/signing";
import { getOrCreatePortalToken } from "@/lib/core/parties";
import { prisma } from "@/lib/db";
import { currencySymbol, formatMoney } from "@/lib/format/money";
import { PageHeader } from "../../PageHeader";
import { ClauseEditor } from "./ClauseEditor";
import { deleteAgreementAction, reviseAgreementAction, saveAgreementAction, sendAgreementAction } from "../actions";
import { baseUrl } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

const KINDS = [
  ["PROPOSAL", "Proposal"],
  ["SERVICE", "Service agreement"],
  ["RETAINER", "Maintenance / retainer"],
  ["SUPPLY", "Supply agreement"],
  ["NDA", "Non-disclosure agreement"],
  ["SUBCONTRACT", "Sub-contract"],
  ["OTHER", "Other"],
] as const;

const RECURRENCE = [
  ["once", "Once off"],
  ["monthly", "A month"],
  ["quarterly", "A quarter"],
  ["annually", "A year"],
] as const;

function forInput(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function AgreementPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string; agreementId: string }>;
  searchParams: Promise<{ drafted?: string }>;
}) {
  const { tenantId, agreementId } = await params;
  const { drafted } = await searchParams;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const agreement = await getAgreement(tenantId, agreementId);
  if (!agreement) notFound();

  const [tenant, portalToken, certificate] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    agreement.party.portalToken ?? getOrCreatePortalToken(agreement.partyId),
    signingCertificate({ tenantId, kind: "agreement", documentId: agreementId }),
  ]);
  const currency = agreement.currency ?? tenant?.currency ?? "ZAR";
  const signed = agreement.status === "SIGNED";
  const intact = signatureStillMatches(agreement);
  const base = await baseUrl();
  const signingUrl = `${base}/portal/${portalToken}/agreements/${agreement.id}`;

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title={`${agreement.number} · ${agreement.title}`}
        crumbs={[{ label: "Proposals & contracts", href: `/dashboard/${tenantId}/agreements` }, { label: agreement.number }]}
        actions={
          <span className="flex flex-wrap gap-1">
            <a href={`/dashboard/${tenantId}/agreements/${agreement.id}/pdf`} target="_blank" className="kb-pill kb-pill-ghost text-xs">
              PDF
            </a>
            <a href={`/dashboard/${tenantId}/agreements/${agreement.id}/word`} className="kb-pill kb-pill-ghost text-xs">
              Word
            </a>
            {agreement.status === "DRAFT" && (
              <form action={sendAgreementAction.bind(null, tenantId, agreement.id)}>
                <button type="submit" className="kb-pill kb-pill-primary text-xs">
                  Send for signature
                </button>
              </form>
            )}
            {signed && (
              <form action={reviseAgreementAction.bind(null, tenantId, agreement.id)}>
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                  Start a revision
                </button>
              </form>
            )}
            {agreement.status === "DRAFT" && (
              <form action={deleteAgreementAction.bind(null, tenantId, agreement.id)}>
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                  Delete
                </button>
              </form>
            )}
          </span>
        }
      />

      {drafted === "0" && (
        <p className="kb-card mb-4 px-5 py-3 text-sm text-[var(--kb-text)]" style={{ background: "var(--kb-tint-yellow)" }}>
          Nothing is configured to draft with, so this started from the template instead. The words are yours to change.
        </p>
      )}

      {signed && (
        <div className="kb-card mb-4 px-5 py-4" style={{ background: "var(--kb-tint-mint)" }}>
          <p className="text-sm font-medium text-[var(--kb-text)]">
            Signed by {agreement.signerName} on {agreement.signedAt?.toLocaleDateString()}
            {agreement.signerIp ? ` from ${agreement.signerIp}` : ""}.
          </p>
          {agreement.signatureDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agreement.signatureDataUrl}
              alt="Their signature"
              className="mt-2 h-20 rounded-lg border border-[var(--kb-panel-border)] bg-white"
            />
          )}
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
            {intact === false
              ? "The wording no longer matches what was signed — this document has been changed since."
              : "The wording still matches what was signed."}
          </p>
        </div>
      )}

      {certificate && certificate.history.length > 0 && (
        <details className="kb-card mb-4 px-5 py-4">
          <summary className="cursor-pointer text-sm font-medium text-[var(--kb-text)]">
            The signing record
          </summary>
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
            What happened to this document, and when. The page at the back of every e-signature product — the one that
            matters eighteen months from now.
          </p>
          <ol className="mt-3 grid gap-2">
            {certificate.history.map((line, index) => (
              <li key={`${line.at.toISOString()}-${index}`} className="text-xs text-[var(--kb-text-dim)]">
                <span className="text-[var(--kb-text)]">{line.what}</span>
                {" · "}
                {line.at.toLocaleString()}
                {line.where ? ` · from ${line.where}` : ""}
                {line.device ? ` · ${line.device}` : ""}
              </li>
            ))}
          </ol>
          <ul className="mt-3 grid gap-1 text-[11px] text-[var(--kb-text-dim)]">
            {certificate.standing.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}

      {agreement.status === "SENT" && (
        <div className="kb-card mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="text-sm text-[var(--kb-text)]">
            Waiting on {agreement.party.companyName ?? agreement.party.name} to sign. Send them this link:
          </p>
          <code className="truncate rounded-lg bg-black/5 px-3 py-1 text-xs">{signingUrl}</code>
          {agreement.party.phone && (
            <a
              href={`https://wa.me/${agreement.party.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                `Hi ${agreement.party.name}, here is the ${agreement.title.toLowerCase()} to read and sign: ${signingUrl}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="kb-pill kb-pill-primary text-xs"
            >
              Send on WhatsApp
            </a>
          )}
        </div>
      )}

      <form action={saveAgreementAction.bind(null, tenantId, agreement.id)} className="kb-card p-5">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-[var(--kb-text-dim)] sm:col-span-2">
            Title
            <input name="title" defaultValue={agreement.title} disabled={signed} className="kb-input mt-1 w-full text-sm" />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            What kind
            <select name="kind" defaultValue={agreement.kind} disabled={signed} className="kb-input mt-1 w-full text-sm">
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Value ({currencySymbol(currency)})
            <input
              name="value"
              inputMode="decimal"
              defaultValue={agreement.valueCents === null ? "" : (agreement.valueCents / 100).toFixed(2)}
              disabled={signed}
              className="kb-input mt-1 w-full text-sm"
            />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            How often
            <select name="recurrence" defaultValue={agreement.recurrence ?? "once"} disabled={signed} className="kb-input mt-1 w-full text-sm">
              {RECURRENCE.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Who signs for you
            <input
              name="ourSignerName"
              defaultValue={agreement.ourSignerName ?? ""}
              disabled={signed}
              placeholder="Name on the signature line"
              className="kb-input mt-1 w-full text-sm"
            />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Starts
            <input type="date" name="startsAt" defaultValue={forInput(agreement.startsAt)} disabled={signed} className="kb-input mt-1 w-full text-sm" />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Ends
            <input type="date" name="endsAt" defaultValue={forInput(agreement.endsAt)} disabled={signed} className="kb-input mt-1 w-full text-sm" />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Valid until
            <input type="date" name="validUntil" defaultValue={forInput(agreement.validUntil)} disabled={signed} className="kb-input mt-1 w-full text-sm" />
          </label>
        </div>

        <p className="mt-4 text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
          The document — with{" "}
          <Link href={`/dashboard/${tenantId}/customers/${agreement.partyId}`} className="underline">
            {agreement.party.companyName ?? agreement.party.name}
          </Link>
          {agreement.valueCents !== null ? ` · ${formatMoney(agreement.valueCents, currency, { decimals: true })}` : ""}
        </p>
        <ClauseEditor clauses={agreement.clauseList} readOnly={signed} />
      </form>

      {signed && (
        <p className="mt-3 text-xs text-[var(--kb-text-dim)]">
          A signed document is the record of what was agreed, so it cannot be edited. Start a revision to make the next
          version — the signed one stays exactly as it was.
        </p>
      )}
    </div>
  );
}
