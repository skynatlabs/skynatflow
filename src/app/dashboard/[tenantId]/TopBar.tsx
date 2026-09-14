import Link from "next/link";
import { BellIcon, QuoteIcon } from "@/components/icons";

// Persistent header above every dashboard page — global search, the
// notification bell, and the one action that's always relevant (start a
// new quote), pulled out of the sidebar so they're reachable without
// scrolling a ~30-item nav list. The sidebar stays the full site map;
// this bar is just the handful of things worth reaching from anywhere.
export function TopBar({
  tenantId,
  unread,
  customerLabel,
}: {
  tenantId: string;
  unread: number;
  customerLabel: string;
}) {
  return (
    <header className="flex items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
      {/* Search collapses to an icon-free compact field on phones rather than
         disappearing — finding a customer is the single most common reason
         someone opens this app on the move. */}
      <form action={`/dashboard/${tenantId}/customers`} className="min-w-0 flex-1 sm:max-w-md">
        <input
          name="q"
          placeholder={`Search ${customerLabel.toLowerCase()}s…`}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{
            background: "var(--kb-bg)",
            borderColor: "var(--kb-panel-border)",
            color: "var(--kb-text)",
          }}
        />
      </form>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <Link
          href={`/dashboard/${tenantId}/inbox`}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border transition hover:opacity-80"
          style={{ borderColor: "var(--kb-panel-border)" }}
          aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
        >
          <BellIcon className="h-[18px] w-[18px]" style={{ color: "var(--kb-text-dim)" }} />
          {unread > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
              style={{ background: "var(--kb-accent-a)" }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>

        <Link
          href={`/dashboard/${tenantId}/quotes/new`}
          className="kb-pill kb-pill-primary flex items-center gap-1.5 whitespace-nowrap text-xs"
        >
          <QuoteIcon className="h-[14px] w-[14px] shrink-0" />
          <span className="hidden sm:inline">New quote</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>
    </header>
  );
}
