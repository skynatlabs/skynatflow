"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { acceptQuoteAction, declineQuoteAction } from "./actions";

export function SignatureCapture({ token, quoteId }: { token: string; quoteId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

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

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function accept() {
    if (!hasDrawn) {
      setError("Please sign in the box first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const signature = canvasRef.current!.toDataURL("image/png");
      const formData = new FormData();
      formData.set("token", token);
      formData.set("quoteId", quoteId);
      formData.set("signature", signature);
      await acceptQuoteAction(formData);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("token", token);
      formData.set("quoteId", quoteId);
      await declineQuoteAction(formData);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-[var(--kb-text)]">Sign to accept</p>
      <canvas
        ref={canvasRef}
        width={500}
        height={160}
        className="mt-2 w-full touch-none rounded-xl border border-[var(--kb-panel-border)] bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="kb-pill kb-pill-primary"
        >
          {busy ? "Saving..." : "Accept quote"}
        </button>
        <button type="button" onClick={clear} disabled={busy} className="kb-pill kb-pill-ghost">
          Clear signature
        </button>
        <button
          type="button"
          onClick={decline}
          disabled={busy}
          className="kb-pill kb-pill-ghost text-red-500"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
