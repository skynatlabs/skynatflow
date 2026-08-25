import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { listThreadsForMember } from "@/lib/core/messaging";
import { startDmAction, startGroupAction } from "./actions";

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const [threads, memberships] = await Promise.all([
    access.membershipId ? listThreadsForMember(tenantId, access.membershipId) : [],
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Messages</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Direct messages and groups — for chatting about a project or task without leaving the app.
      </p>

      <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {threads.length === 0 && (
          <li className="px-5 py-6 text-center text-sm text-[var(--kb-text-dim)]">No conversations yet.</li>
        )}
        {threads.map((t) => (
          <li key={t.id}>
            <Link href={`/dashboard/${tenantId}/messages/${t.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-[var(--kb-panel)]">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{t.name || "Direct message"}</p>
                {t.lastMessage && <p className="truncate text-xs text-[var(--kb-text-dim)]">{t.lastMessage}</p>}
              </div>
              <span className="shrink-0 text-[10px] text-[var(--kb-text-dim)]">
                {new Date(t.lastMessageAt).toLocaleDateString()}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form action={startDmAction} className="kb-card p-4">
          <p className="text-sm font-medium text-[var(--kb-text)]">Start a DM</p>
          <input type="hidden" name="tenantId" value={tenantId} />
          <select name="otherId" required className="mt-2 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
            {memberships.filter((m) => m.id !== access.membershipId).map((m) => (
              <option key={m.id} value={m.id}>{m.user.name ?? m.user.email}</option>
            ))}
          </select>
          <button type="submit" className="kb-pill kb-pill-primary mt-2 text-xs">Message</button>
        </form>

        <form action={startGroupAction} className="kb-card p-4">
          <p className="text-sm font-medium text-[var(--kb-text)]">Start a group</p>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input name="name" placeholder="Group name" required className="mt-2 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          <select name="participantIds" multiple required className="mt-2 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
            {memberships.filter((m) => m.id !== access.membershipId).map((m) => (
              <option key={m.id} value={m.id}>{m.user.name ?? m.user.email}</option>
            ))}
          </select>
          <button type="submit" className="kb-pill kb-pill-primary mt-2 text-xs">Create group</button>
        </form>
      </div>
    </main>
  );
}
