import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { logoutAction } from "@/app/logout/actions";
import { FlowMark } from "@/components/FlowMark";
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
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound(); // don't leak that the tenant exists
    throw err;
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) notFound();

  const niche = nicheConfig(tenant.niche);
  const cookieStore = await cookies();
  const theme = cookieStore.get("kb-theme")?.value === "dark" ? "dark" : "light";

  const nav = [
    { href: `/dashboard/${tenantId}`, label: "Home", icon: HomeIcon },
    { href: `/dashboard/${tenantId}/customers`, label: niche.customerLabel + "s", icon: UsersIcon },
    { href: `/dashboard/${tenantId}/products`, label: "Products", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/inventory`, label: "Inventory", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/quotes/new`, label: "New Quote", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/unsent-quotes`, label: "Unsent Quotes", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/overdue`, label: "Overdue", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/pipeline`, label: "Pipeline", icon: ColumnsIcon },
    { href: `/dashboard/${tenantId}/ai-drafts`, label: "AI Drafts", icon: SparkleIcon },
    { href: `/dashboard/${tenantId}/disputes`, label: "Reports", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/connections`, label: "Connections", icon: LinkIcon },
    { href: `/dashboard/${tenantId}/tasks`, label: "Tasks", icon: CheckSquareIcon },
    { href: `/dashboard/${tenantId}/messages`, label: "Messages", icon: SparkleIcon },
    { href: `/dashboard/${tenantId}/goals`, label: "Goals", icon: SignatureIcon },
    { href: `/dashboard/${tenantId}/expenses`, label: "Expenses", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/attendance`, label: "Attendance", icon: CheckSquareIcon },
    { href: `/dashboard/${tenantId}/org`, label: "Org Chart", icon: UserCogIcon },
    ...(niche.skin === "LOGISTICS" ? [{ href: `/dashboard/${tenantId}/fuel`, label: "Fuel Logs", icon: BoxIcon }] : []),
    ...(niche.skin === "RETAIL" || niche.skin === "WHOLESALE" ? [{ href: `/dashboard/${tenantId}/stocktake`, label: "Stocktake", icon: BoxIcon }] : []),
    ...(niche.skin === "MEDICAL" ? [{ href: `/dashboard/${tenantId}/claims`, label: "Claims", icon: SignatureIcon }] : []),
    ...(niche.skin === "NONPROFIT" ? [{ href: `/dashboard/${tenantId}/members`, label: "Members & Donors", icon: UsersIcon }] : []),
    { href: `/dashboard/${tenantId}/rentals`, label: "Rentals", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/properties`, label: "Properties", icon: BoxIcon },
    { href: `/dashboard/${tenantId}/pos`, label: "Point of Sale", icon: QuoteIcon },
    { href: `/dashboard/${tenantId}/staff`, label: "Staff & Roles", icon: UserCogIcon },
  ];

  return (
    <div className="kb-shell flex" data-theme={theme}>
      <aside
        className="sticky top-0 flex h-screen w-64 flex-col justify-between p-5"
        style={{ background: "var(--kb-navy)" }}
      >
        <div>
          <div className="flex items-center gap-2 px-2">
            <FlowMark size={28} />
            <span className="text-lg font-bold text-white">flow</span>
          </div>

          <div className="mt-7 rounded-2xl px-3 py-3" style={{ background: "var(--kb-navy-soft)" }}>
            <p className="truncate text-sm font-semibold text-white">{tenant.name}</p>
            <span
              className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
            >
              {niche.label}
            </span>
          </div>

          <nav className="mt-6 space-y-1">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white"
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3">
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
      </aside>

      <div className="min-h-screen flex-1" style={{ background: "var(--kb-bg)" }}>
        {children}
      </div>
    </div>
  );
}
