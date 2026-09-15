"use client";

// Arrived, proof, leaving — recorded on the phone first, sent when it can be.
//
// Every tap writes to a queue kept in this browser with the moment it
// happened and an id made here, then tries to send. With no signal it stays
// queued and goes the moment the connection returns (or the page is next
// opened), and the server applies it at the time it was captured. So the
// arrival time a detention charge is billed on is the time the driver was at
// the gate, not the time they got signal back.
//
// The honest limit: the page has to have been opened while there was signal.
// Once it is open, it works without any.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Capture =
  | { id: string; kind: "stop.arrive" | "stop.depart"; stopId: string; at: string }
  | { id: string; kind: "stop.proof"; stopId: string; at: string; photo?: string | null; signature?: string | null; signedBy?: string | null; notes?: string | null; lat?: number | null; lng?: number | null };

const KEY = (tenantId: string) => `skynat.field.outbox.${tenantId}`;

function readOutbox(tenantId: string): Capture[] {
  try {
    return JSON.parse(localStorage.getItem(KEY(tenantId)) ?? "[]") as Capture[];
  } catch {
    return [];
  }
}

function writeOutbox(tenantId: string, items: Capture[]) {
  try {
    localStorage.setItem(KEY(tenantId), JSON.stringify(items));
  } catch {
    // Storage full or blocked: the capture is still attempted directly below.
  }
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Shrink a camera photo to something a queue can hold: ~1280px JPEG. */
async function compress(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// One sync at a time for the whole page. Every stop on screen uses this hook,
// and without a shared lock they would all send the same queue at once the
// moment the signal came back.
let inFlight: Promise<void> | null = null;

export function useFieldOutbox(tenantId: string) {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [refused, setRefused] = useState<string[]>([]);
  const flush = useCallback(async () => {
    if (inFlight) {
      await inFlight;
      setPending(readOutbox(tenantId).length);
      return;
    }
    const queue = readOutbox(tenantId);
    setPending(queue.length);
    if (queue.length === 0 || !navigator.onLine) return;
    let release = () => {};
    inFlight = new Promise<void>((r) => (release = r));
    try {
      const res = await fetch(`/api/dashboard/${tenantId}/field/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ captures: queue }),
      });
      if (!res.ok) return;
      const { outcomes } = (await res.json()) as { outcomes: Array<{ id: string; status: string; reason?: string }> };
      // Applied and duplicate are done. Refused is done too — resending a
      // capture the server has rejected will not change its answer — but the
      // reason is kept on screen so nobody thinks it was recorded.
      const done = new Set(outcomes.map((o) => o.id));
      const reasons = outcomes.filter((o) => o.status === "refused").map((o) => o.reason ?? "A capture was refused.");
      if (reasons.length) setRefused((r) => [...r, ...reasons].slice(-3));
      const left = readOutbox(tenantId).filter((c) => !done.has(c.id));
      writeOutbox(tenantId, left);
      setPending(left.length);
      router.refresh();
    } catch {
      /* still offline — try again on the next online event */
    } finally {
      inFlight = null;
      release();
    }
  }, [tenantId, router]);

  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      void flush();
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const timer = setInterval(() => void flush(), 20_000);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      clearInterval(timer);
    };
  }, [flush]);

  const capture = useCallback(
    (c: Omit<Capture, "id" | "at"> & { at?: string }) => {
      const item = { ...c, id: newId(), at: c.at ?? new Date().toISOString() } as Capture;
      writeOutbox(tenantId, [...readOutbox(tenantId), item]);
      setPending((n) => n + 1);
      void flush();
      return item;
    },
    [tenantId, flush]
  );

  return { pending, online, refused, capture, flush };
}

export function SyncStatus({ pending, online }: { pending: number; online: boolean }) {
  if (online && pending === 0) return null;
  return (
    <p className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: online ? "var(--kb-tint-yellow)" : "var(--kb-tint-peach)", color: online ? "var(--kb-tint-yellow-ink)" : "var(--kb-tint-peach-ink)" }}>
      {online
        ? `Sending ${pending} capture${pending === 1 ? "" : "s"}…`
        : `No signal — ${pending} capture${pending === 1 ? "" : "s"} saved on this phone and will send when it returns.`}
    </p>
  );
}

export function StopCapture({
  tenantId,
  stopId,
  label,
  arrivedAt,
  departedAt,
  hasProof,
}: {
  tenantId: string;
  stopId: string;
  label: string;
  arrivedAt: string | null;
  departedAt: string | null;
  hasProof: boolean;
}) {
  const { pending, online, refused, capture } = useFieldOutbox(tenantId);
  // Local echo, so the button reflects the tap immediately with no signal.
  const [arrived, setArrived] = useState<string | null>(arrivedAt);
  const [departed, setDeparted] = useState<string | null>(departedAt);
  const [proofDone, setProofDone] = useState(hasProof);
  const [proofOpen, setProofOpen] = useState(false);

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "");

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          {label}
          <span className="ml-2 text-xs text-[var(--kb-text-dim)]">
            {arrived ? `arrived ${time(arrived)}` : ""}
            {departed ? ` · left ${time(departed)}` : ""}
            {proofDone ? " · proof ✓" : ""}
          </span>
        </span>
        <span className="flex flex-wrap gap-1">
          {!arrived && (
            <button type="button" className="kb-pill kb-pill-ghost !py-1 text-[11px]" onClick={() => { const c = capture({ kind: "stop.arrive", stopId }); setArrived(c.at); }}>
              Arrived
            </button>
          )}
          {arrived && !proofDone && (
            <button type="button" className="kb-pill kb-pill-ghost !py-1 text-[11px]" onClick={() => setProofOpen((o) => !o)}>
              Proof
            </button>
          )}
          {arrived && !departed && (
            <button type="button" className="kb-pill kb-pill-ghost !py-1 text-[11px]" onClick={() => { const c = capture({ kind: "stop.depart", stopId }); setDeparted(c.at); }}>
              Leaving
            </button>
          )}
        </span>
      </div>
      {proofOpen && (
        <ProofForm
          onCancel={() => setProofOpen(false)}
          onDone={(p) => {
            capture({ kind: "stop.proof", stopId, ...p });
            setProofDone(true);
            setProofOpen(false);
          }}
        />
      )}
      {(pending > 0 || !online) && <SyncStatus pending={pending} online={online} />}
      {refused.map((r, i) => (
        <p key={i} className="text-[11px]" style={{ color: "var(--kb-tint-peach-ink)" }}>Not recorded: {r}</p>
      ))}
    </div>
  );
}

function ProofForm({
  onDone,
  onCancel,
}: {
  onDone: (p: { photo: string | null; signature: string | null; signedBy: string | null; notes: string | null; lat: number | null; lng: number | null }) => void;
  onCancel: () => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [signedBy, setSignedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * e.currentTarget.width) / r.width, y: ((e.clientY - r.top) * e.currentTarget.height) / r.height };
  };

  return (
    <div className="rounded-lg border border-[var(--kb-panel-border)] p-3">
      <label className="block text-xs">
        <span className="text-[var(--kb-text-dim)]">Photograph</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="mt-1 block text-xs"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setPhoto(await compress(f));
          }}
        />
      </label>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="Proof" className="mt-2 max-h-32 rounded" />
      )}
      <p className="mt-3 text-xs text-[var(--kb-text-dim)]">Signature</p>
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        className="mt-1 w-full touch-none rounded border border-[var(--kb-panel-border)] bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = e.currentTarget.getContext("2d")!;
          const { x, y } = point(e);
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#111";
          ctx.beginPath();
          ctx.moveTo(x, y);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const { x, y } = point(e);
          ctx.lineTo(x, y);
          ctx.stroke();
          setSigned(true);
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Name of person signing" className="kb-input text-sm" />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" className="kb-input text-sm" />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--kb-text-dim)]">{pos ? "Position recorded" : "Finding position…"}</span>
        <span className="flex gap-2">
          <button type="button" onClick={onCancel} className="kb-pill kb-pill-ghost !py-1 text-xs">Cancel</button>
          <button
            type="button"
            disabled={!photo && !signed}
            onClick={() =>
              onDone({
                photo,
                signature: signed ? canvasRef.current!.toDataURL("image/png") : null,
                signedBy: signedBy.trim() || null,
                notes: notes.trim() || null,
                lat: pos?.lat ?? null,
                lng: pos?.lng ?? null,
              })
            }
            className="kb-pill kb-pill-primary !py-1 text-xs disabled:opacity-50"
          >
            Save proof
          </button>
        </span>
      </div>
    </div>
  );
}
