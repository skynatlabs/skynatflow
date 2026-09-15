// What the team left each other.
//
// The handover that currently happens in a WhatsApp group and is unfindable
// a week later: who to ask for at the gate, why that customer gets 5% off,
// what the technician found under the floor. Written here it stays with the
// business, and naming somebody tells them.

import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listTeamNotes } from "@/lib/core/notes";
import { PageHeader } from "../PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { addTeamNoteAction, deleteNoteAction, pinNoteAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  let access;
  try {
    access = await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [notes, team] = await Promise.all([
    listTeamNotes(tenantId, access.membershipId),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Notes" crumbs={[{ label: "Notes" }]} />

      <form action={addTeamNoteAction.bind(null, tenantId)} className="kb-card p-5">
        <input name="title" placeholder="A heading, if it needs one" className="kb-input w-full text-sm font-medium" />
        <textarea
          name="body"
          required
          rows={3}
          placeholder="What does whoever picks this up next need to know?"
          className="kb-input mt-2 w-full text-sm"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-xs">
            <span className="mr-1 font-medium text-[var(--kb-text-dim)]">Who sees it</span>
            <select name="audience" className="kb-input !py-1 text-xs">
              <option value="team">Everybody here</option>
              <option value="private">Only me</option>
            </select>
          </label>

          {team.length > 1 && (
            <label className="text-xs">
              <span className="mr-1 font-medium text-[var(--kb-text-dim)]">Tell somebody</span>
              <select name="mentions" multiple size={1} className="kb-input !py-1 text-xs">
                {team
                  .filter((m) => m.id !== access.membershipId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.user.name ?? m.user.email}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <label className="flex items-center gap-1.5 text-xs text-[var(--kb-text-dim)]">
            <input type="checkbox" name="pinned" /> Keep it at the top
          </label>

          <span className="ml-auto">
            <SubmitButton pendingText="Saving…">Leave the note</SubmitButton>
          </span>
        </div>
      </form>

      <section className="mt-5">
        {notes.length === 0 ? (
          <EmptyState
            title="Nothing written down yet"
            purpose="The handover that usually happens in a WhatsApp group, kept where the work is."
            needs="Anything worth the next person knowing."
          />
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="kb-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {n.title && <p className="text-sm font-semibold text-[var(--kb-text)]">{n.title}</p>}
                    <p className="mt-0.5 text-sm whitespace-pre-wrap text-[var(--kb-text)]">{n.body}</p>
                    <p className="mt-1 text-[11px] text-[var(--kb-text-dim)]">
                      {n.authorName} · {n.createdAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      {n.audience === "private" ? " · only you" : ""}
                      {n.mentionNames.length > 0 ? ` · told ${n.mentionNames.join(", ")}` : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <form action={pinNoteAction.bind(null, tenantId, n.id, !n.pinned)}>
                      <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                        {n.pinned ? "Unpin" : "Pin"}
                      </button>
                    </form>
                    {n.authorId === access.membershipId && (
                      <form action={deleteNoteAction.bind(null, tenantId, n.id)}>
                        <button type="submit" className="text-[11px] text-[var(--kb-text-dim)] underline">
                          Delete
                        </button>
                      </form>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
