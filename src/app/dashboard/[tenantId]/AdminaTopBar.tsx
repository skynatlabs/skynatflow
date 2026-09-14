// Admina's navbar, rebuilt to its own spec.
//
// Measurements taken from the template's index.html: an h-11 pill search
// 24.25rem wide with a 32px blue circular submit tucked at end-1.5, and a row
// of 44px circular icon buttons that turn blue on hover. Styling lives in
// admina.css as .admina-nav-* classes rather than Tailwind utilities, because
// the template's classes (border-neutral-200, bg-primary-600) come from a
// Tailwind 3 colour config this app doesn't have.

import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AdminaTopBar({
  tenantId,
  unread,
  customerLabel,
  userName,
  userRole,
  theme,
}: {
  tenantId: string;
  unread: number;
  customerLabel: string;
  userName: string;
  userRole: string;
  theme: "light" | "dark";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      {/* ---------------------------------------------------------- left */}
      <div className="flex items-center gap-4">
        <Link
          href={`/dashboard/${tenantId}`}
          className="admina-nav-back hidden xl:flex"
          aria-label="Back to home"
        >
          <BackGlyph />
        </Link>

        <form
          action={`/dashboard/${tenantId}/customers`}
          className="admina-search relative hidden lg:block"
        >
          <input
            type="text"
            name="q"
            placeholder={`Search ${customerLabel.toLowerCase()}s`}
            aria-label={`Search ${customerLabel.toLowerCase()}s`}
          />
          <button type="submit" aria-label="Search">
            <SearchGlyph />
          </button>
        </form>
      </div>

      {/* --------------------------------------------------------- right */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          href={`/dashboard/${tenantId}/messages`}
          className="admina-nav-icon hidden sm:inline-flex"
          aria-label="Messages"
        >
          <ChatGlyph />
        </Link>

        <ThemeToggle current={theme} variant="admina" />

        <Link
          href={`/dashboard/${tenantId}/inbox`}
          className="admina-nav-icon relative"
          aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
        >
          <BellGlyph />
          {unread > 0 && <span className="admina-nav-badge">{unread > 9 ? "9+" : unread}</span>}
        </Link>

        <Link
          href={`/dashboard/${tenantId}/settings`}
          className="admina-nav-icon hidden sm:inline-flex"
          aria-label="Settings"
        >
          <GearGlyph />
        </Link>

        <Link href="/account/security" className="admina-nav-user" aria-label="Your account">
          <span className="admina-nav-avatar" aria-hidden="true">
            {userName.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden text-left md:block">
            <span className="admina-nav-user__name">{userName}</span>
            <span className="admina-nav-user__role">{userRole}</span>
          </span>
        </Link>
      </div>
    </div>
  );
}

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function BackGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...S} width="22" height="22">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}
function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...S} width="16" height="16">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}
function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...S} width="20" height="20">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L4 21l1.1-3.6A8.4 8.4 0 1 1 21 11.5z" />
      <circle cx="8.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...S} width="20" height="20">
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...S} width="20" height="20">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    </svg>
  );
}
