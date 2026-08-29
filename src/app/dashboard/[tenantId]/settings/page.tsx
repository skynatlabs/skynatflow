// Unified settings index — every settings sub-page in one place, grouped
// by what it configures, instead of separate dashboard routes with no
// common entry point. Modeled on the single-settings-screen pattern most
// invoicing tools use (one left rail, everything reachable from it).

import Link from "next/link";

const GROUPS: {
  heading: string;
  items: { href: string; label: string; description: string }[];
}[] = [
  {
    heading: "Money",
    items: [
      { href: "pdf-templates", label: "PDF templates", description: "Pick and customize your quote/invoice/delivery-slip designs." },
      { href: "payment-gateways", label: "Payment gateways", description: "Let customers pay invoices online by card." },
      { href: "pos-integrations", label: "POS & card terminal", description: "Connect an in-person card provider for your till." },
      { href: "ecommerce", label: "Ecommerce", description: "Connect WooCommerce — sync products, auto-invoice new orders." },
      { href: "automation", label: "Follow-ups & automation", description: "Cadence, auto-respond, and auto-follow-up rules." },
      { href: "templates", label: "Proposal templates", description: "Reusable intro/scope-of-work text for proposal quotes." },
    ],
  },
  {
    heading: "Communication",
    items: [
      { href: "mail", label: "Mail accounts", description: "Connect IMAP or use your flow-hosted inbound address." },
      { href: "booking", label: "Booking & scheduling", description: "Appointment and booking preferences." },
    ],
  },
  {
    heading: "Data",
    items: [
      { href: "import", label: "Import", description: "Bring in customers, products, quotes, or invoices from a CSV." },
      { href: "export", label: "Export", description: "Download your data." },
      { href: "backup", label: "Document backup", description: "Back up generated documents to Google Drive." },
    ],
  },
  {
    heading: "Account",
    items: [
      { href: "audit-log", label: "Audit log", description: "Every sensitive action taken on this workspace, by who and when." },
    ],
  },
];

export default async function SettingsIndexPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Settings</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Everything that configures how this workspace runs, in one place.
      </p>

      <div className="mt-8 space-y-8">
        {GROUPS.map((group) => (
          <section key={group.heading}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
              {group.heading}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={`/dashboard/${tenantId}/settings/${item.href}`}
                  className="kb-card block p-4 transition hover:bg-black/[0.02]"
                >
                  <p className="font-medium text-[var(--kb-text)]">{item.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{item.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
