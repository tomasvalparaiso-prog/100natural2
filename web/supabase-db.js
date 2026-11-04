/* Adaptador: da a la app la misma interfaz que window.claude.use("db" | "user" | "downloads")
   de claude.ai, pero guardando en Supabase (tabla «documentos», con RLS por rol).
   Debe cargarse después de vendor/supabase.js y antes del script principal de la app. */
(() => {
  "use strict";
  const CFG = window.PYA_SUPABASE;
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "pya.supabase" },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const listo = sb.auth.getSession().catch(() => null);

  /* ---------- Errores con la forma que espera la app (e.code) ---------- */
  function err(code, message, cause) { const e = new Error(message || code); e.code = code; if (cause) e.cause = cause; return e; }
  function traducir(e) {
    if (!e) return err("unknown");
    const c = String(e.code || ""), m = String(e.message || "");
    if (c === "42501" || /row-level security|permission denied/i.test(m)) return err("permission_denied", "Sin permiso para esta operación.", e);
    if (c === "P0002") return err("not_found", m, e);
    if (/Failed to fetch|NetworkError|fetch failed|Load failed|timeout/i.test(m) || c === "PGRST000" || c === "PGRST001") return err("unavailable", m, e);
    return err(c || "unknown", m, e);
  }
  const chk = r => { if (r.error) throw traducir(r.error); return r.data; };

  /* ---------- Instantáneas ---------- */
  function docSnap(col, id, data) {
    const exists = data !== undefined && data !== null;
    return { id, exists, ref: docRef(col, id), metadata: { fromCache: false, hasPendingWrites: false }, data: () => (exists ? data : undefined) };
  }
  function querySnap(col, filas) {
    const docs = filas.map(f => docSnap(col, f.id, f.data));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false },
      forEach: fn => docs.forEach(fn), docChanges: () => [] };
  }

  /* ---------- Escuchas en vivo: un canal para toda la tabla, se reparte por colección ---------- */
  const escuchas = new Map(); // coleccion -> Set(listener)
  function avisar(col) {
    const set = escuchas.get(col); if (!set) return;
    for (const l of set) l.pedir();
  }
  function avisarTodos() { for (const set of escuchas.values()) for (const l of set) l.pedir(); }
  let canal = null;
  function conectarCanal() {
    if (canal) return;
    canal = sb.channel("documentos")
      .on("postgres_changes", { event: "*", schema: "public", table: "documentos" }, p => {
        const col = (p.new && p.new.coleccion) || (p.old && p.old.coleccion);
        if (col) avisar(col);
      })
      .subscribe(estado => { if (estado === "SUBSCRIBED") avisarTodos(); });
  }
  function escuchar(col, leer, next, error) {
    let vivo = true, timer = null, enCurso = false, otraVez = false;
    const l = {
      pedir() {
        if (!vivo) return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          if (enCurso) { otraVez = true; return; }
          enCurso = true;
          try { const s = await leer(); if (vivo) next(s); }
          catch (e) { if (vivo && error) error(e && e.code ? e : traducir(e)); }
          finally { enCurso = false; if (otraVez) { otraVez = false; l.pedir(); } }
        }, 120);
      },
    };
    if (!escuchas.has(col)) escuchas.set(col, new Set());
    escuchas.get(col).add(l);
    conectarCanal();
    l.pedir();
    return () => { vivo = false; clearTimeout(timer); const s = escuchas.get(col); if (s) s.delete(l); };
  }

  /* ---------- Referencias ---------- */
  function partes(path) {
    const p = String(path).split("/").filter(Boolean);
    if (p.length !== 2) throw new TypeError("Ruta de documento no soportada: " + path);
    return p;
  }
  function nuevoId() {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", b = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(b, x => a[x % a.length]).join("");
  }
  const limpio = d => JSON.parse(JSON.stringify(d === undefined ? {} : d));

  function docRef(col, id) {
    const leer = async () => {
      await listo;
      const r = chk(await sb.from("documentos").select("id,data").eq("coleccion", col).eq("id", id).maybeSingle());
      return docSnap(col, id, r ? r.data : undefined);
    };
    return {
      id, path: col + "/" + id,
      parent: { id: col, path: col },
      get: leer,
      async set(data) {
        await listo;
        const fila = { coleccion: col, id, data: limpio(data) };
        // El registro de actividad solo admite agregar (y quien escribe no puede leerlo): insert simple.
        if (col === "registro_sistema") chk(await sb.from("documentos").insert(fila));
        else chk(await sb.from("documentos").upsert(fila, { onConflict: "coleccion,id" }));
        avisar(col);
      },
      async update(cambios) {
        await listo;
        chk(await sb.rpc("actualizar", { p_coleccion: col, p_id: id, p_cambios: limpio(cambios) }));
        avisar(col);
      },
      async delete() {
        await listo;
        chk(await sb.from("documentos").delete().eq("coleccion", col).eq("id", id));
        avisar(col);
      },
      onSnapshot(next, error) { return escuchar(col, leer, next, error); },
    };
  }

  function query(col, filtros, orden, lim) {
    const leer = async () => {
      await listo;
      const filas = chk(await sb.rpc("consultar", {
        p_coleccion: col, p_filtros: filtros, p_orden: orden ? orden[0] : null,
        p_desc: !!(orden && orden[1] === "desc"), p_limite: lim || 1000,
      }));
      return querySnap(col, filas || []);
    };
    return {
      where: (campo, op, valor) => query(col, [...filtros, [campo, op, valor]], orden, lim),
      orderBy: (campo, dir) => query(col, filtros, [campo, dir || "asc"], lim),
      limit: n => query(col, filtros, orden, Math.max(1, Math.min(5000, n | 0))),
      get: leer,
      onSnapshot: (next, error) => escuchar(col, leer, next, error),
    };
  }
  function collRef(col) {
    if (String(col).includes("/")) throw new TypeError("Subcolecciones no soportadas: " + col);
    return Object.assign(query(col, [], null, 1000), {
      id: col, path: col,
      doc: id => docRef(col, id === undefined ? nuevoId() : String(id)),
      async add(data) { const r = docRef(col, nuevoId()); await r.set(data); return r; },
    });
  }

  const db = Object.freeze({ doc: path => { const [c, i] = partes(path); return docRef(c, i); }, collection: collRef });

  /* ---------- Sesiones: inicio de sesión y registro en el servidor ---------- */
  const RANGO = { admin: 3, repartidor: 2, agua: 2, papas: 2, pos: 2, utfsm: 2, prueba: 2, cliente: 1, pizzas: 1, prov: 1 };
  async function sesionActual() { const { data } = await sb.auth.getSession(); const u = data && data.session && data.session.user; return u ? (u.app_metadata || {}) : null; }
  async function llamar(cuerpo) {
    await listo;
    const { data, error } = await sb.functions.invoke("sesion", { body: cuerpo });
    if (error) {
      let b = null; try { b = await error.context.json(); } catch (_) {}
      if (b && b.error === "codigo") throw err("codigo", "Código incorrecto");
      if (b && b.error) throw err("rechazado", b.error);
      throw err("unavailable", String(error.message || error));
    }
    return data;
  }
  async function usarSesion(portal, s) {
    if (!s) return;
    const actual = await sesionActual();
    // Mantener una sesión de mayor rango (p. ej. el administrador que además entra como cliente).
    if (actual && actual.portal && (RANGO[actual.portal] || 0) > (RANGO[portal] || 0)) return;
    const r = await sb.auth.setSession(s);
    if (r.error) throw traducir(r.error);
    avisarTodos();
  }
  const pya = {
    /* Devuelve una instantánea de la cuenta (sin claveHash) o null si usuario/clave no coinciden. */
    async entrar(portal, usuario, clave) {
      const r = await llamar({ accion: "entrar", portal, usuario, clave });
      if (!r || !r.ok) return null;
      await usarSesion(portal, r.sesion);
      return docSnap("cuenta", r.cuenta.id, r.cuenta.data);
    },
    /* { ok, cuenta } o { existe: true }. Lanza err("codigo") si el código del personal no es correcto. */
    async registrar(portal, usuario, clave, datos, codigo, porAdmin) {
      const r = await llamar({ accion: "registrar", portal, usuario, clave, datos, codigo, porAdmin: !!porAdmin });
      if (r && r.ok && r.sesion) await usarSesion(portal, r.sesion);
      return r || {};
    },
    salir: () => sb.auth.signOut().then(avisarTodos),
    cliente: sb,
  };
  window.__pya = pya;

  /* Si la app ya no tiene ninguna sesión de la cuenta con la que entramos (cerró sesión), cerrar también aquí. */
  setInterval(async () => {
    const m = await sesionActual(); if (!m || !m.cuenta) return;
    let ses = {}; try { ses = JSON.parse(localStorage.getItem("pya.sesion.v1") || "{}") || {}; } catch (_) {}
    const sigue = Object.values(ses).some(v => v && (v.id === m.cuenta || v.usuario === m.cuenta));
    if (!sigue) pya.salir();
  }, 3000);
  sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT" || ev === "TOKEN_REFRESHED") avisarTodos(); });

  /* ---------- Descargas: el navegador guarda el archivo ---------- */
  const downloads = Object.freeze({
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename || "archivo"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: "saved" };
    },
  });

  const user = Object.freeze({ can: async () => null, isOwner: () => false, canEdit: () => false });

  const caps = { db, user, downloads };
  window.claude = Object.freeze({ use: async nombre => { await listo; return caps[nombre] || null; } });
})();
