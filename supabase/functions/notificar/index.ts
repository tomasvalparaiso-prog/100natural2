// Envía notificaciones push a los teléfonos cuando se crea un mensaje del chat o un pedido nuevo.
// La llama la base de datos (trigger avisar_push en «documentos») con el encabezado x-push-secreto.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2.49.4";

const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const COL: Record<string, string> = {
  admin: "usuarios_admin", repartidor: "repartidores", agua: "usuarios_agua", papas: "usuarios_papas", cliente: "clientes",
};
const EQUIPO = ["admin", "repartidor", "agua", "papas"];
const GRUPOS: Record<string, [string, string[]]> = {
  "g-todos": ["Todo el equipo", EQUIPO],
  "g-rep": ["Repartidores", ["admin", "repartidor"]],
  "g-agua": ["Producción agua", ["admin", "agua"]],
  "g-papas": ["Producción papas", ["admin", "papas"]],
};
type Sub = { endpoint: string; p256dh: string; auth: string; portal: string; cuenta: string };
type Aviso = { titulo: string; cuerpo: string; tag: string; url: string };

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

function paraMensaje(d: Record<string, any>, subs: Sub[]): [Sub[], Aviso] | null {
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
  }
  dest = dest.filter((s) => llave(s) !== de);
  return [dest, { titulo: `💬 ${titulo}`, cuerpo: contenido, tag: "msj-" + chat, url: "/?msj=" + encodeURIComponent(chat) }];
}

function paraPedido(id: string, d: Record<string, any>, subs: Sub[]): [Sub[], Aviso] | null {
  if (d.estado === "cancelado") return null;
  const items = Array.isArray(d.items) ? d.items : [];
  const lista = items.slice(0, 3).map((x: any) => `${x.cant}× ${x.nombre}`).join(", ") + (items.length > 3 ? ` y ${items.length - 3} más` : "");
  const cuando = [d.fechaEntrega ? String(d.fechaEntrega).split("-").reverse().slice(0, 2).join("/") : "", d.horario || ""].filter(Boolean).join(" ");
  const cuerpo = [lista, d.total ? clp(Number(d.total)) : "", [d.comuna, cuando].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
  const creador = d.origen === "admin" && d.creadoPor ? `usuarios_admin:${d.creadoPor}` : "";
  const dest = subs.filter((s) => (s.portal === "admin" || s.portal === "repartidor") && llave(s) !== creador);
  return [dest, { titulo: `🛒 Pedido nuevo · ${corto(d.clienteNombre || "Cliente", 60)}`, cuerpo: corto(cuerpo, 180), tag: "ped-" + id, url: "/" }];
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
    if (!["mensajes", "pedidos", "avisos_push"].includes(coleccion) || !id) return new Response("ok");
    const { data: doc } = await adm.from("documentos").select("data").eq("coleccion", coleccion).eq("id", id).maybeSingle();
    if (!doc) return new Response("ok");
    const { data: subs, error } = await adm.from("push_subs").select("endpoint,p256dh,auth,portal,cuenta");
    if (error) throw error;
    const r = coleccion === "mensajes" ? paraMensaje(doc.data, subs as Sub[]) : coleccion === "pedidos" ? paraPedido(id, doc.data, subs as Sub[]) : await paraPromo(doc.data, subs as Sub[]);
    if (!r || !r[0].length) { if (coleccion === "avisos_push") await anotarPromo(id, doc.data, 0, r ? 0 : -1); return new Response("ok"); }
    const [dest, aviso] = r, carga = JSON.stringify(aviso);
    let enviados = 0;
    await Promise.all(dest.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 86400, urgency: "high" });
        enviados++;
      } catch (e: any) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await adm.from("push_subs").delete().eq("endpoint", s.endpoint);
        else console.warn("push", e?.statusCode, e?.body || e?.message);
      }
    }));
    if (coleccion === "avisos_push") await anotarPromo(id, doc.data, enviados, dest.length);
    return new Response(JSON.stringify({ enviados }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
