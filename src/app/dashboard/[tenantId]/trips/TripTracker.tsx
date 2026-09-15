"use client";

// Records where the phone goes while a trip is underway, and nothing else.
//
// Runs only while this page is open in the foreground — the web view has no
// background access to the phone's position, and that limit is honest: the
// tracking stops when the person stops looking at it. Distance is derived on
// the server when the trip ends; the points themselves are never shown here
// or anywhere.
//
// Consent is a dated fact on the person's own record, given once, withdrawn
// with one tap, and the server refuses points without it whatever this
// component sends.

import { useEffect, useRef, useState } from "react";
import { appendPointsAction, consentAction } from "./actions";

const BATCH_EVERY_MS = 30_000;

export function TripTracker({
  tenantId,
  tripId,
  hasConsent,
}: {
  tenantId: string;
  tripId: string | null;
  hasConsent: boolean;
}) {
  // "off" is derived, never set: the effect below only runs while a trip is
  // underway with consent, and everything it reports is a result of that.
  const [status, setStatus] = useState<"waiting" | "tracking" | "unsupported" | "denied" | "error">("waiting");
  const [sent, setSent] = useState(0);
  const buffer = useRef<Array<{ at: string; lat: number; lng: number; accuracyM: number | null }>>([]);
  const active = Boolean(tripId && hasConsent);

  useEffect(() => {
    if (!active || !tripId) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // Reported from the geolocation API's own callback path, not synchronously.
      queueMicrotask(() => setStatus("unsupported"));
      return;
    }

    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        buffer.current.push({
          at: new Date(pos.timestamp).toISOString(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        });
        setStatus("tracking");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );

    const flush = async () => {
      if (buffer.current.length === 0) return;
      const batch = buffer.current.splice(0, buffer.current.length);
      try {
        const r = await appendPointsAction(tenantId, tripId, batch);
        setSent((n) => n + r.added);
      } catch {
        // Keep the points for the next attempt rather than losing them.
        buffer.current.unshift(...batch);
        setStatus("error");
      }
    };
    const timer = setInterval(flush, BATCH_EVERY_MS);

    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
      void flush();
    };
  }, [tenantId, tripId, active]);

  if (!hasConsent) {
    return (
      <div className="kb-card px-4 py-3 text-xs">
        <p className="font-medium text-[var(--kb-text)]">Record my movement on trips</p>
        <p className="mt-1 text-[var(--kb-text-dim)]">
          While a trip is underway and this page is open, the position of this phone is recorded so the
          distance is right without anyone typing it. Only the distance is ever used or shown. You can
          switch this off at any time.
        </p>
        <button
          type="button"
          onClick={() => consentAction(tenantId, true)}
          className="kb-pill kb-pill-primary mt-2 text-xs"
        >
          I agree
        </button>
      </div>
    );
  }

  const line =
    !active
      ? tripId
        ? "Waiting for a position…"
        : "Starts recording when a trip is underway."
      : status === "tracking"
      ? `Recording position — ${sent} point${sent === 1 ? "" : "s"} saved.`
      : status === "denied"
        ? "Location is blocked for this site. Allow it in the browser to record distance."
        : status === "unsupported"
          ? "This device cannot report its position."
          : status === "error"
            ? "Could not save the last positions; still trying."
            : "Waiting for a position…";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--kb-text-dim)]">
      <span>
        <span
          className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
          style={{ background: status === "tracking" ? "var(--kb-tint-mint-ink)" : "var(--kb-panel-border)" }}
          aria-hidden="true"
        />
        {line}
      </span>
      <button type="button" onClick={() => consentAction(tenantId, false)} className="underline">
        Stop recording my movement
      </button>
    </div>
  );
}
