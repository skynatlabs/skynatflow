// Proposals and contracts — the documents a deal is actually made on.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { agreementPipeline, AGREEMENT_TEMPLATES, listAgreements } from "@/lib/core/agreements";
import { currencySymbol, formatMoney } from "@/lib/format/money";
import { getAiModel } from "@/lib/ai/model";
import { PageHeader } from "../PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { NewAgreement } from "./NewAgreement";
import { createAgreementAction, draftAgreementAction } from "./actions";

export const dynamic = "force-dynamic";

const TONE: Record<string, { label: string; bg: string; ink: string }> = {
  DRAFT: { label: "draft", bg: "var(--kb-panel)", ink: "var(--kb-text-dim)" },
  SENT: { label: "waiting on them", bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  SIGNED: { label: "signed", bg: "var(--kb-tint-mint)", ink: "var(--kb-tint-mint-ink)" },
  DECLINED: { label: "declined", bg: "var(--kb-status-danger)", ink: "var(--kb-status-danger-ink)" },
  EXPIRED: { label: "expired", bg: "var(--kb-panel)", ink: "var(--kb-text-dim)" },
};

const KIND_LABEL: Record<string, string> = {
  PROPOSAL: "Proposal",
  SERVICE: "Service agreement",
  RETAINER: "Maintenance",
  SUPPLY: "Supply agreement",
  NDA: "NDA",
  SUBCONTRACT: "Sub-contract",
  OTHER: "Agreement",
};

export default async function AgreementsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [agreements, parties, tenant, pipeline, model] = await Promise.all([
    listAgreements(tenantId),
    prisma.party.findMany({
      where: { tenantId, role: { in: ["CUSTOMER", "SUPPLIER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, companyName: true },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    agreementPipeline(tenantId),
    getAiModel(),
  ]);
  const currency = tenant?.currency ?? "ZAR";
  const money = (c: number) => formatMoney(c, currency);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Proposals & contracts" crumbs={[{ label: "Proposals & contracts" }]} />

      <p className="-mt-2 mb-5 max-w-prose text-sm text-[var(--kb-text-dim)]">
        A quote is a price. This is the document that wins the work and settles the argument eighteen months later — what
        is being done, by when, what it costs, and what happens when it goes wrong. Written here, signed by the customer
        on the same link they already have, and kept where you can see which ones are actually signed.
      </p>

      {(pipeline.awaitingSignature > 0 || pipeline.signed > 0) && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="kb-card px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">Waiting on a signature</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--kb-text)]">{pipeline.awaitingSignature}</p>
            {pipeline.awaitingValueCents > 0 && (
              <p className="text-xs text-[var(--kb-text-dim)]">{money(pipeline.awaitingValueCents)} on the table</p>
            )}
          </div>
          <div className="kb-card px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">Signed</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--kb-text)]">{pipeline.signed}</p>
            {pipeline.signedValueCents > 0 && (
              <p className="text-xs text-[var(--kb-text-dim)]">{money(pipeline.signedValueCents)} committed</p>
            )}
          </div>
          <div className="kb-card px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">Still drafts</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--kb-text)]">{pipeline.drafts}</p>
            <p className="text-xs text-[var(--kb-text-dim)]">Nobody has seen these yet</p>
          </div>
        </div>
      )}

      <NewAgreement
        tenantId={tenantId}
        parties={parties}
        templates={AGREEMENT_TEMPLATES.map((t) => ({
          key: t.key,
          label: t.label,
          purpose: t.purpose,
          wantsValue: t.wantsValue,
          wantsTerm: t.wantsTerm,
        }))}
        currencySymbol={currencySymbol(currency)}
        aiAvailable={Boolean(model)}
        createAction={createAgreementAction.bind(null, tenantId)}
        draftAction={draftAgreementAction.bind(null, tenantId)}
      />

      <section className="mt-6">
        {agreements.length === 0 ? (
          <EmptyState
            title="No proposals or contracts yet"
            purpose="The document a deal is made on, written from a template or from a sentence, and signed online."
            needs="A customer on file, and a minute."
          />
        ) : (
          <ul className="kb-card divide-y divide-[var(--kb-panel-border)]">
            {agreements.map((a) => {
              const tone = TONE[a.status];
              return (
                <li key={a.id}>
                  <Link
                    href={`/dashboard/${tenantId}/agreements/${a.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-black/[0.02]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--kb-text)]">
                        {a.number} · {a.title}
                      </p>
                      <p className="text-xs text-[var(--kb-text-dim)]">
                        {KIND_LABEL[a.kind] ?? a.kind} · {a.party.companyName ?? a.party.name} ·{" "}
                        {a.createdAt.toLocaleDateString()}
                        {a.signedAt ? ` · signed ${a.signedAt.toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      {a.valueCents !== null && (
                        <span className="text-sm font-semibold text-[var(--kb-text)]">{money(a.valueCents)}</span>
                      )}
                      <span className="kb-pill text-[10px]" style={{ background: tone.bg, color: tone.ink }}>
                        {tone.label}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
