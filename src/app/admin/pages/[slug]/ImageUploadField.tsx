"use client";

import { useRef, useState } from "react";

export default function ImageUploadField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const url = value;

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/admin/cms/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onChange(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {label && <label className="text-xs font-medium text-[var(--kb-text-dim)]">{label}</label>}
      <div className="mt-1 flex items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-14 w-14 rounded-md border border-[var(--kb-panel-border)] object-cover" />
        ) : (
          <div className="h-14 w-14 rounded-md border border-dashed border-[var(--kb-panel-border)]" />
        )}
        <div>
          <button
            type="button"
            className="kb-pill kb-pill-ghost !py-1 !px-3 text-xs"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? "Uploading…" : url ? "Replace image" : "Upload image"}
          </button>
          {url && (
            <button
              type="button"
              className="ml-2 text-xs text-[var(--kb-text-dim)] hover:text-[var(--kb-text)]"
              onClick={() => onChange("")}
            >
              Remove
            </button>
          )}
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
