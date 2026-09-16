"use client";

// Signing it.
//
// Two things the quote signature does not ask for and a contract must: the
// name of the person signing, and that they say they are allowed to. A drawn
// squiggle on its own identifies nobody, and "who signed this?" is the first
// question anybody asks of a contract that later goes wrong.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { declineAgreementAction, signAgreementAction } from "./actions";

export function SignAgreement({ token, agreementId, defaultName }: { token: string; agreementId: string; defaultName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [authorised, setAuthorised] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c2333";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function run(action: (fd: FormData) => Promise<void>, extra?: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("token", token);
      formData.set("agreementId", agreementId);
      for (const [k, v] of Object.entries(extra ?? {})) formData.set(k, v);
      await action(formData);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const ready = hasDrawn && name.trim().length > 1 && authorised;

  return (
    <div>
      <p className="text-sm font-medium text-[var(--kb-text)]">Sign this agreement</p>
      <label className="mt-2 block text-xs text-[var(--kb-text-dim)]">
        Your full name
        <input value={name} onChange={(e) => setName(e.target.value)} className="kb-input mt-1 w-full text-sm" />
      </label>
      <canvas
        ref={canvasRef}
        width={500}
        height={150}
        className="mt-3 w-full touch-none rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)]"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)}
      />
      <label className="mt-3 flex items-start gap-2 text-xs text-[var(--kb-text-dim)]">
        <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} className="mt-0.5" />
        <span>I have read this agreement and I am authorised to sign it.</span>
      </label>

      {error && <p className="mt-2 text-xs" style={{ color: "var(--kb-status-danger-ink)" }}>{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => run(signAgreementAction, { signerName: name, signature: canvasRef.current!.toDataURL("image/png") })}
          className="kb-pill kb-pill-primary text-xs"
        >
          {busy ? "Signing…" : "Sign it"}
        </button>
        <button type="button" onClick={clear} disabled={busy} className="kb-pill kb-pill-ghost text-xs">
          Clear signature
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(declineAgreementAction)}
          className="kb-pill kb-pill-ghost text-xs"
          style={{ color: "var(--kb-status-danger-ink)" }}
        >
          I am not signing this
        </button>
      </div>
    </div>
  );
}
