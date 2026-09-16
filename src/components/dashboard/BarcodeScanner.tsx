"use client";

// Scanning a barcode with the phone's camera.
//
// The till and the stocktake both live or die on this: typing a thirteen-digit
// number off a tin, twice, while somebody waits, is how a stocktake stops
// happening. A phone camera is a perfectly good scanner, and Chrome and
// Android have had a built-in decoder since 2019.
//
// Safari does not. That is not something to paper over with a three-hundred
// kilobyte decoder shipped to everybody — it is something to say, alongside
// the box they can type into instead, which every one of these screens has
// anyway. A feature that degrades to the thing that already works is better
// than one that degrades to a spinner.

import { useEffect, useRef, useState } from "react";

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string; format: string }>>;
};

type WithDetector = typeof globalThis & {
  BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
};

export function scanningSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function BarcodeScanner({ onScanned }: { onScanned: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(scanningSupported());
  }, []);

  useEffect(() => {
    if (!running) return;

    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    (async () => {
      try {
        const Detector = (globalThis as WithDetector).BarcodeDetector;
        if (!Detector) throw new Error("This browser has no barcode reader.");

        const detector = new Detector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
        });

        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera. Without this a laptop-shaped phone browser opens
          // the selfie camera and nobody can scan anything.
          video: { facingMode: "environment" },
        });
        if (stopped) return;
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }

        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            if (found.length > 0) {
              onScanned(found[0].rawValue);
              setRunning(false);
              return;
            }
          } catch {
            // A frame that cannot be decoded is the normal case, not an error.
          }
          frame = requestAnimationFrame(() => void tick());
        };
        void tick();
      } catch (e) {
        setError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "The camera was not allowed. Type the code in instead, or allow the camera in your browser's settings."
            : e instanceof Error
              ? e.message
              : "Could not start the camera.",
        );
        setRunning(false);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [running, onScanned]);

  if (!supported) {
    return (
      <p className="text-[11px] text-[var(--kb-text-dim)]">
        This browser cannot read barcodes with the camera — Safari is the usual one. Type the code into the box instead;
        it does exactly the same thing.
      </p>
    );
  }

  return (
    <div>
      {running ? (
        <div>
          <video ref={video} playsInline muted className="w-full max-w-sm rounded-xl border border-[var(--kb-panel-border)]" />
          <button type="button" onClick={() => setRunning(false)} className="kb-pill kb-pill-ghost mt-2 text-xs">
            Stop
          </button>
          <p className="mt-1 text-[11px] text-[var(--kb-text-dim)]">Hold the barcode steady in the frame.</p>
        </div>
      ) : (
        <button type="button" onClick={() => setRunning(true)} className="kb-pill kb-pill-primary text-xs">
          Scan with the camera
        </button>
      )}
      {error && <p className="mt-1 text-[11px] text-[var(--kb-tint-rose-ink)]">{error}</p>}
    </div>
  );
}
