"use client";

// Catches any thrown error from a page or server action anywhere under
// /dashboard/[tenantId] and shows something a non-technical business owner
// can actually act on, instead of Next's generic unbranded error screen —
// which, for someone mid-way through recording a payment or approving an
// expense, reads as "the app crashed and I don't know if my data was saved."

import { useEffect } from "react";

export default function TenantErrorBoundary({
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
        <h1 className="mt-2 text-lg font-semibold text-[var(--kb-text)]">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
          {error.message && error.message.length < 200
            ? error.message
            : "This page hit an unexpected error. Nothing was lost — your last saved data is safe."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="kb-pill kb-pill-primary text-xs">
            Try again
          </button>
          <a href="." className="kb-pill kb-pill-ghost text-xs">
            Reload page
          </a>
        </div>
      </div>
    </div>
  );
}
