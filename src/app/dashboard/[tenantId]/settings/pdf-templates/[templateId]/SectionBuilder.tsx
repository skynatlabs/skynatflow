"use client";

import { useRef, useState } from "react";
import { saveSectionLayoutAction } from "./actions";

const SECTION_LABELS: Record<string, { label: string; hint: string }> = {
  terms: { label: "Terms", hint: "Your standard terms/notes text." },
  bankingDetails: { label: "Banking details", hint: "EFT account details for payment." },
  verify: { label: "Verify this document", hint: "WhatsApp-verify line — anti-impersonation." },
};

export function SectionBuilder({
  tenantId,
  templateId,
  initialOrder,
  initialHidden,
}: {
  tenantId: string;
  templateId: string;
  initialOrder: string[];
  initialHidden: string[];
}) {
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [hidden, setHidden] = useState<Set<string>>(new Set(initialHidden));
  const dragIndex = useRef<number | null>(null);
  const [saved, setSaved] = useState(false);

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDrop(index: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === index) return;
    setOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setSaved(false);
  }

  function toggleHidden(key: string) {
    setHidden((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setSaved(false);
  }

  return (
    <div>
      <p className="text-xs text-[var(--kb-text-dim)]">
        Drag to reorder how these appear below the item table. Uncheck to hide one entirely. The
        logo/header and item table stay fixed at the top — everything else here is yours to arrange.
      </p>

      <ul className="mt-3 space-y-2">
        {order.map((key, index) => {
          const meta = SECTION_LABELS[key];
          if (!meta) return null;
          const isHidden = hidden.has(key);
          return (
            <li
              key={key}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              className={`flex cursor-grab items-center gap-3 rounded-xl border border-[var(--kb-panel-border)] bg-white px-4 py-3 active:cursor-grabbing ${
                isHidden ? "opacity-50" : ""
              }`}
            >
              <span className="text-[var(--kb-text-dim)]" aria-hidden="true">⠿</span>
              <input
                type="checkbox"
                checked={!isHidden}
                onChange={() => toggleHidden(key)}
                className="h-4 w-4"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--kb-text)]">{meta.label}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">{meta.hint}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <form
        action={saveSectionLayoutAction}
        className="mt-4"
        onSubmit={() => setSaved(true)}
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="templateId" value={templateId} />
        <input type="hidden" name="sectionOrder" value={order.join(",")} />
        <input type="hidden" name="hiddenSections" value={[...hidden].join(",")} />
        <button type="submit" className="kb-pill kb-pill-primary text-xs">
          Save layout
        </button>
        {saved && <span className="ml-3 text-xs text-[var(--kb-text-dim)]">Saved.</span>}
      </form>
    </div>
  );
}
