"use client";

// Turning on being told.
//
// The whole flow is three browser calls and four ways to fail, and every one
// of the failures is invisible unless it is said out loud. A person who taps
// this and sees nothing happen concludes the feature is broken, and they are
// not wrong — so each state has words.
//
// The iPhone case is the one worth handling by name: Safari only allows this
// for a site added to the home screen, and there is no way to ask. Telling
// somebody to add it to their home screen first is the difference between a
// feature that works on iPhone and one that appears not to.

import { useEffect, useState } from "react";

type State = "checking" | "unsupported" | "needs-install" | "off" | "on" | "blocked" | "unavailable";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone));
}

function toUint8(base64: string): BufferSource {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  // Backed by a plain ArrayBuffer rather than whatever Uint8Array.from gives
  // us, because PushManager's own types insist on one.
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

export function PushToggle({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // On an iPhone this is almost always the home-screen problem rather
        // than a browser that cannot do it at all.
        setState(isIos() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }

      const config = await fetch("/api/push/subscribe").then((response) => response.json()).catch(() => null);
      if (cancelled) return;
      if (!config?.configured) {
        setState("unavailable");
        return;
      }

      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      if (cancelled) return;
      setState(existing ? "on" : "off");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const config = await fetch("/api/push/subscribe").then((response) => response.json());
      if (!config?.publicKey) throw new Error("Notifications are not set up on this deployment.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      // A registration that has not finished activating cannot subscribe, and
      // the failure is an unhelpful DOMException.
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toUint8(config.publicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, ...subscription.toJSON() }),
      });
      if (!response.ok) throw new Error("Saved on this device but not on the server. Try again.");

      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn it off.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return <p className="text-xs text-[var(--kb-text-dim)]">Checking…</p>;

  if (state === "needs-install") {
    return (
      <p className="text-xs text-[var(--kb-text-dim)]">
        On an iPhone, notifications only work once this is added to your home screen. Tap Share, then &ldquo;Add to Home
        Screen&rdquo;, open it from there, and this will be here.
      </p>
    );
  }

  if (state === "unsupported") {
    return <p className="text-xs text-[var(--kb-text-dim)]">This browser cannot do notifications. Everything still appears in the bell.</p>;
  }

  if (state === "unavailable") {
    return <p className="text-xs text-[var(--kb-text-dim)]">Notifications are not switched on for this installation.</p>;
  }

  if (state === "blocked") {
    return (
      <p className="text-xs text-[var(--kb-text-dim)]">
        This browser is blocking notifications for this site. That has to be changed in the browser&apos;s own settings —
        we cannot ask again once it has been refused.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={state === "on" ? turnOff : turnOn}
        disabled={busy}
        className={`kb-pill text-xs disabled:opacity-50 ${state === "on" ? "kb-pill-ghost" : "kb-pill-primary"}`}
      >
        {busy ? "Working…" : state === "on" ? "Stop telling this device" : "Tell this device"}
      </button>
      <p className="mt-2 text-[11px] text-[var(--kb-text-dim)]">
        {state === "on"
          ? "This device will be told when something needs you. A notification carries a nudge and a link, never an amount or a customer's name."
          : "Each phone or computer is separate, so turn it on wherever you want to be told."}
      </p>
      {error && <p className="mt-1 text-[11px] text-[var(--kb-tint-rose-ink)]">{error}</p>}
    </div>
  );
}
