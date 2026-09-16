// The ground every portal page stands on.
//
// The quote and home pages each carried their own shell div, and the invoice
// page carried none — so an invoice opened from an email rendered on the bare
// body while the same customer's other pages did not. One shell here, warm
// wash and all, and each page is just its content.
//
// Light only, deliberately: this is a document a customer is checking against
// a bank app, and a document does not change colour with the device.

import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { resolvePortal } from "@/lib/core/portal";

/**
 * The tab says the business's name, not the platform's. A customer who
 * bookmarks this or has six tabs open is looking for who they owe, and
 * "skynat.ai — Six executives for your business" tells them nothing.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const party = await resolvePortal(token);
  if (!party) return { title: "Not found" };
  const tenant = await prisma.tenant.findUnique({ where: { id: party.tenantId }, select: { name: true } });
  return {
    title: tenant ? `${tenant.name} — your account` : "Your account",
    // A portal link in a search index would be a leak, not a feature.
    robots: { index: false, follow: false },
  };
}

export default function PortalLayout({ children }: LayoutProps<"/portal/[token]">) {
  return (
    <div className="kb-shell kb-warm min-h-screen" data-theme="light">
      {children}
    </div>
  );
}
