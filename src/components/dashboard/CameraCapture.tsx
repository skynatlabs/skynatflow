"use client";

// Photographing a slip, on the phone that is already in their hand.
//
// The thing this replaces is a shoebox. A cost captured at the till is a cost
// that can be coded, apportioned and claimed; one photographed in March off a
// faded roll of paper is neither, and most small businesses lose real money
// to exactly that.
//
// Two decisions worth stating. It uses a plain file input with `capture`
// rather than getUserMedia and a canvas: the file input opens the phone's own
// camera app, which focuses better, handles low light better and is the thing
// the person already knows how to use. And it shrinks the picture before it
// is sent, because a modern phone produces a four-megabyte photograph and a
// slip needs perhaps two hundred kilobytes to be readable — the difference is
// the whole of whether this works on a bad signal.

import { useRef, useState } from "react";

/** Long edge, in pixels. Enough to read a slip, small enough to send on 3G. */
const MAX_EDGE = 1600;
const QUALITY = 0.75;

export interface Captured {
  dataUrl: string;
  bytes: number;
  originalBytes: number;
}

async function shrink(file: File): Promise<Captured> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize the picture.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  return {
    dataUrl,
    // The base64 overhead is a third, which matters when the limit is about
    // what will actually upload rather than what will fit.
    bytes: Math.round((dataUrl.length * 3) / 4),
    originalBytes: file.size,
  };
}

export function CameraCapture({
  label = "Photograph the slip",
  onCaptured,
}: {
  label?: string;
  onCaptured: (captured: Captured) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Captured | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const captured = await shrink(file);
      setPreview(captured);
      onCaptured(captured);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        // Opens the camera on a phone and the file picker on a desktop, which
        // is the right behaviour on both without asking which one this is.
        capture="environment"
        hidden
        onChange={(event) => handle(event.target.files?.[0])}
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="kb-pill kb-pill-primary text-xs disabled:opacity-50"
      >
        {busy ? "Reading…" : preview ? "Take another" : label}
      </button>

      {preview && (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.dataUrl} alt="The slip you photographed" className="max-h-56 rounded-xl border border-[var(--kb-panel-border)]" />
          <p className="mt-1 text-[11px] text-[var(--kb-text-dim)]">
            {Math.round(preview.bytes / 1024)} KB, down from {Math.round(preview.originalBytes / 1024)} KB — small enough to
            send on a bad signal and still readable.
          </p>
        </div>
      )}

      {error && <p className="mt-1 text-[11px] text-[var(--kb-tint-rose-ink)]">{error}</p>}
    </div>
  );
}
