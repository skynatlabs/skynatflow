"use client";

// Same as the dashboard error boundary, but this one is seen by an actual
// paying customer viewing a quote/invoice — needs to look trustworthy, not
// like the whole business's software is broken.

import { useEffect } from "react";

export default function PortalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center p-8 text-center">
      <div className="kb-card w-full p-6">
        <p className="text-2xl">⚠️</p>
        <h1 className="mt-2 text-lg font-semibold text-[var(--kb-text)]">This page couldn't load</h1>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
          Something went wrong on our end. Please try again — if it keeps happening, contact the
          business that sent you this link.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="kb-pill kb-pill-primary text-xs">
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
