// Titulares del día de Chile, con foto, para la página de Clientes (Inicio).
// Lee los RSS de La Tercera y Cooperativa (traen la foto de cada noticia); si fallan, usa Google Noticias Chile (sin fotos).
// Con ?lugar=<clave> busca noticias de esa comuna en Bing Noticias (trae foto); respaldo: Google Noticias.
// Devuelve hasta 31 noticias (1 principal + 30 secundarias). Guarda cada resultado 20 minutos.
const FUENTES = [
  { src: "La Tercera", url: "https://www.latercera.com/arc/outboundfeeds/rss/?outputType=xml" },
  { src: "Cooperativa", url: "https://www.cooperativa.cl/noticias/site/tax/port/all/rss_3___1.xml" },
];
const RESPALDO = "https://news.google.com/rss?hl=es-419&gl=CL&ceid=CL:es-419";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };
type Item = { t: string; url: string; src: string; en: number; img: string };
const LUGARES: Record<string, string> = {
  vina: '"Viña del Mar"', renaca: '"Reñaca"', valpo: '"Valparaíso" Chile', concon: '"Concón"', curauma: '"Curauma"', santiago: '"Santiago" Chile',
};
const cache: Record<string, { en: number; datos: unknown }> = {};

const des = (t: string) => t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
const tag = (x: string, n: string) => { const m = x.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)); return m ? des(m[1]) : ""; };
const attr = (x: string, n: string) => { const m = x.match(new RegExp(`<${n}[^>]*?\\surl="([^"]+)"`)); return m ? des(m[1]) : ""; };

async function rss(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (100natural noticias)" } });
  if (!r.ok) throw new Error("rss " + r.status + " " + url);
  return [...(await r.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
}
function foto(x: string) {
  let u = attr(x, "media:thumbnail") || attr(x, "media:content") || attr(x, "enclosure");
  if (!/^https:\/\//.test(u)) return "";
  u = u.replace(/width=\d+&height=\d+/, "width=480&height=270");
  return u;
}

async function porLugar(q: string) {
  const bing = async () => (await rss(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=es-CL&cc=CL&qft=sortbydate%3d%221%22`)).map((x): Item => {
    let url = tag(x, "link");
    try { const u = new URL(url).searchParams.get("url"); if (u) url = u; } catch (_) { /* deja el enlace */ }
    let img = tag(x, "News:Image");
    if (img) img = img.replace(/^http:/, "https:") + "&w=480&h=270&c=14";
    return { t: tag(x, "title"), url, src: tag(x, "News:Source"), en: Date.parse(tag(x, "pubDate")) || 0, img };
  });
  const google = async () => (await rss(`https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:30d")}&hl=es-419&gl=CL&ceid=CL:es-419`)).map((x): Item => {
    const src = tag(x, "source"); let t = tag(x, "title");
    if (src && t.endsWith(" - " + src)) t = t.slice(0, -(src.length + 3));
    return { t, url: tag(x, "link"), src, en: Date.parse(tag(x, "pubDate")) || 0, img: "" };
  });
  const [b, g] = await Promise.all([bing().catch((e) => { console.warn(String(e)); return [] as Item[]; }), google().catch((e) => { console.warn(String(e)); return [] as Item[]; })]);
  const vistos = new Set<string>(), norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9ñáéíóú]+/g, " ").trim().slice(0, 60);
  let items = [...b, ...g].filter((x) => x.t && /^https?:\/\//.test(x.url)).filter((x) => { const k = norm(x.t); if (vistos.has(k)) return false; vistos.add(k); return true; });
  const recientes = items.filter((x) => Date.now() - x.en < 45 * 864e5);
  if (recientes.length >= 3) items = recientes;
  // Primero las que traen foto (más nuevas arriba), luego las demás.
  items.sort((x, y) => (y.img ? 1 : 0) - (x.img ? 1 : 0) || y.en - x.en);
  return { en: Date.now(), items: items.slice(0, 31) };
}

async function leer() {
  const listas = await Promise.all(FUENTES.map(async (f) => {
    try {
      return (await rss(f.url)).slice(0, 30).map((x): Item => ({ t: tag(x, "title"), url: tag(x, "link"), src: f.src, en: Date.parse(tag(x, "pubDate")) || 0, img: foto(x) }))
        .filter((x) => x.t && /^https?:\/\//.test(x.url));
    } catch (e) { console.warn(String(e)); return [] as Item[]; }
  }));
  let items = listas.flat().filter((x) => x.img).sort((a, b) => b.en - a.en);
  if (!items.length) {
    items = (await rss(RESPALDO)).slice(0, 31).map((x) => {
      const src = tag(x, "source"); let t = tag(x, "title");
      if (src && t.endsWith(" - " + src)) t = t.slice(0, -(src.length + 3));
      return { t, url: tag(x, "link"), src, en: Date.parse(tag(x, "pubDate")) || 0, img: "" };
    }).filter((x) => x.t && /^https?:\/\//.test(x.url));
  }
  return { en: Date.now(), items: items.slice(0, 31) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const lugar = new URL(req.url).searchParams.get("lugar") || "";
    const k = LUGARES[lugar] ? lugar : "";
    if (!cache[k] || Date.now() - cache[k].en > 20 * 60 * 1000) cache[k] = { en: Date.now(), datos: k ? await porLugar(LUGARES[k]) : await leer() };
    return new Response(JSON.stringify(cache[k].datos), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });
  } catch (e) {
    console.error(e);
    const c = Object.values(cache)[0];
    if (c) return new Response(JSON.stringify(c.datos), { headers: { ...CORS, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ items: [] }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
