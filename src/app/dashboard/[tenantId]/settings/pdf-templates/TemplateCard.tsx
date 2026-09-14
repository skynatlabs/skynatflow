"use client";

// One template in the gallery, shown as what it actually produces.
//
// A row of names told you nothing — you had to open each one to remember
// which was which. The thumbnail is the real preview route in a scaled
// iframe, so a card can never show a design the renderer no longer makes.
//
// The iframe is inert: pointer-events off, so the whole card stays one click
// target rather than the PDF viewer swallowing it.

import Link from "next/link";
import { useState } from "react";

export function TemplateCard({
  tenantId,
  templateId,
  name,
  styleLabel,
  appliesTo,
  isDefault,
  makeDefault,
  remove,
}: {
  tenantId: string;
  templateId: string;
  name: string;
  styleLabel: string;
  appliesTo: string;
  isDefault: boolean;
  makeDefault: React.ReactNode;
  remove: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const href = `/dashboard/${tenantId}/settings/pdf-templates/${templateId}`;

  return (
    <div
      className="group relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="relative overflow-hidden rounded-xl border bg-white transition"
        style={{
          borderColor: isDefault ? "var(--kb-accent-a)" : "var(--kb-panel-border)",
          height: "19rem",
        }}
      >
        <iframe
          src={`/api/dashboard/${tenantId}/pdf-templates/${templateId}/preview#toolbar=0&navpanes=0&view=FitH`}
          title={`${name} preview`}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{ width: "250%", height: "250%", transform: "scale(0.4)" }}
        />

        {/* The whole card is the link; the thumbnail underneath is decoration. */}
        <Link href={href} className="absolute inset-0" aria-label={`Edit ${name}`} />

        {isDefault && (
          <span
            className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--kb-accent-a)" }}
          >
            Default
          </span>
        )}

        {hover && (
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-black/70 p-2.5">
            <Link href={href} className="kb-pill kb-pill-primary text-[11px]">
              Edit
            </Link>
            {makeDefault}
            {remove}
          </div>
        )}
      </div>

      <p className="mt-2 truncate text-sm font-medium text-[var(--kb-text)]">{name}</p>
      <p className="truncate text-[11px] text-[var(--kb-text-dim)]">
        {styleLabel}
        {appliesTo && appliesTo !== "ALL" && ` · ${appliesTo.toLowerCase()}s only`}
      </p>
    </div>
  );
}
