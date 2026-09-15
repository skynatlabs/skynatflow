"use client";

import { useState } from "react";
import { ProductSearch } from "@/components/dashboard/ProductSearch";

/**
 * The item a batch belongs to, found by typing — a catalogue of a thousand
 * products is not a list anyone should scroll, or a page should carry.
 */
export function BatchItemField({ tenantId }: { tenantId: string }) {
  const [text, setText] = useState("");
  const [itemId, setItemId] = useState("");
  return (
    <>
      <ProductSearch
        tenantId={tenantId}
        value={text}
        selectedId={itemId}
        canEdit={false}
        required
        placeholder="Search your catalogue…"
        className="mt-1 w-56 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
        onType={(t) => {
          setText(t);
          setItemId("");
        }}
        onSelect={(p) => {
          setText(p.name);
          setItemId(p.id);
        }}
      />
      <input type="hidden" name="itemId" value={itemId} />
    </>
  );
}
