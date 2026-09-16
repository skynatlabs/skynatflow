// The service worker.
//
// It exists for one reason: a notification has to be delivered to something
// even when no tab is open, and only a service worker can be that something.
// Everything else it could do — caching pages, offline shells — is
// deliberately not here. A cache that serves a stale invoice is worse than a
// page that will not load, and the offline work this product actually needs
// is the queue in the app, which knows what a job card is.

self.addEventListener("install", () => {
  // Take over straight away rather than waiting for every tab to close.
  // Otherwise a person who just turned notifications on gets nothing until
  // the next time they quit the browser entirely.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "flow", body: "Something happened.", url: "/dashboard" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // A payload we cannot read still deserves a notification — silence would
    // leave somebody wondering why nothing arrived.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // A tag means a second notification about the same thing replaces the
      // first rather than stacking. Four "invoice overdue" banners is how
      // somebody turns notifications off for good.
      tag: payload.tag || undefined,
      data: { url: payload.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Reuse a tab that is already open rather than piling up new ones —
      // somebody who taps six notifications should not end up with six tabs.
      for (const client of windows) {
        if (client.url.includes(new URL(url, self.location.origin).pathname) && "focus" in client) {
          return client.focus();
        }
      }
      if (windows.length > 0 && "navigate" in windows[0]) {
        return windows[0].navigate(url).then((client) => client && client.focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
