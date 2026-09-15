"use client";

// Writing a slip: either against a document, which fills itself in with
// whatever is still outstanding on it, or by typing what is going out.

import { useState } from "react";
import { createDeliveryNoteAction } from "./actions";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

interface Option {
  id: string;
  label: string;
}

export function NewDeliveryNote({
  tenantId,
  parties,
  documents,
}: {
  tenantId: string;
  parties: Array<{ id: string; name: string }>;
  documents: Option[];
}) {
  const [against, setAgainst] = useState<"document" | "own">(documents.length > 0 ? "document" : "own");
  const [lines, setLines] = useState([{ description: "", quantity: "1", unit: "" }]);

  return (
    <form action={createDeliveryNoteAction.bind(null, tenantId)} className="kb-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold text-[var(--kb-text)]">New delivery note</h2>
        <div className="flex gap-1">
          {(["document", "own"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAgainst(mode)}
              className={`kb-pill text-xs ${against === mode ? "kb-pill-primary" : "kb-pill-ghost"}`}
            >
              {mode === "document" ? "Against an invoice" : "Type what is going"}
            </button>
          ))}
        </div>
      </div>

      {against === "document" ? (
        <label className="mt-3 block text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Which document</span>
          <select name="transactionId" required className="kb-input mt-1 w-full text-sm">
            <option value="">Choose…</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[var(--kb-text-dim)]">
            The note starts with everything on it that has not gone out yet.
          </span>
        </label>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block text-xs">
            <span className="font-medium text-[var(--kb-text-dim)]">Customer</span>
            <select name="partyId" required className="kb-input mt-1 w-full text-sm">
              <option value="">Choose…</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1 text-xs">
                <span className="font-medium text-[var(--kb-text-dim)]">What is going</span>
                <input
                  name="lineDescription"
                  value={line.description}
                  onChange={(e) => setLines(lines.map((l, j) => (i === j ? { ...l, description: e.target.value } : l)))}
                  placeholder="Pallet wrap, 500m rolls"
                  className="kb-input mt-1 w-full text-sm"
                />
              </label>
              <label className="w-24 text-xs">
                <span className="font-medium text-[var(--kb-text-dim)]">How many</span>
                <input
                  name="lineQuantity"
                  value={line.quantity}
                  onChange={(e) => setLines(lines.map((l, j) => (i === j ? { ...l, quantity: e.target.value } : l)))}
                  inputMode="numeric"
                  className="kb-input mt-1 w-full text-sm"
                />
              </label>
              <label className="w-24 text-xs">
                <span className="font-medium text-[var(--kb-text-dim)]">Unit</span>
                <input
                  name="lineUnit"
                  value={line.unit}
                  onChange={(e) => setLines(lines.map((l, j) => (i === j ? { ...l, unit: e.target.value } : l)))}
                  placeholder="each"
                  className="kb-input mt-1 w-full text-sm"
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines([...lines, { description: "", quantity: "1", unit: "" }])}
            className="kb-pill kb-pill-ghost text-xs"
          >
            + Another line
          </button>
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Deliver to</span>
          <input name="deliveryAddress" placeholder="Leave blank for their address on file" className="kb-input mt-1 w-full text-sm" />
        </label>
        <label className="text-xs">
          <span className="font-medium text-[var(--kb-text-dim)]">Their reference</span>
          <input name="reference" placeholder="Order number, if they gave one" className="kb-input mt-1 w-full text-sm" />
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="font-medium text-[var(--kb-text-dim)]">Anything the driver should know</span>
          <input name="notes" placeholder="Gate code, delivery window, who to ask for" className="kb-input mt-1 w-full text-sm" />
        </label>
      </div>

      <div className="mt-4 flex justify-end">
        <SubmitButton pendingText="Writing…">Write the note</SubmitButton>
      </div>
    </form>
  );
}
