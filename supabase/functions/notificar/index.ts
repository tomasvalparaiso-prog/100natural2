// Envía notificaciones push a los teléfonos cuando se crea un mensaje del chat o un pedido nuevo.
// La llama la base de datos (trigger avisar_push en «documentos») con el encabezado x-push-secreto.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2.49.4";

const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const COL: Record<string, string> = {
  admin: "usuarios_admin", repartidor: "repartidores", agua: "usuarios_agua", papas: "usuarios_papas", cliente: "clientes", prov: "proveedores",
};
const EQUIPO = ["admin", "repartidor", "agua", "papas"];
const GRUPOS: Record<string, [string, string[]]> = {
  "g-todos": ["Todo el equipo", EQUIPO],
  "g-rep": ["Repartidores", ["admin", "repartidor"]],
  "g-agua": ["Producción agua", ["admin", "agua"]],
  "g-papas": ["Producción papas", ["admin", "papas"]],
};
type Sub = { endpoint: string; p256dh: string; auth: string; portal: string; cuenta: string };
type Aviso = {
  titulo: string; cuerpo: string; tag: string; url: string;
  badge?: string; vibrar?: number[]; fijo?: boolean; cuando?: number; acciones?: { id: string; titulo: string; url: string }[];
};

let cfg: { secreto: string; pub: string; priv: string } | null = null;
async function config() {
  if (!cfg) {
    const { data, error } = await adm.rpc("push_config");
    if (error) throw error;
    cfg = data;
    webpush.setVapidDetails("mailto:avisos@100natural.app", cfg!.pub, cfg!.priv);
  }
  return cfg!;
}
const llave = (s: Sub) => `${COL[s.portal]}:${s.cuenta}`;
const corto = (t: unknown, n = 120) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const clp = (n: number) => "$" + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

async function paraMensaje(d: Record<string, any>, subs: Sub[]): Promise<[Sub[], Aviso] | null> {
  const chat = String(d.chat || ""), de = String(d.deKey || "");
  if (!chat || d.borrado) return null;
  const contenido = d.texto ? corto(d.texto) : d.fotoId ? "📷 Foto" : d.pedido ? `📦 Pedido #${d.pedido.cod || ""}` : "Mensaje nuevo";
  let dest: Sub[] = [], titulo = String(d.deNom || "Mensaje");
  if (GRUPOS[chat]) {
    dest = subs.filter((s) => GRUPOS[chat][1].includes(s.portal));
    titulo = `${titulo} · ${GRUPOS[chat][0]}`;
  } else if (chat.startsWith("p-")) {
    const ks = chat.slice(2).split("~");
    dest = subs.filter((s) => ks.includes(llave(s)));
  } else if (chat.startsWith("c-")) {
    const cli = chat.slice(2);
    if (de.startsWith("clientes:")) { dest = subs.filter((s) => s.portal === "admin"); titulo = `${titulo} (cliente)`; }
    else { dest = subs.filter((s) => s.portal === "cliente" && s.cuenta === cli); titulo = "100% Natural"; }
  } else if (chat.startsWith("r-")) {
    // Consulta de un pedido entre el cliente y el repartidor (la administración también la ve).
    const cli = String(d.clienteId || "");
    if (de.startsWith("clientes:")) {
      const { data: pe } = await adm.from("documentos").select("data").eq("coleccion", "pedidos").eq("id", chat.slice(2)).maybeSingle();
      const rid = String(pe?.data?.repartidorId || "");
      dest = subs.filter((s) => s.portal === "admin" || (s.portal === "repartidor" && (!rid || s.cuenta === rid)));
      titulo = `${titulo} (consulta de pedido)`;
    } else { dest = subs.filter((s) => s.portal === "cliente" && s.cuenta === cli); titulo = `${titulo} · tu pedido`; }
  } else if (chat.startsWith("v-")) {
    // Proveedores: conversan solo con la administración.
    const pv = chat.slice(2);
    if (de.startsWith("proveedores:")) { dest = subs.filter((s) => s.portal === "admin"); titulo = `${titulo} (proveedor)`; }
    else { dest = subs.filter((s) => s.portal === "prov" && s.cuenta === pv); titulo = "100% Natural"; }
  }
  dest = dest.filter((s) => llave(s) !== de);
  return [dest, { titulo: `💬 ${titulo}`, cuerpo: contenido, tag: "msj-" + chat, url: "/?msj=" + encodeURIComponent(chat) }];
}

// Pedido nuevo: aviso detallado (productos, dirección, cuándo, nota) con botones «Ver pedido» y «Cómo llegar».
// Solo le llega al administrador (con el total y el tipo de pago).
const hoyCL = (dias = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(Date.now() + dias * 864e5));
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function cuandoTxt(f: string, horario: string) {
  let dia = "";
  if (f) {
    if (f === hoyCL()) dia = "Hoy";
    else if (f === hoyCL(1)) dia = "Mañana";
    else { const [y, m, d] = f.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d, 12)); dia = `${DIAS[dt.getUTCDay()].replace(/^./, (c) => c.toUpperCase())} ${d}/${m}`; }
  }
  return [dia, horario].filter(Boolean).join(" · ");
}
function paraPedido(id: string, d: Record<string, any>, subs: Sub[]): [Sub[], Aviso][] | null {
  if (d.estado === "cancelado") return null;
  const items = Array.isArray(d.items) ? d.items : [];
  const unid = items.reduce((a: number, x: any) => a + (Number(x.cant) || 0), 0);
  const prods = items.slice(0, 4).map((x: any) => `${x.cant}× ${x.nombre}${x.detalle && !String(x.nombre).includes(x.detalle) ? ` (${x.detalle})` : ""}`).join(", ") + (items.length > 4 ? ` y ${items.length - 4} más` : "");
  const dir = [[d.direccion, d.depto].filter(Boolean).join(" "), d.comuna].filter(Boolean).join(", ");
  const cuando = cuandoTxt(String(d.fechaEntrega || ""), String(d.horario || ""));
  const nota = corto(d.nota, 90);
  const cod = String(id).slice(-5).toUpperCase();
  const lineas = [
    prods ? `📦 ${prods}` : "",
    dir ? `📍 ${dir}` : "",
    cuando ? `🕒 ${cuando}` : "",
  ];
  const pago = [d.total ? clp(Number(d.total)) : "", d.pago || ""].filter(Boolean).join(" · ");
  const fin = nota ? [`📝 ${nota}`] : [];
  const titulo = `🛒 Pedido nuevo #${cod} · ${corto(d.clienteNombre || "Cliente", 40)}${unid ? ` (${unid} ${unid === 1 ? "unidad" : "unid."})` : ""}`;
  const lugar = [d.direccion, d.comuna].filter(Boolean).join(", ");
  const mapa = d.direccion ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(lugar) : "";
  const base = (cuerpo: string): Aviso => ({
    titulo, cuerpo, tag: "ped-" + id, url: "/?pedido=" + encodeURIComponent(id),
    badge: "/badge-96.png", vibrar: [200, 100, 200, 100, 300], fijo: true, cuando: Number(d.creado) || Date.now(),
    acciones: [{ id: "ver", titulo: "📋 Ver pedido", url: "/?pedido=" + encodeURIComponent(id) }, ...(mapa ? [{ id: "mapa", titulo: "🗺️ Cómo llegar", url: mapa }] : [])],
  });
  const creador = d.origen === "admin" && d.creadoPor ? `usuarios_admin:${d.creadoPor}` : "";
  const admins = subs.filter((s) => s.portal === "admin" && llave(s) !== creador);
  const txt = (xs: string[]) => { const t = xs.filter(Boolean).join("\n"); return t.length > 400 ? t.slice(0, 399) + "…" : t; };
  return [
    // Solo al administrador: los repartidores ya no reciben aviso de pedidos nuevos.
    [admins, base(txt([...lineas, pago ? `💰 ${pago}` : "", ...fin]))],
  ];
}

// Aviso masivo de una promoción a los clientes (lo crea el administrador en «avisos_push»).
// Los clientes no pueden crear estos avisos: un documento con clienteId (lo único que la base de datos le deja crear a un cliente) se ignora.
async function paraPromo(d: Record<string, any>, subs: Sub[]): Promise<[Sub[], Aviso] | null> {
  if (!d || d.clienteId || !d.promoId) return null;
  const { data: pr } = await adm.from("documentos").select("data").eq("coleccion", "promociones").eq("id", String(d.promoId)).maybeSingle();
  if (!pr) return null;
  let dest = subs.filter((s) => s.portal === "cliente");
  const aud = String(pr.data?.aud || "todos");
  if (aud === "local" || aud === "part") {
    const ids = dest.map((s) => s.cuenta);
    const { data: cs } = await adm.from("documentos").select("id,data").eq("coleccion", "clientes").in("id", ids.length ? ids : ["-"]);
    const local = new Set((cs ?? []).filter((c: any) => c.data?.tipo === "Local comercial").map((c: any) => c.id));
    dest = dest.filter((s) => (aud === "local") === local.has(s.cuenta));
  }
  const titulo = corto(d.titulo || pr.data?.titulo || "Promoción", 70);
  return [dest, { titulo: `🎉 ${titulo}`, cuerpo: corto(d.cuerpo || "Toca para ver la promoción de 100% Natural.", 180), tag: "promo-" + d.promoId, url: "/?promo=" + encodeURIComponent(String(d.promoId)) }];
}

// Actividad nueva de la Comunidad: aviso a todos los clientes (las sube el administrador; un documento con clienteId se ignora).
function paraActividad(d: Record<string, any>, subs: Sub[]): [Sub[], Aviso] | null {
  if (!d || d.clienteId || !d.nombre) return null;
  const f = String(d.fecha || "");
  const fecha = f ? f.split("-").reverse().slice(0, 2).join("/") : "";
  return [subs.filter((s) => s.portal === "cliente"), { titulo: `📅 Trabajos comunitarios · ${corto(d.nombre, 60)}`, cuerpo: corto([fecha, d.horario].filter(Boolean).join(" · ") + (d.descripcion ? ` — ${d.descripcion}` : ""), 180) || "Nueva actividad. ¡Inscríbete!", tag: "act-" + f + corto(d.nombre, 20), url: "/?comunidad=1" }];
}

// Recordatorio del día: a las 8:00 (lo pide la base de datos cada hora) avisa a los inscritos en los Trabajos comunitarios de hoy.
// Cada actividad queda marcada con «recordado» para no repetir el aviso.
async function recordatorios(subs: Sub[]) {
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", hour12: false }).format(new Date()));
  if (hora < 8 || hora >= 21) return 0;
  const hoy = hoyCL();
  const { data: acts } = await adm.from("documentos").select("id,data").eq("coleccion", "actividades").eq("data->>fecha", hoy);
  let enviados = 0;
  for (const a of acts ?? []) {
    const d = a.data || {};
    if (d.clienteId || !d.nombre || d.recordado === hoy) continue;
    const { data: ins } = await adm.from("documentos").select("data").eq("coleccion", "inscripciones").eq("data->>actividadId", a.id);
    const cids = new Set((ins ?? []).map((x: any) => String(x.data?.clienteId || "")).filter(Boolean));
    const dest = subs.filter((s) => s.portal === "cliente" && cids.has(s.cuenta));
    const pts = Number(d.puntos) || 0;
    const carga = JSON.stringify({
      titulo: `⏰ Hoy: ${corto(d.nombre, 60)}`,
      cuerpo: corto(`${d.horario ? `${d.horario} · ` : ""}¡Te esperamos en este Trabajo comunitario!${pts ? ` Ganas ${pts} puntos al participar.` : ""}`, 180),
      tag: "rec-" + a.id, url: "/?comunidad=1", vibrar: [200, 100, 200],
    } as Aviso);
    await Promise.all(dest.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 43200, urgency: "high" }); enviados++; }
      catch (e: any) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await adm.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }));
    await adm.from("documentos").update({ data: { ...d, recordado: hoy } }).eq("coleccion", "actividades").eq("id", a.id);
  }
  return enviados;
}

// Pedido marcado con prioridad (lo crea el administrador en «avisos_push» con tipo «prioridad»):
// aviso a los repartidores (al que lo lleva, o a todos si nadie lo ha tomado). Se comprueba en la base que el pedido tenga prioridad.
async function paraPrioridad(d: Record<string, any>, subs: Sub[]): Promise<[Sub[], Aviso] | null> {
  if (!d || d.clienteId || !d.pedido) return null;
  const { data: pe } = await adm.from("documentos").select("data").eq("coleccion", "pedidos").eq("id", String(d.pedido)).maybeSingle();
  const p = pe?.data;
  if (!p || !p.prioridad || p.estado === "entregado" || p.estado === "cancelado") return null;
  const rid = String(p.repartidorId || "");
  const dest = subs.filter((s) => s.portal === "repartidor" && (!rid || s.cuenta === rid));
  const items = Array.isArray(p.items) ? p.items : [];
  const prods = items.slice(0, 4).map((x: any) => `${x.cant}× ${x.nombre}`).join(", ") + (items.length > 4 ? ` y ${items.length - 4} más` : "");
  const dir = [[p.direccion, p.depto].filter(Boolean).join(" "), p.comuna].filter(Boolean).join(", ");
  const cod = String(d.pedido).slice(-5).toUpperCase();
  const lugar = [p.direccion, p.comuna].filter(Boolean).join(", ");
  const mapa = p.direccion ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(lugar) : "";
  return [dest, {
    titulo: `⚡ Pedido prioritario #${cod} · ${corto(p.clienteNombre || "Cliente", 40)}`,
    cuerpo: [prods ? `📦 ${prods}` : "", dir ? `📍 ${dir}` : "", cuandoTxt(String(p.fechaEntrega || ""), String(p.horario || "")) ? `🕒 ${cuandoTxt(String(p.fechaEntrega || ""), String(p.horario || ""))}` : ""].filter(Boolean).join("\n") || "Entrégalo primero.",
    tag: "prio-" + d.pedido, url: "/?pedido=" + encodeURIComponent(String(d.pedido)), badge: "/badge-96.png", vibrar: [300, 100, 300, 100, 300], fijo: true,
    acciones: [{ id: "ver", titulo: "📋 Ver pedido", url: "/?pedido=" + encodeURIComponent(String(d.pedido)) }, ...(mapa ? [{ id: "mapa", titulo: "🗺️ Cómo llegar", url: mapa }] : [])],
  }];
}

// Deja anotado en el aviso y en la promoción a cuántos teléfonos llegó (el administrador lo ve en la tarjeta).
async function anotarPromo(id: string, d: Record<string, any>, enviados: number, total: number) {
  const res = { en: Date.now(), enviados, total };
  await adm.from("documentos").update({ data: { ...d, resultado: res } }).eq("coleccion", "avisos_push").eq("id", id);
  if (!d?.promoId || d.clienteId) return;
  const { data: pr } = await adm.from("documentos").select("data").eq("coleccion", "promociones").eq("id", String(d.promoId)).maybeSingle();
  if (pr) await adm.from("documentos").update({ data: { ...pr.data, pushUlt: { ...res, por: String(d.por || "") } } }).eq("coleccion", "promociones").eq("id", String(d.promoId));
}

Deno.serve(async (req) => {
  try {
    const c = await config();
    if (!c.secreto || req.headers.get("x-push-secreto") !== c.secreto) return new Response("no autorizado", { status: 401 });
    const { coleccion, id } = await req.json();
    if (coleccion === "recordatorio") {
      const { data: subsR } = await adm.from("push_subs").select("endpoint,p256dh,auth,portal,cuenta");
      const n = await recordatorios((subsR ?? []) as Sub[]);
      return new Response(JSON.stringify({ enviados: n }), { headers: { "Content-Type": "application/json" } });
    }
    if (!["mensajes", "pedidos", "avisos_push", "actividades"].includes(coleccion) || !id) return new Response("ok");
    const { data: doc } = await adm.from("documentos").select("data").eq("coleccion", coleccion).eq("id", id).maybeSingle();
    if (!doc) return new Response("ok");
    const { data: subs, error } = await adm.from("push_subs").select("endpoint,p256dh,auth,portal,cuenta");
    if (error) throw error;
    const uno = coleccion === "mensajes" ? await paraMensaje(doc.data, subs as Sub[]) : coleccion === "avisos_push" ? (doc.data?.tipo === "prioridad" ? await paraPrioridad(doc.data, subs as Sub[]) : await paraPromo(doc.data, subs as Sub[])) : coleccion === "actividades" ? paraActividad(doc.data, subs as Sub[]) : null;
    const grupos: [Sub[], Aviso][] | null = coleccion === "pedidos" ? paraPedido(id, doc.data, subs as Sub[]) : uno ? [uno] : null;
    const envios = (grupos ?? []).flatMap(([ds, av]) => ds.map((s) => [s, JSON.stringify(av)] as [Sub, string]));
    if (!envios.length) { if (coleccion === "avisos_push" && doc.data?.tipo !== "prioridad") await anotarPromo(id, doc.data, 0, grupos ? 0 : -1); return new Response("ok"); }
    const dest = envios.map((e) => e[0]);
    let enviados = 0;
    await Promise.all(envios.map(async ([s, carga]) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 86400, urgency: "high" });
        enviados++;
      } catch (e: any) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await adm.from("push_subs").delete().eq("endpoint", s.endpoint);
        else console.warn("push", e?.statusCode, e?.body || e?.message);
      }
    }));
    if (coleccion === "avisos_push" && doc.data?.tipo !== "prioridad") await anotarPromo(id, doc.data, enviados, dest.length);
    return new Response(JSON.stringify({ enviados }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
