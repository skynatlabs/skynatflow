"use client";

const selectClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export function TemplatePicker({
  templates,
}: {
  templates: { id: string; name: string; introText: string | null; scopeOfWork: string | null }[];
}) {
  if (templates.length === 0) return null;

  function applyTemplate(id: string) {
    const template = templates.find((t) => t.id === id);
    const introEl = document.querySelector<HTMLTextAreaElement>('textarea[name="introText"]');
    const scopeEl = document.querySelector<HTMLTextAreaElement>('textarea[name="scopeOfWork"]');
    if (template && introEl) introEl.value = template.introText ?? "";
    if (template && scopeEl) scopeEl.value = template.scopeOfWork ?? "";
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--kb-text)]">
        Start from a template <span className="text-[var(--kb-text-dim)]">(optional)</span>
      </label>
      <select onChange={(e) => applyTemplate(e.target.value)} defaultValue="" className={selectClass}>
        <option value="">— blank —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
