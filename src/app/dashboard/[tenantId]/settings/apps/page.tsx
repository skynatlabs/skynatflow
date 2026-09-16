// On a phone, on a desk, in the field.
//
// This page exists partly to be honest. Three of the four things on it work
// today and are built; the fourth — a listing in the App Store and the Play
// Store — needs a developer account, a signing certificate and a review, and
// none of those is code. Saying so beats a "coming soon" that never arrives.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { pushStatus } from "@/lib/core/push";
import { PushToggle } from "@/components/dashboard/PushToggle";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function AppsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const status = await pushStatus(tenantId);

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">On your phone</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Nobody wants a business system on their phone. What they want is to be told the moment something happens, and to
        tap it and be in the right place.
      </p>

      {/* ------------------------------------------------- being told */}
      <section className="kb-card mt-6 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Notifications</h2>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{status.note}</p>
        <div className="mt-3">
          <PushToggle tenantId={tenantId} />
        </div>
        <p className="mt-3 text-[11px] text-[var(--kb-text-dim)]">{status.privacy}</p>
      </section>

      {/* ------------------------------------------------- installing */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Putting it on the home screen</h2>
        <ul className="mt-2 grid gap-2 text-sm text-[var(--kb-text-dim)]">
          <li>
            <span className="text-[var(--kb-text)]">Android or Chrome:</span> the browser offers to install it. It gets a real
            icon and opens without the address bar.
          </li>
          <li>
            <span className="text-[var(--kb-text)]">iPhone:</span> tap Share, then &ldquo;Add to Home Screen&rdquo;. This is
            also what makes notifications possible on an iPhone — Safari allows them only for an installed site.
          </li>
          <li>
            <span className="text-[var(--kb-text)]">Mac or Windows:</span> Chrome and Edge both install it as a desktop app
            from the address bar.
          </li>
        </ul>
        <p className="mt-3 text-[11px] text-[var(--kb-text-dim)]">
          Once it is installed, holding the icon gives you a new quote, today&apos;s work, photographing a slip, and field
          mode — and a photograph shared from the camera roll lands straight on the capture screen.
        </p>
      </section>

      {/* ------------------------------------------------- field mode */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Field mode</h2>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
          For somebody standing up: today&apos;s jobs, big buttons, and every tap saved on the phone first so it survives a
          tunnel. It is under Operations in the menu, and worth putting on the home screen of anybody who works on site.
        </p>
      </section>

      {/* ------------------------------------------------- what is not built */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">What is not built</h2>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
          {BRAND} is not in the App Store or the Play Store. A listing needs a developer account in the business&apos;s own
          name, a signing certificate, and a review that takes days per submission — none of which is code, and all of which
          is a real decision rather than a task. Everything on this page works without either store.
        </p>
      </section>
    </main>
  );
}
