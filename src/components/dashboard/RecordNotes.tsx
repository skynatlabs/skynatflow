// The conversation about one record, kept beside it.
//
// An invoice is argued about before it is paid: who agreed the discount,
// which site it was for, why it was re-sent in March. That conversation
// happens in WhatsApp and is lost. Here it sits on the document, visible to
// the team and to nobody else — a customer's portal never shows it, and the
// PDF never carries it.

import { addRecordNoteAction } from "@/app/dashboard/[tenantId]/record-notes/actions";
import { SubmitButton } from "./SubmitButton";

export interface RecordNote {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
}

export function RecordNotes({
  tenantId,
  entityType,
  entityId,
  notes,
  title = "Notes for the team",
  hint = "Only people in this workspace see these. They never appear on the document or in the customer's portal.",
}: {
  tenantId: string;
  entityType: string;
  entityId: string;
  notes: RecordNote[];
  title?: string;
  hint?: string;
}) {
  return (
    <section className="kb-card p-5">
      <h2 className="text-sm font-semibold text-[var(--kb-text)]">{title}</h2>
      <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{hint}</p>

      {notes.length > 0 && (
        <ul className="mt-3 space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-[var(--kb-panel-border)] pl-3">
              <p className="text-sm whitespace-pre-wrap text-[var(--kb-text)]">{n.body}</p>
              <p className="mt-0.5 text-[11px] text-[var(--kb-text-dim)]">
                {n.authorName} · {n.createdAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}{" "}
                {n.createdAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form action={addRecordNoteAction} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        <label className="min-w-[12rem] flex-1 text-xs">
          <span className="sr-only">Add a note</span>
          <input name="body" required placeholder="Add a note for whoever picks this up next" className="kb-input w-full text-sm" />
        </label>
        <SubmitButton pendingText="Saving…">Add note</SubmitButton>
      </form>
    </section>
  );
}
