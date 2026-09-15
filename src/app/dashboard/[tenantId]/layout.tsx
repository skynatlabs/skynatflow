import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getPlatformColorSkin, getAccentForUser } from "@/lib/ai/model";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { logoutAction } from "@/app/logout/actions";
import { FlowMark } from "@/components/FlowMark";
import { CommandBar } from "./CommandBar";
import { TopBar } from "./TopBar";
import { SidebarShell } from "./SidebarShell";
import { TwinSidebar } from "./TwinSidebar";
import { AdminaTopBar } from "./AdminaTopBar";
import { buildAdminaNav } from "./adminaNav";
import { quietPages } from "@/lib/core/readiness";
import { unreadCount } from "@/lib/core/notifications2";
import {
  HomeIcon,
  UsersIcon,
  QuoteIcon,
  LinkIcon,
  CheckSquareIcon,
  UserCogIcon,
  BoxIcon,
  ColumnsIcon,
  SparkleIcon,
  SignatureIcon,
  AgentIcon,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function TenantShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  // The actual access-control enforcement point — every tenant-scoped page
  // sits behind this layout, so this one check protects all of them.
  let access: Awaited<ReturnType<typeof requireTenantAccess>>;
  try {
    access = await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound(); // don't leak that the tenant exists
    throw err;
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) notFound();

  const niche = nicheConfig(tenant.niche);

  const viewer = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { name: true, email: true },
  });
  const viewerName = viewer?.name ?? viewer?.email ?? "You";
  const unread = await unreadCount(tenantId);
  // Held actions, counted once for the whole shell: the assistant button
  // carries the badge on every page, so a queued approval is visible from
  // wherever you happen to be rather than only on the home dashboard.
  const awaitingApproval = await prisma.agentRun.count({
    where: { tenantId, status: "AWAITING_APPROVAL" },
  });
  const cookieStore = await cookies();
  const theme = cookieStore.get("kb-theme")?.value === "dark" ? "dark" : "light";
  const skin = await getPlatformColorSkin();
  // A person's own accent, which follows them between workspaces.
  const accent = await getAccentForUser(access.userId);

  const nav = [
    { href: `/dashboard/${tenantId}`, label: "Home", icon: HomeIcon },
    { href: `/dashboard/${tenantId}/brief`, label: "The Brief", icon: SparkleIcon },
    { href: `/dashboard/${tenantId}/agent`, label: "Agent", icon: AgentIcon },
    { href: `/dashboard/${tenantId}/today`, label: "Today", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/inbox`, label: "Inbox", icon: SignatureIcon, badge: unread || undefined },
    { href: `/dashboard/${tenantId}/customers`, label: niche.customerLabel + "s", icon: UsersIcon },
    { href: `/dashboard/${tenantId}/products`, label: "Products", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/inventory`, label: "Inventory", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/quotes`, label: "Quotes", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/invoices`, label: "Invoices", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/statements`, label: "Statements", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/cash-forecast`, label: "Cash forecast", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/books`, label: "The books", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/banking`, label: "Bank & reconciliation", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/margins`, label: "Margins & suppliers", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/costs`, label: "Costs", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/savings`, label: "Savings", icon: SparkleIcon },
    { href: `/dashboard/${tenantId}/value`, label: "Value", icon: SparkleIcon },
    { href: `/dashboard/${tenantId}/trips`, label: "Trips", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/fleet`, label: "Fleet", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/this-week`, label: "This Week", icon: SignatureIcon },
    ...(niche.skin === "MEDICAL" || niche.skin === "SERVICES" ? [{ href: `/dashboard/${tenantId}/appointments`, label: "Appointments", icon: SignatureIcon }] : []),
    ...(niche.skin === "SERVICES" || niche.skin === "LOGISTICS" ? [{ href: `/dashboard/${tenantId}/job-cards`, label: "Job Cards", icon: CheckSquareIcon }] : []),
    { href: `/dashboard/${tenantId}/unsent-quotes`, label: "Unsent Quotes", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/overdue`, label: "Overdue", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/pipeline`, label: "Pipeline", icon: ColumnsIcon },
    { href: `/dashboard/${tenantId}/ai-drafts`, label: "AI Drafts", icon: SparkleIcon },
    { href: `/dashboard/${tenantId}/disputes`, label: "Reports", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/connections`, label: "Connections", icon: LinkIcon },
    { href: `/dashboard/${tenantId}/tasks`, label: "Tasks", icon: CheckSquareIcon },
    { href: `/dashboard/${tenantId}/messages`, label: "Messages", icon: SparkleIcon },
    { href: `/dashboard/${tenantId}/goals`, label: "Goals", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/compliance`, label: "Compliance", icon: CheckSquareIcon },
    { href: `/dashboard/${tenantId}/expenses`, label: "Expenses", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/attendance`, label: "Attendance", icon: CheckSquareIcon },
    { href: `/dashboard/${tenantId}/leave`, label: "Leave", icon: CheckSquareIcon },
    { href: `/dashboard/${tenantId}/assets`, label: "Assets", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/org`, label: "Org Chart", icon: UserCogIcon },
    { href: `/dashboard/${tenantId}/team-performance`, label: "Team Performance", icon: SignatureIcon },
    ...(niche.skin === "LOGISTICS" ? [{ href: `/dashboard/${tenantId}/fuel`, label: "Fuel Logs", icon: BoxIcon }] : []),
    ...(niche.skin === "RETAIL" || niche.skin === "WHOLESALE" ? [{ href: `/dashboard/${tenantId}/stocktake`, label: "Stocktake", icon: BoxIcon }] : []),
    ...(niche.skin === "RETAIL" || niche.skin === "WHOLESALE" ? [{ href: `/dashboard/${tenantId}/purchase-orders`, label: "Purchase Orders", icon: BoxIcon }] : []),
    ...(niche.skin === "MEDICAL" ? [{ href: `/dashboard/${tenantId}/claims`, label: "Claims", icon: SignatureIcon }] : []),
    ...(niche.skin === "NONPROFIT" ? [{ href: `/dashboard/${tenantId}/members`, label: "Members & Donors", icon: UsersIcon }] : []),
    { href: `/dashboard/${tenantId}/rentals`, label: "Rentals", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/properties`, label: "Properties", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/pos`, label: "Point of Sale", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/cash-sale`, label: "Cash Sale", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/staff`, label: "Staff & Roles", icon: UserCogIcon },
    { href: `/dashboard/${tenantId}/settings`, label: "Settings", icon: UserCogIcon },
    { href: `/dashboard/${tenantId}/settings/appearance`, label: "Appearance", icon: UserCogIcon },
    { href: `/dashboard/${tenantId}/settings/officers`, label: "Officers", icon: UserCogIcon },
  ];

  const sidebarContent = (
    <>
        <div className="shrink-0">
          <div className="flex items-center gap-2 px-2">
            <FlowMark size={28} />
            <span className="text-lg font-bold text-white">skynat.ai</span>
          </div>

          <div className="mt-7 rounded-[10px] px-3 py-3" style={{ background: "var(--kb-navy-soft)" }}>
            <p className="truncate text-sm font-semibold text-white">{tenant.name}</p>
            <span
              className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
            >
              {niche.label}
            </span>
          </div>
        </div>

        {/* Nav scrolls independently — the list has grown to ~30 items across
           all niches, which no longer fits h-screen alongside the pinned
           header/footer blocks. Without its own overflow, items past the
           fold (and the sign-out/theme-toggle footer) were simply
           unreachable. */}
        <nav className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white"
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate flex-1">{item.label}</span>
                {"badge" in item && item.badge ? (
                  <span className="rounded-full bg-[var(--kb-accent-a)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-3 pt-3">
          <ThemeToggle current={theme} />
          <Link
            href="/account/security"
            className="block px-2 text-xs text-white/40 hover:text-white/70"
          >
            2FA / security
          </Link>
          <Link
            href="/dashboard"
            className="block px-2 text-xs text-white/40 hover:text-white/70"
          >
            &larr; Switch workspace
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="block px-2 text-xs text-white/40 hover:text-white/70">
              Sign out
            </button>
          </form>
        </div>
    </>
  );

  // The Admina skin ships its own chrome — a twin rail+panel sidebar and a
  // fixed-offset main column — so it replaces the shell rather than restyling
  // it. Every other skin keeps the original single-column sidebar.
  if (skin === "admina") {
    return (
      <div className="kb-shell" data-theme={theme} data-skin={skin} data-accent={accent}>
        <TwinSidebar
          groups={buildAdminaNav({
            tenantId,
            skin: niche.skin,
            customerLabel: niche.customerLabel,
            unread,
            quiet: await quietPages(tenantId),
          })}
          brand={<FlowMark size={28} />}
          workspaceName={tenant.name}
          footer={
            <>
              <span className="admina-foot-art" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="30" height="30">
                  <path d="M5 15c-1 2.5-1 4 0 4s2.5-1 4-2" />
                  <path d="M13.5 3.5c3.5-1 6.5 0 7 .5s1.5 3.5.5 7c-1.2 4.2-5 7-8 8l-4.5-4.5c1-3 3.8-6.8 8-9.9z" />
                  <circle cx="14.5" cy="9.5" r="1.6" />
                </svg>
              </span>
              <div className="admina-foot-links">
                <Link href="/account/security">2FA / security</Link>
                <Link href="/dashboard">Switch workspace</Link>
                <form action={logoutAction}>
                  <button type="submit">Sign out</button>
                </form>
              </div>
              <p className="twin-version">skynat.ai</p>
            </>
          }
        />
        <main className="dashboard-main">
          <div className="navbar-header">
            <AdminaTopBar
              tenantId={tenantId}
              unread={unread}
              customerLabel={niche.customerLabel}
              userName={viewerName}
              userRole={access.role.charAt(0) + access.role.slice(1).toLowerCase()}
              theme={theme}
            />
          </div>
          <div className="dashboard-main-body kb-dock-host">{children}</div>
        </main>
        <CommandBar tenantId={tenantId} awaitingApproval={awaitingApproval} />
      </div>
    );
  }

  return (
    <div className="kb-shell flex" data-theme={theme} data-skin={skin} data-accent={accent}>
      <SidebarShell
        sidebar={sidebarContent}
        topbar={<TopBar tenantId={tenantId} unread={unread} customerLabel={niche.customerLabel} />}
      >
        {children}
      </SidebarShell>
      <CommandBar tenantId={tenantId} awaitingApproval={awaitingApproval} />
    </div>
  );
}
