import { listProposalTemplates } from "@/lib/core/templates";
import { createTemplateAction, deleteTemplateAction } from "./actions";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const templates = await listProposalTemplates(tenantId);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Proposal templates</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Save a reusable intro and scope of work — pick it from the dropdown next time you build a
        proposal instead of retyping it.
      </p>

      <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {templates.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="font-medium text-[var(--kb-text)]">{t.name}</p>
              {t.introText && (
                <p className="mt-1 truncate text-xs text-[var(--kb-text-dim)]">{t.introText}</p>
              )}
            </div>
            <form action={deleteTemplateAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="templateId" value={t.id} />
              <button type="submit" className="shrink-0 text-xs text-[var(--kb-text-dim)] hover:underline">
                Delete
              </button>
            </form>
          </li>
        ))}
        {templates.length === 0 && (
          <li className="p-4 text-sm text-[var(--kb-text-dim)]">No templates yet.</li>
        )}
      </ul>

      <form action={createTemplateAction} className="kb-card mt-6 space-y-4 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">Template name</label>
          <input name="name" required placeholder="e.g. Standard install proposal" className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">Intro</label>
          <textarea name="introText" rows={3} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">Scope of work</label>
          <textarea name="scopeOfWork" rows={4} className={inputClass} />
        </div>
        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Save template
        </button>
      </form>
    </main>
  );
}
