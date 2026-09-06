// Kill switch for the pre-pivot service worker. Any browser that still has the
// old worker fetches this file on update, installs it, and it removes itself
// and every cache it left behind, then reloads open tabs onto the live site.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    for (const c of clients) c.navigate(c.url);
  })());
});
