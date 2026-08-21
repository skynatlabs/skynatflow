import { prisma } from "@/lib/db";
import { approveDraftAction, skipDraftAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AiDraftsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const drafts = await prisma.aiDraft.findMany({
    where: { tenantId, status: "PENDING" },
    include: { party: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">AI drafts, waiting on you</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Nothing here reaches a customer until you approve it. Edit the text first if you want —
        what you send is what goes out.
      </p>

      <div className="mt-6 space-y-4">
        {drafts.map((d) => (
          <div key={d.id} className="kb-card p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--kb-text)]">{d.party.name}</p>
              <span className="text-xs text-[var(--kb-text-dim)]">Touch #{d.touchNumber}</span>
            </div>
            <p className="mt-1 text-xs italic text-[var(--kb-text-dim)]">{d.reasoning}</p>

            <form action={approveDraftAction} className="mt-3">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="draftId" value={d.id} />
              <textarea
                name="body"
                defaultValue={d.body}
                rows={3}
                className="w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
              />
              <div className="mt-3 flex gap-2">
                <button type="submit" className="kb-pill kb-pill-primary text-xs">
                  Approve &amp; send
                </button>
              </div>
            </form>
            <form action={skipDraftAction} className="mt-2">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="draftId" value={d.id} />
              <button type="submit" className="text-xs text-[var(--kb-text-dim)] hover:underline">
                Skip this one
              </button>
            </form>
          </div>
        ))}
        {drafts.length === 0 && (
          <div className="kb-card p-6 text-sm text-[var(--kb-text-dim)]">
            Nothing waiting right now — the follow-up engine will drop drafts here as quotes and
            invoices go quiet.
          </div>
        )}
      </div>
    </main>
  );
}
