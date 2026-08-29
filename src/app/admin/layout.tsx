import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSuperAdmin, AuthRequiredError, ForbiddenError } from "@/lib/auth/tenant-access";
import { FlowMark } from "@/components/FlowMark";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound(); // don't leak that /admin exists
    throw err;
  }

  return (
    <div className="min-h-screen bg-[var(--kb-bg)]" data-theme="light">
      <header className="border-b border-[var(--kb-panel-border)] bg-[var(--kb-panel)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/admin" className="flex items-center gap-2">
            <FlowMark size={26} />
            <span className="font-bold text-[var(--kb-text)]">Marketing CMS</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/admin/ai" className="text-sm text-[var(--kb-text-dim)] hover:text-[var(--kb-text)]">
              AI provider
            </Link>
            <Link href="/dashboard" className="text-sm text-[var(--kb-text-dim)] hover:text-[var(--kb-text)]">
              &larr; Back to dashboard
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
