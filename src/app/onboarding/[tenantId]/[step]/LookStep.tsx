"use client";

// The logo, and what every document goes out looking like.
//
// The first quote a customer sees decides whether this looks like a real
// business. If the letterhead or the website already gave up a logo, it is
// here waiting; otherwise it is one upload.

import { useEffect, useRef, useState } from "react";
import { saveLookAction } from "../../actions";
import { adoptPending } from "../../pending";

export interface StyleOption {
  key: string;
  label: string;
  family: string;
}

const MAX_LOGO_BYTES = 1_500_000;

export function LookStep({
  tenantId,
  styles,
  currentLogo,
  currentStyle,
  businessName,
}: {
  tenantId: string;
  styles: StyleOption[];
  currentLogo: string | null;
  currentStyle: string | null;
  businessName: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<string | null>(currentLogo);
  const [style, setStyle] = useState(currentStyle ?? styles[0]?.key ?? "minimal-mono");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentLogo) return;
    const waiting = adoptPending(tenantId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session storage is only readable after mount
    if (waiting.logoDataUrl?.value) setLogo(waiting.logoDataUrl.value);
  }, [tenantId, currentLogo]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("A logo has to be an image — PNG or JPEG.");
      return;
    }
    // Squared off to 512px: big enough for print, small enough to carry on
    // every document without weighing them down.
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      bitmap.close?.();
      if (dataUrl.length > MAX_LOGO_BYTES) {
        setError("That image is very large. A smaller one works better on a document.");
        return;
      }
      setLogo(dataUrl);
    } catch {
      setError("That image could not be read. Try a PNG or a JPEG.");
    }
  }

  return (
    <form action={saveLookAction.bind(null, tenantId)} className="space-y-4">
      <input type="hidden" name="logoDataUrl" value={logo ?? ""} />

      <div className="kb-card p-5">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">Your logo</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div
            className="flex h-24 w-40 items-center justify-center rounded-xl border border-[var(--kb-panel-border)] bg-white p-2"
            aria-label="Logo preview"
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL the owner just chose, never a remote image
              <img src={logo} alt={`${businessName} logo`} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-[var(--kb-text-dim)]">No logo yet</span>
            )}
          </div>
          <div>
            <button type="button" onClick={() => fileRef.current?.click()} className="kb-pill kb-pill-ghost text-xs">
              {logo ? "Choose a different one" : "Upload your logo"}
            </button>
            {logo && (
              <button type="button" onClick={() => setLogo(null)} className="ml-2 text-xs text-[var(--kb-text-dim)] underline">
                Remove
              </button>
            )}
            <p className="mt-2 max-w-xs text-xs text-[var(--kb-text-dim)]">
              It goes on every quote, invoice and statement. You can change it later under Settings.
            </p>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        {error && <p className="mt-2 text-xs text-[var(--kb-tint-peach-ink)]">{error}</p>}
      </div>

      <div className="kb-card p-5">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">The layout</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {styles.map((s) => (
            <label
              key={s.key}
              className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs transition"
              style={{
                borderColor: style === s.key ? "var(--kb-accent-a)" : "var(--kb-panel-border)",
                background: style === s.key ? "var(--kb-tint-violet)" : "transparent",
              }}
            >
              <input type="radio" name="styleKey" value={s.key} checked={style === s.key} onChange={() => setStyle(s.key)} className="mt-0.5" />
              <span>
                <span className="block font-semibold text-[var(--kb-text)]">{s.label}</span>
                <span className="block text-[var(--kb-text-dim)]">{s.family}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="kb-pill kb-pill-primary px-6 py-3 text-sm">
          Done — meet the officers
        </button>
      </div>
    </form>
  );
}
