// A piece of this, on their own website.
//
// Almost every small business already has a website somebody else built —
// Wix, WordPress, a cousin's Squarespace — and they are not moving it. What
// they want is the booking form or the quote request on that site, feeding
// into here, without a developer.
//
// So: a one-line snippet that drops an iframe onto any page. An iframe rather
// than injected markup, because injected markup inherits whatever CSS the
// site has and arrives looking broken, and because a form that collects a
// customer's details should not be sharing a JavaScript context with a
// fifteen-plugin WordPress install.
//
// The snippet is generated rather than documented: nobody hand-edits an
// embed code correctly, and a wrong tenant id in a copied snippet is a form
// silently posting into somebody else's workspace.

import { prisma } from "@/lib/db";
import { getBookingConfig } from "./booking";

export type WidgetKind = "booking" | "enquiry" | "quote-request" | "pay";

export interface WidgetDef {
  kind: WidgetKind;
  label: string;
  /** What it does, for somebody deciding which one they want. */
  purpose: string;
  /** A starting height. The frame tells the host page its real height once loaded. */
  height: number;
  /** What it needs before it will work at all. */
  requires?: string;
}

export const WIDGETS: WidgetDef[] = [
  {
    kind: "booking",
    label: "Book an appointment",
    purpose: "Shows your open slots and takes a booking straight into the diary.",
    height: 640,
    requires: "Working hours and at least one bookable service.",
  },
  {
    kind: "enquiry",
    label: "Enquiry form",
    purpose: "Name, contact and a message. Creates the customer and starts a conversation.",
    height: 520,
  },
  {
    kind: "quote-request",
    label: "Request a quote",
    purpose: "An enquiry with what they want priced, so a quote can be drafted from it.",
    height: 600,
  },
  {
    kind: "pay",
    label: "Pay an invoice",
    purpose: "A customer types their invoice number and pays it. Useful on a Contact page.",
    height: 420,
    requires: "A connected payment provider.",
  },
];

export const WIDGET_BY_KIND: Record<string, WidgetDef> = Object.fromEntries(WIDGETS.map((w) => [w.kind, w]));

/**
 * The snippet.
 *
 * Deliberately not a script tag that writes the iframe for them. A plain
 * iframe works in every website builder's HTML block, survives being pasted
 * into a page editor that strips scripts, and is something the business owner
 * can look at and understand. The loader script exists as well for sites that
 * want the frame to resize itself, and is offered second.
 */
export function snippetFor(params: { origin: string; tenantId: string; kind: WidgetKind; slug?: string }): { plain: string; resizing: string } {
  const def = WIDGET_BY_KIND[params.kind];
  const height = def?.height ?? 600;
  const src = embedUrl(params);
  const title = def?.label ?? "Form";

  const plain = `<iframe src="${src}" title="${title}" style="width:100%;max-width:640px;height:${height}px;border:0" loading="lazy"></iframe>`;

  const resizing =
    `<div data-skynat-embed="${params.kind}" data-workspace="${params.tenantId}"${params.slug ? ` data-form="${params.slug}"` : ""}></div>\n` +
    `<script src="${params.origin}/embed.js" async></script>`;

  return { plain, resizing };
}

export function embedUrl(params: { origin: string; tenantId: string; kind: WidgetKind; slug?: string }): string {
  const base = `${params.origin}/embed/${params.tenantId}/${params.kind}`;
  return params.slug ? `${base}?form=${encodeURIComponent(params.slug)}` : base;
}

/**
 * Is this widget actually going to work if somebody pastes it in today?
 *
 * A snippet that renders an empty box because no services are set up is worse
 * than no snippet — the owner puts it on their website and finds out from a
 * customer. So each one is checked before it is offered.
 */
export async function widgetReadiness(tenantId: string) {
  const [forms, gateways, tenant] = await Promise.all([
    prisma.leadForm.findMany({ where: { tenantId, isActive: true }, select: { slug: true, title: true } }),
    prisma.paymentGateway.count({ where: { tenantId, isActive: true } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { bookingConfig: true } }),
  ]);

  const booking = getBookingConfig(tenant ?? { bookingConfig: null });

  return WIDGETS.map((widget) => {
    if (widget.kind === "booking") {
      return {
        ...widget,
        ready: booking.enabled,
        blocker: booking.enabled ? null : "Bookings are switched off. Turn them on and set your working hours, and this has slots to offer.",
      };
    }
    if (widget.kind === "pay") {
      return {
        ...widget,
        ready: gateways > 0,
        blocker: gateways > 0 ? null : "No payment provider connected, so there is nothing for a customer to pay through.",
      };
    }
    // The enquiry and quote-request widgets need a form to point at, and the
    // first one can be made on the spot — so a missing form is a next step
    // rather than a blocker.
    return {
      ...widget,
      ready: true,
      blocker: null,
      forms: forms.map((f) => ({ slug: f.slug, title: f.title })),
    };
  });
}

/**
 * Which sites are allowed to frame this.
 *
 * Left open by default, because a business that cannot get the form onto
 * their own site has been failed by the product, and the common case is a
 * website builder whose real origin nobody knows. Once a business names their
 * site, it is enforced — an embed that only works on your own domain is worth
 * having, and it is the difference between a form and an open endpoint
 * somebody can farm.
 */
export function framingPolicy(allowed: string[]): string {
  if (allowed.length === 0) return "frame-ancestors *";
  return `frame-ancestors 'self' ${allowed.map((host) => `https://${host}`).join(" ")}`;
}

export function allowedHostsFrom(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((host) => host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((host) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host));
}
