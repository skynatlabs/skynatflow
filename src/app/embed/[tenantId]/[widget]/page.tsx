// A widget, running inside somebody else's website.
//
// Same forms as the public pages, with the page chrome removed and the
// business's own colour applied. The one thing it does that a normal page
// does not is tell the host page how tall it is, so the iframe can stop being
// a fixed 600 pixels with a scrollbar in the middle of a marketing site.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBookingConfig, listAvailableSlots } from "@/lib/core/booking";
import { publicForm } from "@/lib/core/leadForms";
import { WIDGET_BY_KIND, allowedHostsFrom } from "@/lib/core/embeds";
import { brandingForPublicPage } from "@/lib/core/whiteLabel";
import { EnquiryForm } from "@/app/enquire/[tenantId]/[slug]/EnquiryForm";
import { submitEnquiryAction } from "@/app/enquire/[tenantId]/[slug]/actions";
import { bookSlotAction } from "@/app/book/[tenantId]/actions";
import { AutoHeight } from "./AutoHeight";
import { PayForm } from "./PayForm";
import { lookUpInvoiceAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  // Never indexed: a widget showing up in search results above the business's
  // own website is an own goal for the business that embedded it.
  return { robots: { index: false, follow: false } };
}

export default async function EmbedWidgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string; widget: string }>;
  searchParams: Promise<{ form?: string; booked?: string }>;
}) {
  const { tenantId, widget } = await params;
  const { form: formSlug, booked } = await searchParams;

  const def = WIDGET_BY_KIND[widget];
  if (!def) notFound();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, bookingConfig: true, embedAllowedHosts: true },
  });
  if (!tenant) notFound();

  const brand = await brandingForPublicPage(tenantId);
  const allowed = allowedHostsFrom(tenant.embedAllowedHosts);

  return (
    <div
      className="kb-shell"
      data-theme="light"
      style={{ ["--kb-accent" as string]: brand.accent, background: "transparent" }}
    >
      <AutoHeight allowedHosts={allowed} />
      <main className="mx-auto max-w-lg p-3">
        {widget === "booking" && <Booking tenant={tenant} booked={booked === "1"} />}
        {(widget === "enquiry" || widget === "quote-request") && (
          <Enquiry tenantId={tenantId} slug={formSlug} businessName={tenant.name} wantsPricing={widget === "quote-request"} />
        )}
        {widget === "pay" && <PayForm tenantId={tenantId} businessName={tenant.name} lookUpAction={lookUpInvoiceAction} />}

        {brand.footer && (
          <p className="mt-4 text-center text-[11px] text-[var(--kb-text-dim)]">{brand.footer}</p>
        )}
      </main>
    </div>
  );
}

async function Booking({ tenant, booked }: { tenant: { id: string; name: string; bookingConfig: unknown }; booked: boolean }) {
  const config = getBookingConfig(tenant);
  if (!config.enabled) {
    return (
      <div className="kb-card p-5 text-sm text-[var(--kb-text-dim)]">
        {tenant.name} is not taking online bookings at the moment.
      </div>
    );
  }

  if (booked) {
    return (
      <div className="kb-card p-5 text-center">
        <p className="text-base font-medium text-[var(--kb-text)]">You are booked.</p>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{tenant.name} will be in touch if anything changes.</p>
      </div>
    );
  }

  const slots = await listAvailableSlots(tenant.id, config);

  return (
    <form action={bookSlotAction} className="kb-card grid gap-3 p-5">
      <input type="hidden" name="tenantId" value={tenant.id} />
      <input type="hidden" name="embed" value="1" />

      <label className="text-xs text-[var(--kb-text-dim)]">
        Pick a time
        <select name="slot" required className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2.5 text-sm text-[var(--kb-text)]">
          <option value="">— choose a slot —</option>
          {slots.map((slot) => (
            <option key={slot.toISOString()} value={slot.toISOString()}>
              {slot.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              {" · "}
              {slot.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </option>
          ))}
        </select>
      </label>

      {slots.length === 0 && (
        <p className="text-xs text-[var(--kb-text-dim)]">No open slots right now. Try again in a day or two.</p>
      )}

      <label className="text-xs text-[var(--kb-text-dim)]">
        Your name
        <input name="name" required className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2.5 text-sm text-[var(--kb-text)]" />
      </label>
      <label className="text-xs text-[var(--kb-text-dim)]">
        Phone
        <input name="phone" required inputMode="tel" className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2.5 text-sm text-[var(--kb-text)]" />
      </label>

      <button type="submit" className="kb-btn-primary mt-1 rounded-xl px-4 py-2.5 text-sm font-medium">
        Book it
      </button>
      <p className="text-center text-[11px] text-[var(--kb-text-dim)]">Your details go to {tenant.name} and nobody else.</p>
    </form>
  );
}

async function Enquiry({
  tenantId,
  slug,
  businessName,
  wantsPricing,
}: {
  tenantId: string;
  slug?: string;
  businessName: string;
  wantsPricing: boolean;
}) {
  // Without a named form, fall back to whichever one the business has — the
  // owner pasting a snippet onto their website should not have to know a slug.
  const chosen = slug ?? (await prisma.leadForm.findFirst({ where: { tenantId, isActive: true }, orderBy: { createdAt: "asc" }, select: { slug: true } }))?.slug;

  const form = chosen ? await publicForm(tenantId, chosen) : null;
  if (!form) {
    return (
      <div className="kb-card p-5 text-sm text-[var(--kb-text-dim)]">
        {businessName} has not set up an enquiry form yet.
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-balance text-[var(--kb-text)]">
        {wantsPricing ? `Ask ${businessName} for a price` : form.title}
      </h1>
      {form.intro && <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{form.intro}</p>}
      <EnquiryForm
        tenantId={tenantId}
        slug={chosen!}
        fields={form.fields}
        businessName={businessName}
        submitAction={submitEnquiryAction}
      />
    </div>
  );
}
