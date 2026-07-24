/* ============================================================================
 *  Quandary service worker
 *  - Shows incoming Web Push notifications
 *  - Bumps the home-screen icon badge on each push (Badging API)
 *  - Deep-links notification taps to the question they're about
 * ========================================================================== */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/* ---- badge count, persisted in IndexedDB so it survives between pushes ---- */
function openBadgeDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("quandary-badge", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getBadgeCount() {
  try {
    const db = await openBadgeDB();
    return await new Promise((resolve) => {
      const g = db.transaction("kv").objectStore("kv").get("count");
      g.onsuccess = () => resolve(g.result || 0);
      g.onerror = () => resolve(0);
    });
  } catch { return 0; }
}
async function setBadgeCount(n) {
  try {
    const db = await openBadgeDB();
    await new Promise((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(n, "count");
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch { /* badge is best-effort */ }
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* noop */ }

  const title = data.title || "Quandary";
  const options = {
    body: data.body || "A new question is waiting.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    data: { url: data.url || "/" },
    tag: data.url || "quandary",
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Icon badge: increment per push; the app clears it on open.
    try {
      if ("setAppBadge" in self.navigator) {
        const n = (await getBadgeCount()) + 1;
        await setBadgeCount(n);
        await self.navigator.setAppBadge(n);
      }
    } catch { /* unsupported — fine */ }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    // Tapping a notification counts as "seen" — reset the badge.
    try {
      await setBadgeCount(0);
      if ("clearAppBadge" in self.navigator) await self.navigator.clearAppBadge();
    } catch { /* noop */ }
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) { client.navigate(target); return client.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
