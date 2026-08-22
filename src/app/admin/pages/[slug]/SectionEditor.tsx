"use client";

import { useState, useTransition } from "react";
import type { ResolvedSection } from "@/lib/core/cms";
import ImageUploadField from "./ImageUploadField";
import { saveSectionAction } from "./actions";

interface ItemFields {
  title?: string;
  body?: string;
  imageUrl?: string;
  href?: string;
  name?: string;
  role?: string;
}

// Which item fields to show per section type — matches how SectionRenderer
// interprets `items` for each type (see components/marketing/sections).
const ITEM_FIELDS: Record<string, { key: keyof ItemFields; label: string; type: "text" | "textarea" | "image" }[]> = {
  grid: [
    { key: "imageUrl", label: "Icon / image", type: "image" },
    { key: "title", label: "Title", type: "text" },
    { key: "body", label: "Body", type: "textarea" },
  ],
  testimonials: [
    { key: "body", label: "Quote", type: "textarea" },
    { key: "imageUrl", label: "Photo", type: "image" },
    { key: "name", label: "Name", type: "text" },
    { key: "role", label: "Role / company", type: "text" },
  ],
  logos: [
    { key: "imageUrl", label: "Logo", type: "image" },
    { key: "title", label: "Name", type: "text" },
    { key: "href", label: "Link (optional)", type: "text" },
  ],
  cards: [
    { key: "imageUrl", label: "Image", type: "image" },
    { key: "title", label: "Title", type: "text" },
    { key: "body", label: "Body", type: "textarea" },
    { key: "href", label: "Link (optional)", type: "text" },
  ],
};

const HAS_ITEMS = new Set(["grid", "testimonials", "logos", "cards"]);
const HAS_HEADING = new Set(["hero", "richText", "imageText", "grid", "testimonials", "logos", "cards", "cta"]);
const HAS_SUBHEADING = new Set(["hero", "grid", "cards"]);
const HAS_BODY = new Set(["richText", "imageText", "cta"]);
const HAS_TOP_IMAGE = new Set(["hero", "imageText"]);
const HAS_CTA = new Set(["hero", "cta"]);

export default function SectionEditor({ slug, section }: { slug: string; section: ResolvedSection }) {
  const [heading, setHeading] = useState(section.heading ?? "");
  const [subheading, setSubheading] = useState(section.subheading ?? "");
  const [body, setBody] = useState(section.body ?? "");
  const [imageUrl, setImageUrl] = useState(section.imageUrl ?? "");
  const [ctaLabel, setCtaLabel] = useState(section.ctaLabel ?? "");
  const [ctaHref, setCtaHref] = useState(section.ctaHref ?? "");
  const [items, setItems] = useState<ItemFields[]>((section.items as ItemFields[]) ?? []);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function updateItem(index: number, patch: Partial<ItemFields>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function submit() {
    const formData = new FormData();
    formData.set("slug", slug);
    formData.set("key", section.key);
    formData.set("heading", heading);
    formData.set("subheading", subheading);
    formData.set("body", body);
    formData.set("imageUrl", imageUrl);
    formData.set("ctaLabel", ctaLabel);
    formData.set("ctaHref", ctaHref);
    formData.set("items", JSON.stringify(items));
    startTransition(async () => {
      await saveSectionAction(formData);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  const itemFields = ITEM_FIELDS[section.type] ?? [];

  return (
    <div className="kb-card p-5">
      <p className="font-semibold text-[var(--kb-text)]">{section.label}</p>

      <div className="mt-4 flex flex-col gap-4">
        {HAS_HEADING.has(section.type) && (
          <TextField label="Heading" value={heading} onChange={setHeading} />
        )}
        {HAS_SUBHEADING.has(section.type) && (
          <TextField label="Subheading" value={subheading} onChange={setSubheading} textarea />
        )}
        {HAS_BODY.has(section.type) && (
          <TextField label="Body" value={body} onChange={setBody} textarea />
        )}
        {HAS_TOP_IMAGE.has(section.type) && (
          <ImageUploadField label="Image" value={imageUrl} onChange={setImageUrl} />
        )}
        {HAS_CTA.has(section.type) && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Button label" value={ctaLabel} onChange={setCtaLabel} />
            <TextField label="Button link" value={ctaHref} onChange={setCtaHref} />
          </div>
        )}

        {HAS_ITEMS.has(section.type) && (
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--kb-text-dim)]">Items</label>
              <button
                type="button"
                className="kb-pill kb-pill-ghost !py-1 !px-3 text-xs"
                onClick={() => setItems((prev) => [...prev, {}])}
              >
                + Add item
              </button>
            </div>
            <div className="mt-2 flex flex-col gap-3">
              {items.map((item, i) => (
                <div key={i} className="rounded-lg border border-[var(--kb-panel-border)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--kb-text-dim)]">Item {i + 1}</span>
                    <button
                      type="button"
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 flex flex-col gap-3">
                    {itemFields.map((f) =>
                      f.type === "image" ? (
                        <ImageUploadField
                          key={f.key}
                          label={f.label}
                          value={item[f.key] ?? ""}
                          onChange={(url) => updateItem(i, { [f.key]: url })}
                        />
                      ) : (
                        <TextField
                          key={f.key}
                          label={f.label}
                          value={item[f.key] ?? ""}
                          onChange={(v) => updateItem(i, { [f.key]: v })}
                          textarea={f.type === "textarea"}
                        />
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          className="kb-pill kb-pill-primary !py-1.5 !px-4 text-sm"
          disabled={isPending}
          onClick={submit}
        >
          {isPending ? "Saving…" : "Save section"}
        </button>
        {saved && <span className="text-xs text-[var(--kb-tint-mint-ink)]">Saved</span>}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--kb-text-dim)]">{label}</span>
      {textarea ? (
        <textarea
          className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm text-[var(--kb-text)]"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm text-[var(--kb-text)]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
