// Admina's page header: title on the left, breadcrumb trail on the right.
//
// Every one of the template's 85 pages opens with this exact block, so a page
// without it reads as belonging to a different product. Markup follows theirs:
//   <div class="flex flex-wrap items-center justify-between gap-2 mb-6">
//     <h2 class="h6 font-semibold mb-0">Title</h2>
//     <ul class="flex items-center gap-[6px]"> Dashboard - Section </ul>
//
// Rendered for every skin, not just Admina — a page title and a trail back to
// home are useful regardless, and the other skins style it through the same
// kb-* tokens.

import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  tenantId,
  title,
  crumbs = [],
  actions,
}: {
  tenantId: string;
  title: string;
  /** Trail after "Dashboard". The last entry renders as plain text. */
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="admina-page-head mb-6 flex flex-wrap items-center justify-between gap-2">
      <h2 className="admina-page-title">{title}</h2>

      <div className="flex items-center gap-3">
        {actions}
        <ul className="admina-crumbs flex items-center gap-[6px]">
          <li className="font-medium">
            <Link href={`/dashboard/${tenantId}`} className="flex items-center gap-2">
              <HomeGlyph />
              Dashboard
            </Link>
          </li>
          {crumbs.map((crumb, i) => (
            <li key={crumb.label} className="flex items-center gap-[6px]">
              <span aria-hidden="true">-</span>
              {crumb.href && i < crumbs.length - 1 ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span className="font-medium">{crumb.label}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HomeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 9.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}
