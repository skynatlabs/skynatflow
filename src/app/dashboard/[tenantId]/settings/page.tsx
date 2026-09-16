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
      { href: "calendar", label: "Calendar sync", description: "Connect Google Calendar so reminders show up there too." },
      { href: "apps", label: "On your phone", description: "Notifications, putting it on the home screen, and field mode." },
    ],
  },
  {
    heading: "Data",
    items: [
      { href: "../setup", label: "Bring things in", description: "Documents, spreadsheets and photographs, read into your workspace." },
      { href: "import", label: "Import", description: "Bring in customers, products, quotes, or invoices from a CSV." },
      { href: "developer", label: "API & webhooks", description: "Keys for reading and writing your data, and event notifications for other systems." },
      { href: "bookkeeper", label: "For your bookkeeper", description: "The books in Xero, QuickBooks, Sage or spreadsheet shape — so your accountant can carry on as they are." },
      { href: "document-copies", label: "A copy in your own drive", description: "Every document also written into your own Google Drive, OneDrive or Dropbox." },
    ],
  },
  {
    heading: "What customers see",
    items: [
      { href: "brand", label: "Logo, colour and your own address", description: "Your branding on documents and the portal, and the forms you can put on your own website." },
      { href: "appearance", label: "Appearance", description: "How the workspace itself looks to you and your staff." },
    ],
  },
  {
    heading: "Account",
    items: [
      { href: "banking", label: "Banking & verification", description: "EFT details and your WhatsApp verify number — owner-only." },
      { href: "audit-log", label: "Audit log", description: "Every sensitive action taken on this workspace, by who and when." },
      { href: "usage", label: "This month's usage", description: "What has been used of the month's allowances. Work you ask for is never stopped by it." },
      { href: "data-protection", label: "Data protection", description: "What you hold about people, why, and for how long — the record POPIA and the GDPR both ask for." },
      { href: "close-account", label: "Close this account", description: "Take a copy of your records and remove the business — owner-only, and it cannot be undone." },
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
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
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
