/* ============================================================================
 *  Quandary service worker
 *  Handles incoming Web Push messages and notification clicks.
 *  (A precache/offline layer can be added later via Workbox; kept lean here.)
 * ========================================================================== */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* noop */ }

  const title = data.title || "Quandary";
  const options = {
    body: data.body || "A new question is waiting.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    data: { url: data.url || "/" },
    tag: data.url || "quandary",      // collapse duplicates
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) { client.navigate(target); return client.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
