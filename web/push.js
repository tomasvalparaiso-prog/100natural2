/* Notificaciones push de 100% Natural (solo en el sitio de Vercel).
   - Registra el service worker (/sw.js).
   - Cuando hay una sesión de Administrador, Repartidor, Producción o Cliente, ofrece «Activar notificaciones»
     y guarda la suscripción de este teléfono en Supabase (push_guardar), ligada a la cuenta con la que entró.
   - Al cerrar sesión, borra la suscripción de este teléfono (push_quitar).
   - Al tocar una notificación de mensaje, abre ese chat. */
(() => {
  "use strict";
  const VAPID = "BPjVipTVc_u00gLNOqplmpOSDDCYPQUrNO7MCqT5P6jQ9LMmOgGKIGsWtLdEXt-Mt6JzdAnPDjIug1H2qgYDUCw";
  const LS = "pya.push", LS_NO = "pya.push.no", LS_OFF = "pya.avisos.off";
  const PORTALES = ["admin", "repartidor", "agua", "papas", "cliente"];
  const hayPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let reg = null;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then(r => { reg = r; }).catch(() => {});

  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} };
  const sb = () => window.__pya && window.__pya.cliente;
  function cuenta() {
    const S = window.S; if (!S || !S.ses) return null;
    const p = S.portal, s = S.ses[p];
    return PORTALES.includes(p) && s && s.id ? p + ":" + s.id : null;
  }
  const clave = b => { const p = "=".repeat((4 - (b.length % 4)) % 4), r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, c => c.charCodeAt(0)); };

  async function suscribir(pedir) {
    if (!hayPush) return false;
    const r = reg || await navigator.serviceWorker.ready;
    let sub = await r.pushManager.getSubscription();
    if (!sub) {
      if (Notification.permission !== "granted") {
        if (!pedir) return false;
        if (await Notification.requestPermission() !== "granted") return false;
      }
      sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave(VAPID) });
    }
    const j = sub.toJSON(), c = sb(); if (!c) return false;
    const res = await c.rpc("push_guardar", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (res.error) throw res.error;
    lsSet(LS, cuenta() + "|" + j.endpoint);
    return true;
  }
  async function quitar() {
    const g = lsGet(LS); if (!g) return;
    lsSet(LS, null);
    const ep = g.split("|").slice(1).join("|"), c = sb();
    if (ep && c) try { await c.rpc("push_quitar", { p_endpoint: ep }); } catch (_) {}
  }

  /* Apagar / encender desde el botón «Notificaciones activas» de la página. */
  const apagadas = () => lsGet(LS_OFF) === "1";
  async function desactivar() {
    lsSet(LS_OFF, "1");
    await quitar();
    try { const r = reg || await navigator.serviceWorker.ready; const sub = await r.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (_) {}
  }
  async function activar() { lsSet(LS_OFF, null); return suscribir(true); }
  window.pyaPush = { activar, desactivar, apagadas };

  /* ---------- Tarjeta «Activar notificaciones» ---------- */
  const css = document.createElement("style");
  css.textContent = `#push-card{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:70;max-width:520px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#ddd);border-radius:18px;box-shadow:0 14px 34px -14px rgb(0 0 0 / .45);padding:14px 14px 12px;display:grid;gap:10px;font:inherit}
#push-card[hidden]{display:none}#push-card p{margin:0;font-size:.95rem;line-height:1.35}#push-card b{display:block;font-size:1.02rem;margin-bottom:2px}
#push-card .push-acc{display:flex;gap:8px;justify-content:flex-end}#push-card button{min-height:44px;padding:0 16px;border-radius:12px;font:inherit;font-weight:800;cursor:pointer;border:1px solid var(--line,#ddd);background:var(--surface,#fff);color:var(--ink,#111)}
#push-card button.si{background:var(--accent,#2f6a12);color:var(--on-accent,#fff);border-color:transparent}
html:has(#msj-pan:not([hidden])) #push-card{display:none}`;
  document.head.appendChild(css);
  let card = null;
  function tarjeta(modo) {
    if (!card) { card = document.createElement("div"); card.id = "push-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Notificaciones"); document.body.appendChild(card); }
    const cli = (cuenta() || "").startsWith("cliente:");
    if (modo === "ios") {
      card.innerHTML = `<p><b>🔔 Avisos en tu iPhone</b>Para recibir avisos de ${cli ? "mensajes" : "mensajes y pedidos nuevos"} aunque la página esté cerrada: toca <b style="display:inline">Compartir</b> ⬆️ y luego <b style="display:inline">«Agregar a inicio»</b>. Después abre 100% Natural desde ese ícono.</p><div class="push-acc"><button type="button" data-push="no">Entendido</button></div>`;
    } else {
      card.innerHTML = `<p><b>🔔 Activa las notificaciones</b>Te avisaremos en el teléfono cuando llegue un ${cli ? "mensaje de 100% Natural" : "mensaje o un pedido nuevo"}, aunque la página esté cerrada.</p><div class="push-acc"><button type="button" data-push="no">Ahora no</button><button type="button" class="si" data-push="si">Activar</button></div>`;
    }
    card.hidden = false;
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest && e.target.closest("[data-push]"); if (!b) return;
    if (b.dataset.push === "no") { lsSet(LS_NO, String(Date.now())); if (card) card.hidden = true; return; }
    b.disabled = true;
    try {
      lsSet(LS_OFF, null);
      const ok = await suscribir(true);
      if (card) card.hidden = true;
      if (window.toastFn) window.toastFn(ok ? "🔔 Notificaciones activadas." : Notification.permission === "denied" ? "Las notificaciones están bloqueadas. Actívalas en la configuración del navegador." : "No se activaron las notificaciones.");
      if (!ok) lsSet(LS_NO, String(Date.now()));
    } catch (err) {
      console.warn("push", err); b.disabled = false;
      if (window.toastFn) window.toastFn("No se pudieron activar las notificaciones. Intenta de nuevo.");
    }
  });

  /* Revisión periódica: sesión nueva, sesión cerrada o permiso ya dado. */
  let ocupado = false;
  async function revisar() {
    if (ocupado) return; ocupado = true;
    try {
      const c = cuenta(), g = lsGet(LS), gc = g ? g.split("|")[0] : null;
      if (!c) { if (card) card.hidden = true; if (g && window.S && window.S.ses && !Object.keys(window.S.ses).some(k => PORTALES.includes(k) && window.S.ses[k])) await quitar(); return; }
      if (!hayPush) { if (ios && !instalada && !(Date.now() - Number(lsGet(LS_NO) || 0) < 7 * 864e5)) tarjeta("ios"); return; }
      if (apagadas()) { if (card) card.hidden = true; if (g) await quitar(); return; }
      if (Notification.permission === "granted") { if (card) card.hidden = true; if (gc !== c) await suscribir(false); return; }
      /* Ya no se muestra la tarjeta «Activar»: la página pide el permiso sola al primer toque (notificaciones activas por defecto). */
    } catch (err) { console.warn("push", err); }
    finally { ocupado = false; }
  }
  setTimeout(revisar, 2500);
  setInterval(revisar, 5000);

  /* ---------- Abrir el chat al tocar la notificación ---------- */
  function abrirUrl(url) {
    let chat = null;
    try { chat = new URL(url, location.href).searchParams.get("msj"); } catch (_) {}
    if (!chat) return;
    let n = 0;
    const t = setInterval(() => {
      n++;
      const pan = document.getElementById("msj-pan"), btn = document.getElementById("msj-btn");
      if (btn && !btn.hidden && (!pan || pan.hidden)) btn.click();
      const it = document.querySelector('#msj-pan [data-msj="chat"][data-c="' + CSS.escape(chat) + '"]');
      const abierto = document.querySelector("#msj-pan #msj-texto");
      if (it) { it.click(); clearInterval(t); }
      else if (abierto && chat.startsWith("c-") && (cuenta() || "").startsWith("cliente:")) clearInterval(t);
      if (n > 40) clearInterval(t);
    }, 400);
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.pya === "abrir") abrirUrl(e.data.url); });
  /* Aviso de promoción: mostrar la promoción cuando el cliente ya entró y las promociones cargaron. */
  function abrirPromo(url) {
    let id = null;
    try { id = new URL(url, location.href).searchParams.get("promo"); } catch (_) {}
    if (!id) return;
    let n = 0;
    const t = setInterval(() => { n++; try { if ((window.abrirPromo && window.abrirPromo(id)) || n > 60) clearInterval(t); } catch (_) { clearInterval(t); } }, 500);
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.pya === "abrir") abrirPromo(e.data.url); });
  /* Aviso de pedido nuevo: ir a la lista de pedidos y resaltar ese pedido. */
  function abrirPedido(url) {
    let id = null;
    try { id = new URL(url, location.href).searchParams.get("pedido"); } catch (_) {}
    if (!id) return;
    let n = 0, fuiLista = false;
    const t = setInterval(() => {
      n++;
      const el = document.querySelector('[data-id="' + CSS.escape(id) + '"]');
      const card = el && (el.closest("article, .ped, .card") || el);
      if (card && card.offsetParent) {
        clearInterval(t);
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.style.transition = "box-shadow .3s"; card.style.boxShadow = "0 0 0 4px #f59e0b";
        setTimeout(() => { card.style.boxShadow = ""; }, 4000);
        return;
      }
      if (!fuiLista && cuenta()) {
        const b = document.querySelector('[data-act="rep-tab"][data-t="ultimos"], [data-act="ad-local"][data-l="ult"]');
        if (b) { b.click(); fuiLista = true; }
      }
      if (n > 40) clearInterval(t);
    }, 500);
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.pya === "abrir") abrirPedido(e.data.url); });
  if (/[?&]pedido=/.test(location.search)) { const u = location.href; history.replaceState(null, "", location.pathname + location.hash); abrirPedido(u); }
  /* Aviso de actividad de la Comunidad: abrir la Comunidad del cliente. */
  function abrirComunidad() { let n = 0; const t = setInterval(() => { n++; try { if ((window.abrirComunidad && window.abrirComunidad()) || n > 60) clearInterval(t); } catch (_) { clearInterval(t); } }, 500); }
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.pya === "abrir" && /[?&]comunidad=/.test(e.data.url || "")) abrirComunidad(); });
  if (/[?&]comunidad=/.test(location.search)) { history.replaceState(null, "", location.pathname + location.hash); abrirComunidad(); }
  if (/[?&]promo=/.test(location.search)) { const u = location.href; history.replaceState(null, "", location.pathname + location.hash); abrirPromo(u); }
  if (/[?&]msj=/.test(location.search)) { const u = location.href; history.replaceState(null, "", location.pathname + location.hash); abrirUrl(u); }
})();
