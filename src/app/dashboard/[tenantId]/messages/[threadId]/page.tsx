import Link from "next/link";
import { listMessages } from "@/lib/core/messaging";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { sendMessageAction } from "../actions";
import AutoRefresh from "./AutoRefresh";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ tenantId: string; threadId: string }>;
}) {
  const { tenantId, threadId } = await params;
  const access = await requireTenantAccess(tenantId);
  const messages = await listMessages(threadId);

  return (
    <main className="mx-auto flex h-[calc(100vh-4rem)] max-w-2xl flex-col p-8">
      <AutoRefresh />
      <Link href={`/dashboard/${tenantId}/messages`} className="text-sm text-[var(--kb-text-dim)] hover:text-[var(--kb-text)]">
        &larr; All conversations
      </Link>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`kb-card max-w-[75%] p-3 ${m.authorId === access.membershipId ? "ml-auto" : ""}`}
          >
            <p className="text-xs font-semibold text-[var(--kb-text-dim)]">{m.authorName}</p>
            <p className="mt-0.5 text-sm text-[var(--kb-text)]">{m.body}</p>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-center text-sm text-[var(--kb-text-dim)]">No messages yet — say hi.</p>
        )}
      </div>

      <form action={sendMessageAction} className="mt-4 flex gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="threadId" value={threadId} />
        <input
          name="body"
          placeholder="Type a message…"
          required
          className="flex-1 rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] px-3 py-2 text-sm text-[var(--kb-text)]"
        />
        <button type="submit" className="kb-pill kb-pill-primary text-xs">Send</button>
      </form>
    </main>
  );
}
