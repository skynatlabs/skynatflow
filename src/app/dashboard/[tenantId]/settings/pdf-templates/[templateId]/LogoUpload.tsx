"use client";

// Setting a logo.
//
// The settings page has promised "your own accent color and logo" since it
// shipped, and `logoDataUrl` has been in the schema and honoured by the
// renderer the whole time — there was simply nowhere to set one. This is that
// missing control.
//
// The file is read to a data URL in the browser and posted as text, matching
// how the renderer consumes it: react-pdf embeds the image inline, so there is
// no file to store and no URL for it to fetch at render time.

import { useRef, useState } from "react";
import { saveLogoAction } from "./actions";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export function LogoUpload({
  tenantId,
  templateId,
  current,
}: {
  tenantId: string;
  templateId: string;
  current: string | null;
}) {
  const [dataUrl, setDataUrl] = useState<string>(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function read(file: File) {
    setError(null);
    if (!/^image\/(png|jpeg|jpg)$/i.test(file.type)) {
      setError("Use a PNG or JPG.");
      return;
    }
    if (file.size > 1_000_000) {
      setError("That image is over 1MB — try a smaller one.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDataUrl(String(reader.result ?? ""));
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsDataURL(file);
  }

  return (
    <form action={saveLogoAction} className="space-y-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="logoDataUrl" value={dataUrl} />

      <div className="flex items-center gap-3">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt="Your logo"
            className="h-12 w-12 rounded-lg border border-[var(--kb-panel-border)] object-contain"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-[var(--kb-panel-border)] text-[10px] text-[var(--kb-text-dim)]">
            None
          </span>
        )}

        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) read(file);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="kb-pill kb-pill-ghost text-xs"
          >
            {dataUrl ? "Change image" : "Choose image"}
          </button>
          {dataUrl && (
            <button
              type="button"
              onClick={() => setDataUrl("")}
              className="text-xs text-[var(--kb-text-dim)] hover:underline"
            >
              Remove
            </button>
          )}
          <SubmitButton className="kb-pill kb-pill-primary text-xs" pendingText="Saving…">
            Save logo
          </SubmitButton>
        </div>
      </div>

      {error && <p className="text-xs" style={{ color: "var(--kb-status-danger-ink)" }}>{error}</p>}
    </form>
  );
}
