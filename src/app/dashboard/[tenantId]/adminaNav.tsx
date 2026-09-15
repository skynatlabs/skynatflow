// flow's pages, grouped into the Admina rail's categories.
//
// The template ships eight rail icons over ~85 demo pages. This app has 33
// real pages, and the grouping below is by what someone is actually doing —
// money, people, stock, work, team — rather than by the template's own
// Dashboards/Components/Forms split, which is a kitchen-sink demo taxonomy
// and means nothing here.
//
// Which groups appear depends on the niche, exactly as the flat nav did: a
// logistics workspace gets Fuel Logs, a medical one gets Claims.

import type { TwinNavGroup } from "./TwinSidebar";

export function buildAdminaNav(params: {
  tenantId: string;
  skin: string;
  customerLabel: string;
  unread: number;
}): TwinNavGroup[] {
  const { tenantId, skin, customerLabel, unread } = params;
  const d = `/dashboard/${tenantId}`;
  const is = (...s: string[]) => s.includes(skin);

  const groups: TwinNavGroup[] = [
    {
      key: "home",
      label: "Overview",
      icon: <HouseIcon />,
      items: [
        { href: d, label: "Home" },
        { href: `${d}/brief`, label: "The Brief" },
        { href: `${d}/value`, label: "Value" },
        { href: `${d}/agent`, label: "Agent" },
        { href: `${d}/today`, label: "Today" },
        { href: `${d}/this-week`, label: "This Week" },
        { href: `${d}/goals`, label: "Goals" },
        { href: `${d}/compliance`, label: "Compliance" },
      ],
    },
    {
      key: "money",
      label: "Sales & money",
      icon: <TagIcon />,
      items: [
        { href: `${d}/quotes`, label: "Quotes" },
        { href: `${d}/invoices`, label: "Invoices" },
        { href: `${d}/unsent-quotes`, label: "Unsent Quotes" },
        { href: `${d}/overdue`, label: "Overdue" },
        { href: `${d}/pipeline`, label: "Pipeline" },
        { href: `${d}/statements`, label: "Statements" },
        { href: `${d}/cash-forecast`, label: "Cash forecast" },
        { href: `${d}/expenses`, label: "Expenses" },
        { href: `${d}/books`, label: "The books" },
        { href: `${d}/banking`, label: "Bank & reconciliation" },
        { href: `${d}/margins`, label: "Margins & suppliers" },
        { href: `${d}/costs`, label: "Costs" },
        { href: `${d}/savings`, label: "Savings" },
        { href: `${d}/disputes`, label: "Reports" },
      ],
    },
    {
      key: "people",
      label: customerLabel + "s",
      icon: <UsersIcon />,
      items: [
        { href: `${d}/customers`, label: customerLabel + "s" },
        { href: `${d}/inbox`, label: "Inbox", badge: unread || undefined },
        { href: `${d}/messages`, label: "Messages" },
        { href: `${d}/ai-drafts`, label: "AI Drafts" },
        { href: `${d}/connections`, label: "Connections" },
        ...(is("NONPROFIT") ? [{ href: `${d}/members`, label: "Members & Donors" }] : []),
      ],
    },
    {
      key: "stock",
      label: "Products & stock",
      icon: <BagIcon />,
      items: [
        { href: `${d}/products`, label: "Products" },
        { href: `${d}/inventory`, label: "Inventory" },
        ...(is("RETAIL", "WHOLESALE")
          ? [
              { href: `${d}/stocktake`, label: "Stocktake" },
              { href: `${d}/purchase-orders`, label: "Purchase Orders" },
            ]
          : []),
        { href: `${d}/rentals`, label: "Rentals" },
        { href: `${d}/properties`, label: "Properties" },
      ],
    },
    {
      key: "work",
      label: "Work",
      icon: <SquaresIcon />,
      items: [
        { href: `${d}/tasks`, label: "Tasks" },
        ...(is("SERVICES", "LOGISTICS") ? [{ href: `${d}/job-cards`, label: "Job Cards" }] : []),
        { href: `${d}/trips`, label: "Trips" },
        ...(is("MEDICAL", "SERVICES")
          ? [{ href: `${d}/appointments`, label: "Appointments" }]
          : []),
        ...(is("LOGISTICS") ? [{ href: `${d}/fuel`, label: "Fuel Logs" }] : []),
        ...(is("MEDICAL") ? [{ href: `${d}/claims`, label: "Claims" }] : []),
        { href: `${d}/pos`, label: "Point of Sale" },
        { href: `${d}/cash-sale`, label: "Cash Sale" },
      ],
    },
    {
      key: "team",
      label: "Team",
      icon: <UserCogIcon />,
      items: [
        { href: `${d}/staff`, label: "Staff & Roles" },
        { href: `${d}/org`, label: "Org Chart" },
        { href: `${d}/team-performance`, label: "Team Performance" },
        { href: `${d}/attendance`, label: "Attendance" },
        { href: `${d}/leave`, label: "Leave" },
        { href: `${d}/assets`, label: "Assets" },
      ],
    },
    {
      key: "settings",
      label: "Settings",
      icon: <GearIcon />,
      items: [
        { href: `${d}/settings`, label: "All settings" },
        { href: `${d}/settings/appearance`, label: "Appearance" },
        { href: `${d}/settings/officers`, label: "Officers" },
        { href: `${d}/settings/pdf-templates`, label: "PDF templates" },
        { href: `${d}/settings/payment-gateways`, label: "Payment gateways" },
        { href: `${d}/settings/automation`, label: "Follow-ups" },
        { href: `${d}/settings/mail`, label: "Mail accounts" },
        { href: `${d}/settings/import`, label: "Import" },
        { href: `${d}/settings/export`, label: "Export" },
        { href: `${d}/settings/banking`, label: "Banking" },
        { href: `${d}/settings/audit-log`, label: "Audit log" },
      ],
    },
  ];

  // A category with nothing in it would render an empty panel.
  return groups.filter((g) => g.items.length > 0);
}

/* Phosphor-style strokes, matching the weight the template's icon font uses. */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function HouseIcon() {
  return <svg viewBox="0 0 24 24" {...P}><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V19a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1V9.5" /></svg>;
}
function TagIcon() {
  return <svg viewBox="0 0 24 24" {...P}><path d="M3 12.4V4h8.4L21 13.6 13.6 21z" /><circle cx="7.5" cy="7.5" r="1.4" /></svg>;
}
function UsersIcon() {
  return <svg viewBox="0 0 24 24" {...P}><circle cx="9" cy="8" r="3.2" /><path d="M3 19a6 6 0 0 1 12 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M17.5 19a5.6 5.6 0 0 0-2-4.3" /></svg>;
}
function BagIcon() {
  return <svg viewBox="0 0 24 24" {...P}><path d="M4 7h16l-1.2 12.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8z" /><path d="M9 10V6.5a3 3 0 0 1 6 0V10" /></svg>;
}
function SquaresIcon() {
  return <svg viewBox="0 0 24 24" {...P}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>;
}
function UserCogIcon() {
  return <svg viewBox="0 0 24 24" {...P}><circle cx="10" cy="8" r="3.2" /><path d="M4 19a6 6 0 0 1 9.5-4.9" /><circle cx="17.5" cy="17.5" r="2.5" /><path d="M17.5 13.6v1.1M17.5 20.3v1.1M21 17.5h-1.1M15.1 17.5H14" /></svg>;
}
// A hub with eight radiating spokes reads as a brightness or theme control,
// not as settings — which is exactly how the previous icon here was being
// misread. A toothed cog outline is the only shape that is unambiguous at
// rail size.
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.1 14.5a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.74 2.74l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.46v.17a1.94 1.94 0 0 1-3.88 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a1.94 1.94 0 1 1-2.74-2.74l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.46-.97H2.9a1.94 1.94 0 0 1 0-3.88h.09a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.94 1.94 0 1 1 2.74-2.74l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .97-1.46V2.9a1.94 1.94 0 0 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.94 1.94 0 1 1 2.74 2.74l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.46.97h.17a1.94 1.94 0 0 1 0 3.88h-.09a1.6 1.6 0 0 0-1.46.97z" />
    </svg>
  );
}
