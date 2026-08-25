"use client";

// "Paste a link, we set most of it up" — reduces onboarding friction by
// prefilling the form below instead of a blank page. Talks to the form via
// plain DOM ids rather than lifting the whole form into this component, to
// keep the existing server-rendered form (and its action) untouched.

import { useState } from "react";

export default function PrefillAssist() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handlePrefill() {
    if (!url.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/onboarding/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!data.prefill) {
        setMessage(data.error ?? "Couldn't read that site — fill it in manually below.");
        return;
      }

      const { businessName, suggestedNiche, suggestedCatalogItems } = data.prefill;

      if (businessName) {
        const nameInput = document.getElementById("businessName-input") as HTMLInputElement | null;
        if (nameInput) nameInput.value = businessName;
      }
      if (suggestedNiche) {
        const radio = document.getElementById(`niche-${suggestedNiche}`) as HTMLInputElement | null;
        if (radio) radio.checked = true;
      }
      const hiddenItems = document.getElementById("catalogItemsJson-input") as HTMLInputElement | null;
      if (hiddenItems && suggestedCatalogItems?.length) {
        hiddenItems.value = JSON.stringify(suggestedCatalogItems);
      }

      setMessage(
        businessName
          ? `Filled in from ${businessName} — check it over and adjust anything before continuing.`
          : "Got some details — check the form below and adjust anything before continuing."
      );
    } catch {
      setMessage("Couldn't reach that site — fill it in manually below.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="kb-card mb-4 p-4">
      <p className="text-sm font-medium text-[var(--kb-text)]">Have a website? Paste the link.</p>
      <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
        We'll pull your business name, type, and a few products to get you started faster.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourbusiness.com"
          className="flex-1 rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none"
        />
        <button
          type="button"
          onClick={handlePrefill}
          disabled={loading}
          className="kb-pill kb-pill-ghost text-xs shrink-0"
        >
          {loading ? "Reading…" : "Autofill"}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{message}</p>}
    </div>
  );
}
