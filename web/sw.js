/* Service worker de 100% Natural: recibe las notificaciones push (mensajes, pedidos nuevos y promociones)
   y abre la página al tocarlas. Los avisos pueden traer botones (acciones), por ejemplo «Cómo llegar». */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { cuerpo: e.data ? e.data.text() : "" }; }
  const acciones = Array.isArray(d.acciones) ? d.acciones.slice(0, 2) : [];
  const op = {
    body: d.cuerpo || "",
    icon: d.icono || "/icono-192.png",
    badge: d.badge || "/favicon-32.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "/", acciones: Object.fromEntries(acciones.map(a => [a.id, a.url])) },
  };
  if (acciones.length) op.actions = acciones.map(a => ({ action: a.id, title: a.titulo }));
  if (d.vibrar) op.vibrate = d.vibrar;
  if (d.fijo) op.requireInteraction = true;
  if (d.cuando) op.timestamp = d.cuando;
  e.waitUntil(self.registration.showNotification(d.titulo || "100% Natural", op));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const datos = e.notification.data || {};
  const url = (e.action && datos.acciones && datos.acciones[e.action]) || datos.url || "/";
  e.waitUntil((async () => {
    /* Un enlace a otro sitio (por ejemplo Google Maps) se abre aparte. */
    if (!url.startsWith("/")) { await self.clients.openWindow(url); return; }
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
