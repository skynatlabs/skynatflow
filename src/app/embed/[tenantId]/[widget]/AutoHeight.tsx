"use client";

// Telling the host page how tall this is.
//
// An iframe has no way of sizing itself, so without this every embed is a
// fixed rectangle with an inner scrollbar — the single thing that makes an
// embedded form look cheap. The frame measures itself and posts the number
// out; the loader script on the other side resizes.
//
// It posts to "*" because the host page's origin is genuinely unknown — the
// business pasted this into a site builder and nobody, including them, can
// say what the real origin is. That is safe in this direction: a height is
// not a secret. The rule that matters is the other direction, and this
// listens for nothing at all.

import { useEffect } from "react";

export function AutoHeight({ allowedHosts }: { allowedHosts: string[] }) {
  useEffect(() => {
    // If the business has named the sites allowed to embed this, a frame on
    // any other site is told to stop rather than quietly collecting leads for
    // somebody who copied the snippet.
    if (allowedHosts.length > 0 && window.parent !== window) {
      const referrer = document.referrer;
      if (referrer) {
        try {
          const host = new URL(referrer).hostname.toLowerCase();
          const ok = allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
          if (!ok) {
            document.body.innerHTML =
              '<p style="font:14px system-ui;padding:16px;color:#555">This form is set up to work only on its own website.</p>';
            return;
          }
        } catch {
          // An unparseable referrer is not evidence of anything, so it is
          // allowed through rather than blocking a real customer.
        }
      }
    }

    const send = () => {
      const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
      window.parent.postMessage({ source: "skynat-embed", height }, "*");
    };

    send();
    const observer = new ResizeObserver(send);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [allowedHosts]);

  return null;
}
