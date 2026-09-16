// Somebody else's name on the front.
//
// Two different businesses want this and they want it for opposite reasons.
// An ordinary business wants the customer-facing pages to look like their
// business rather than like a tool they bought — their logo, their colour, no
// mention of us on the page a customer reads. An agency or a franchise wants
// to resell the whole thing: their brand, their domain, their customers never
// learning our name at all.
//
// The first is table stakes and is free. The second is a real commercial
// arrangement, and the honest position is that it is a paid tier — so the
// gate lives here rather than being scattered through the templates, and the
// screen explains the difference instead of showing a locked padlock.
//
// What the branding never touches: the tax numbers, the bank details and the
// legal entity on an invoice. A white-labelled invoice still has to say who
// is actually being paid, and an agency's logo on somebody else's VAT number
// is not a design choice, it is a misrepresentation.

import { prisma } from "@/lib/db";
import { BRAND } from "@/lib/brand";

export interface Branding {
  businessName: string;
  logoUrl: string | null;
  /** A single hex colour. One, not a palette — a palette is a design system nobody will fill in. */
  accent: string | null;
  /** The domain a customer sees on portal and booking links, when one is set up. */
  customDomain: string | null;
  domainVerified: boolean;
  /** Whether "powered by" appears on customer-facing pages. */
  showsPlatform: boolean;
  /** Where a "powered by" would point if shown. */
  platformName: string;
}

/** A colour we will actually put on a page. Anything else is refused rather than rendered. */
export function normaliseAccent(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  const hex = value.startsWith("#") ? value : `#${value}`;
  if (!/^#[0-9a-f]{6}$/.test(hex)) return null;
  return hex;
}

/**
 * Is this colour dark enough to put white text on?
 *
 * The usual failure of a colour picker is a business choosing bright yellow
 * and every button losing its label. Rather than refusing the colour, the
 * text on it flips.
 */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Rec. 709 luma: green carries most of the perceived brightness, which is
  // why a "dark" green often still needs black text.
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.6 ? "#111111" : "#ffffff";
}

/** A domain we will accept. Not a URL, not a path — a hostname. */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) return null;
  if (value.length > 253) return null;
  return value;
}

export async function getBranding(tenantId: string): Promise<Branding> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      name: true,
      brandLogoUrl: true,
      brandAccent: true,
      brandDomain: true,
      brandDomainVerified: true,
      hidePlatformBranding: true,
    },
  });

  return {
    businessName: tenant.name,
    logoUrl: tenant.brandLogoUrl,
    accent: normaliseAccent(tenant.brandAccent),
    customDomain: tenant.brandDomain,
    domainVerified: tenant.brandDomainVerified,
    showsPlatform: !tenant.hidePlatformBranding,
    platformName: BRAND,
  };
}

export async function setBranding(
  tenantId: string,
  input: { logoUrl?: string | null; accent?: string | null; hidePlatformBranding?: boolean },
) {
  const data: Record<string, unknown> = {};
  if (input.logoUrl !== undefined) data.brandLogoUrl = input.logoUrl || null;
  if (input.accent !== undefined) {
    const accent = normaliseAccent(input.accent);
    if (input.accent && !accent) throw new Error("That is not a colour we can use. It needs to be a six-digit hex value, like #1d4ed8.");
    data.brandAccent = accent;
  }
  if (input.hidePlatformBranding !== undefined) data.hidePlatformBranding = input.hidePlatformBranding;
  return prisma.tenant.update({ where: { id: tenantId }, data });
}

/**
 * Claim a domain.
 *
 * Claiming is not verifying. The record that proves ownership has to appear
 * in the domain's DNS before anything is served from it, and the instructions
 * are given as the exact two lines somebody pastes into their registrar —
 * because "add a CNAME" is where every one of these gets abandoned.
 */
export async function claimDomain(tenantId: string, input: string | null) {
  const domain = normaliseDomain(input);
  if (input && !domain) throw new Error("That does not look like a domain. It should be something like portal.yourbusiness.co.za, with no https:// in front.");

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { brandDomain: domain, brandDomainVerified: false },
  });

  if (!domain) return { domain: null, records: [], note: "Custom domain removed. Links fall back to the standard address." };

  return {
    domain,
    records: [
      { type: "CNAME", name: domain.split(".")[0], value: "cname.vercel-dns.com", why: "Points the address at the servers that answer for it." },
      { type: "TXT", name: `_skynat.${domain}`, value: `skynat-verify=${tenantId}`, why: "Proves the domain belongs to you rather than to somebody who typed it in." },
    ],
    note:
      "Add both records at whoever you bought the domain from, then come back and check. DNS usually takes a few minutes and occasionally a few hours — nothing is broken while you wait, the standard links keep working.",
  };
}

export interface WhiteLabelPosture {
  /** Branding that anybody gets. */
  included: string[];
  /** Branding that is a commercial arrangement. */
  paid: string[];
  /** What is never white-labelled, and why. */
  never: string[];
}

export const WHITE_LABEL_POSTURE: WhiteLabelPosture = {
  included: [
    "Your logo and colour on quotes, invoices, statements and the customer portal.",
    "Emails that come from your own address, with your signature.",
    "Your business name everywhere a customer reads.",
  ],
  paid: [
    "Your own domain on portal and booking links.",
    `Removing "powered by ${BRAND}" from customer-facing pages.`,
    "Reselling workspaces to your own clients under your name.",
  ],
  never: [
    "The tax number, registration number and bank details on an invoice. Those say who is actually being paid, and they are not a design decision.",
    "The account-deletion and data pages, which have to be reachable and have to say who holds the data.",
  ],
};

/**
 * What a customer-facing page should render.
 *
 * One call rather than five reads scattered through templates, so a page
 * cannot accidentally show the platform name on a workspace that has paid
 * for it not to.
 */
export async function brandingForPublicPage(tenantId: string) {
  const branding = await getBranding(tenantId);
  const accent = branding.accent ?? "#1d4ed8";
  return {
    ...branding,
    accent,
    accentText: readableOn(accent),
    footer: branding.showsPlatform ? `Powered by ${BRAND}` : null,
  };
}
