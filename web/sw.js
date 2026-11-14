/* Service worker de 100% Natural: recibe las notificaciones push (mensajes y pedidos nuevos)
   y abre la página al tocarlas. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { cuerpo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "100% Natural", {
    body: d.cuerpo || "",
    icon: "/icono-192.png",
    badge: "/favicon-32.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of lista) {
      if (new URL(c.url).origin === self.location.origin) {
        try { await c.focus(); } catch (_) {}
        c.postMessage({ pya: "abrir", url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
