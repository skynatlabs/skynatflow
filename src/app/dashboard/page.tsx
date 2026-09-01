// Tenant picker — with multiple verticals now live side by side (per your
// "let's have all verticals done, we don't know which will perform best"
// instruction), this is the switcher between them. Backed by real auth:
// shows only workspaces the signed-in user actually has a Membership on.
// A platform super admin does NOT automatically see every tenant here —
// that access lives at /car/tenants instead, kept separate from actual
// business data.

import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";

export const dynamic = "force-dynamic";

export default async function DashboardIndexPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const tenants = (
    await prisma.membership.findMany({
      where: { userId: session.user.id },
      include: { tenant: true },
      orderBy: { createdAt: "asc" },
    })
  ).map((m) => m.tenant);

  if (tenants.length === 0) {
    redirect("/onboarding");
  }
  if (tenants.length === 1) {
    redirect(`/dashboard/${tenants[0].id}`);
  }

  const cookieStore = await cookies();
  const theme = cookieStore.get("kb-theme")?.value === "dark" ? "dark" : "light";

  return (
    <div className="kb-shell min-h-screen p-8" data-theme={theme}>
      <main className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold text-[var(--kb-text)]">Your workspaces</h1>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
          One account, multiple verticals — pick one to open.
        </p>
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {tenants.map((t) => (
            <li key={t.id}>
              <Link
                href={`/dashboard/${t.id}`}
                className="flex items-center justify-between p-4 transition hover:bg-black/[0.02]"
              >
                <div>
                  <p className="font-semibold text-[var(--kb-text)]">{t.name}</p>
                  <p className="text-sm text-[var(--kb-text-dim)]">{nicheConfig(t.niche).label}</p>
                </div>
                <span className="text-sm text-[var(--kb-text-dim)]">Open &rarr;</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/onboarding" className="kb-pill kb-pill-ghost mt-4 inline-flex">
          + Add another workspace
        </Link>
      </main>
    </div>
  );
}
