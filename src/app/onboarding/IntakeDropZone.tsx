"use client";

// Hand over what you already have.
//
// One place that takes a registration certificate, last month's invoice, the
// price list in Excel, a photograph of the stock book, a web address, or a
// sentence typed in — and hands back what it read for confirmation.
//
// Photographs are shrunk here, in the browser. A phone camera produces four
// to eight megabytes a picture; nothing in the reading needs more than about
// two thousand pixels across, and sending the full frame is a slow upload on
// a mobile connection for no gain.

import { useRef, useState } from "react";
import type { Proposal } from "@/lib/onboarding/proposal";

const MAX_EDGE = 2200;
const SHRINK_OVER_BYTES = 900 * 1024;

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < SHRINK_OVER_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    bitmap.close?.();
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    // A format the browser cannot decode (an iPhone HEIC, usually) goes up as
    // it is, and the server says something useful about it.
    return file;
  }
}

export interface IntakeDropZoneProps {
  tenantId?: string;
  onRead: (proposal: Proposal) => void;
  /** What this particular step is asking for. */
  hint: string;
  /** Show the "paste your website" line — only worth it before there is a business. */
  askForWebsite?: boolean;
  /** Show the "or just tell me" box. */
  askForWords?: boolean;
  accept?: string;
}

export function IntakeDropZone({ tenantId, onRead, hint, askForWebsite = false, askForWords = false, accept }: IntakeDropZoneProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [website, setWebsite] = useState("");
  const [words, setWords] = useState("");

  async function send(payload: { files?: File[]; url?: string; text?: string }, label: string) {
    setError(null);
    setBusy(label);
    try {
      const body = new FormData();
      if (tenantId) body.append("tenantId", tenantId);
      for (const file of payload.files ?? []) body.append("files", await shrink(file));
      if (payload.url) body.append("url", payload.url);
      if (payload.text) body.append("text", payload.text);

      const res = await fetch("/api/onboarding/read", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.proposal) {
        setError(data.error ?? "That could not be read. Try again, or type it in below.");
        return;
      }
      onRead(data.proposal as Proposal);
      setWebsite("");
      setWords("");
    } catch {
      setError("The upload did not go through. Check your signal and try again.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  const pick = (files: FileList | null) => {
    const list = files ? [...files] : [];
    if (list.length) void send({ files: list }, list.length === 1 ? `Reading ${list[0].name}…` : `Reading ${list.length} files…`);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files);
        }}
        className="rounded-xl border-2 border-dashed p-5 text-center transition"
        style={{
          borderColor: over ? "var(--kb-accent-a)" : "var(--kb-panel-border)",
          background: over ? "var(--kb-tint-blue)" : "var(--kb-panel)",
        }}
      >
        <p className="text-sm font-medium text-[var(--kb-text)]">{hint}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--kb-text-dim)]">
          PDFs, photographs, Excel and CSV. Drop them here — I read them and show you what I found before anything is saved.
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)} className="kb-pill kb-pill-primary text-xs">
            Choose files
          </button>
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={Boolean(busy)} className="kb-pill kb-pill-ghost text-xs sm:hidden">
            Take a photo
          </button>
          {busy && <span className="text-xs text-[var(--kb-text-dim)]">{busy}</span>}
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept={accept ?? ".pdf,.csv,.tsv,.xlsx,image/*,application/pdf"}
          onChange={(e) => pick(e.target.files)}
        />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files)} />
      </div>

      {askForWebsite && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="Or your website: ndlovulogistics.co.za"
            className="kb-input flex-1 text-sm"
            inputMode="url"
          />
          <button
            type="button"
            disabled={Boolean(busy) || !website.trim()}
            onClick={() => void send({ url: website.trim() }, "Reading your site…")}
            className="kb-pill kb-pill-ghost text-xs"
          >
            Read it
          </button>
        </div>
      )}

      {askForWords && (
        <div className="mt-3">
          <textarea
            value={words}
            onChange={(e) => setWords(e.target.value)}
            rows={2}
            placeholder="Or just tell me: “we deliver pallets across Gauteng, R850 a load, VAT number 4123456789”"
            className="kb-input w-full text-sm"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={Boolean(busy) || words.trim().length < 4}
              onClick={() => void send({ text: words.trim() }, "Taking that down…")}
              className="kb-pill kb-pill-ghost text-xs"
            >
              Take that down
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-[var(--kb-tint-peach-ink)]">{error}</p>}
    </div>
  );
}
