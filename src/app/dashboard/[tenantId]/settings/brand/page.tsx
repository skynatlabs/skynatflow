// What a customer sees.
//
// One screen for the whole question, because a business owner does not think
// of "logo", "colour", "our own domain" and "the form on our website" as four
// different settings — they think of it as whether the thing looks like them.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { prisma } from "@/lib/db";
import { getBranding, readableOn, WHITE_LABEL_POSTURE } from "@/lib/core/whiteLabel";
import { snippetFor, widgetReadiness } from "@/lib/core/embeds";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { saveBrandingAction, saveDomainAction, saveEmbedHostsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BrandPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const isOwner = can(access.role, "staff:manage");

  if (!isOwner) {
    return (
      <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
        <h1 className="text-xl font-semibold text-[var(--kb-text)]">What customers see</h1>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
          This changes every document the business sends out, so only an owner can set it.
        </p>
      </main>
    );
  }

  const [branding, widgets, tenant] = await Promise.all([
    getBranding(tenantId),
    widgetReadiness(tenantId),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { embedAllowedHosts: true } }),
  ]);

  const origin = process.env.NEXT_PUBLIC_APP_URL || "";
  const accent = branding.accent ?? "#1d4ed8";

  return (
    <main className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">What customers see</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Your logo and colour on quotes, invoices and the customer portal — and the forms you can put on your own website.
      </p>

      {/* ------------------------------------------------------- logo & colour */}
      <section className="kb-card mt-6 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Logo and colour</h2>

        <form action={saveBrandingAction} className="mt-3 grid gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />

          <label className="text-xs text-[var(--kb-text-dim)]">
            Logo address
            <input
              name="logoUrl"
              defaultValue={branding.logoUrl ?? ""}
              placeholder="https://…"
              className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
            />
          </label>

          <label className="text-xs text-[var(--kb-text-dim)]">
            Accent colour
            <div className="mt-1 flex items-center gap-2">
              <input
                name="accent"
                defaultValue={branding.accent ?? ""}
                placeholder="#1d4ed8"
                className="w-40 rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
              />
              <span
                className="rounded-xl px-3 py-2 text-xs font-medium"
                style={{ background: accent, color: readableOn(accent) }}
              >
                Buttons look like this
              </span>
            </div>
          </label>

          <label className="flex items-start gap-2 text-xs text-[var(--kb-text-dim)]">
            <input type="checkbox" name="hidePlatformBranding" defaultChecked={!branding.showsPlatform} className="mt-0.5" />
            <span>
              Take &ldquo;Powered by {branding.platformName}&rdquo; off the pages customers read.
              <span className="block text-[11px]">Part of the reseller arrangement rather than the standard plan.</span>
            </span>
          </label>

          <div>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </div>
        </form>
      </section>

      {/* ------------------------------------------------------------- domain */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Your own address</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Portal and booking links on a domain you own, like portal.yourbusiness.co.za.
        </p>

        <form action={saveDomainAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs text-[var(--kb-text-dim)]">
            Domain
            <input
              name="domain"
              defaultValue={branding.customDomain ?? ""}
              placeholder="portal.yourbusiness.co.za"
              className="mt-1 w-72 max-w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
            />
          </label>
          <SubmitButton pendingText="Saving…">Save</SubmitButton>
        </form>

        {branding.customDomain && (
          <div className="mt-3 rounded-xl border border-[var(--kb-panel-border)] p-3">
            <p className="text-xs text-[var(--kb-text-dim)]">
              {branding.domainVerified
                ? "Verified and serving."
                : "Not verified yet. Add these two records wherever you bought the domain, then come back."}
            </p>
            {!branding.domainVerified && (
              <dl className="mt-2 grid gap-1 font-mono text-[11px] text-[var(--kb-text)]">
                <div>CNAME · {branding.customDomain.split(".")[0]} · cname.vercel-dns.com</div>
                <div>TXT · _skynat.{branding.customDomain} · skynat-verify={tenantId}</div>
              </dl>
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ widgets */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Forms for your website</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Paste one of these into any page on your own site. It works in Wix, WordPress, Squarespace and anything else
          that takes an HTML block.
        </p>

        <ul className="mt-3 grid gap-3">
          {widgets.map((widget) => (
            <li key={widget.kind} className="rounded-xl border border-[var(--kb-panel-border)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-[var(--kb-text)]">{widget.label}</span>
                <span className="text-[11px] text-[var(--kb-text-dim)]">{widget.ready ? "Ready" : "Not ready yet"}</span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{widget.purpose}</p>
              {widget.blocker ? (
                <p className="mt-2 text-xs text-[var(--kb-tint-amber-ink)]">{widget.blocker}</p>
              ) : (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--kb-panel)] p-2 text-[11px] text-[var(--kb-text)]">
                  {snippetFor({ origin, tenantId, kind: widget.kind }).plain}
                </pre>
              )}
            </li>
          ))}
        </ul>

        <form action={saveEmbedHostsAction} className="mt-4 grid gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs text-[var(--kb-text-dim)]">
            Sites allowed to use these forms
            <input
              name="hosts"
              defaultValue={tenant.embedAllowedHosts ?? ""}
              placeholder="yourbusiness.co.za www.yourbusiness.co.za"
              className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
            />
            <span className="mt-1 block text-[11px]">
              Leave this empty and the forms work anywhere, which is what most businesses want while they are getting the
              snippet onto their site. Fill it in once it works, and a copy of your snippet on somebody else&apos;s site
              stops collecting.
            </span>
          </label>
          <div>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </div>
        </form>
      </section>

      {/* ------------------------------------------------------------ posture */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">What is never changed</h2>
        <ul className="mt-2 grid gap-1.5 text-xs text-[var(--kb-text-dim)]">
          {WHITE_LABEL_POSTURE.never.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
