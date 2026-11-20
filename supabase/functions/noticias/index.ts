// Titulares del día de Chile, con foto, para la página de Clientes (Inicio).
// Lee los RSS de La Tercera y Cooperativa (traen la foto de cada noticia); si fallan, usa Google Noticias Chile (sin fotos).
// Guarda el resultado 20 minutos.
const FUENTES = [
  { src: "La Tercera", url: "https://www.latercera.com/arc/outboundfeeds/rss/?outputType=xml" },
  { src: "Cooperativa", url: "https://www.cooperativa.cl/noticias/site/tax/port/all/rss_3___1.xml" },
];
const RESPALDO = "https://news.google.com/rss?hl=es-419&gl=CL&ceid=CL:es-419";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };
type Item = { t: string; url: string; src: string; en: number; img: string };
let cache: { en: number; datos: unknown } | null = null;

const des = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
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

async function leer() {
  const listas = await Promise.all(FUENTES.map(async (f) => {
    try {
      return (await rss(f.url)).slice(0, 10).map((x): Item => ({ t: tag(x, "title"), url: tag(x, "link"), src: f.src, en: Date.parse(tag(x, "pubDate")) || 0, img: foto(x) }))
        .filter((x) => x.t && /^https?:\/\//.test(x.url));
    } catch (e) { console.warn(String(e)); return [] as Item[]; }
  }));
  let items = listas.flat().filter((x) => x.img).sort((a, b) => b.en - a.en);
  if (!items.length) {
    items = (await rss(RESPALDO)).slice(0, 10).map((x) => {
      const src = tag(x, "source"); let t = tag(x, "title");
      if (src && t.endsWith(" - " + src)) t = t.slice(0, -(src.length + 3));
      return { t, url: tag(x, "link"), src, en: Date.parse(tag(x, "pubDate")) || 0, img: "" };
    }).filter((x) => x.t && /^https?:\/\//.test(x.url));
  }
  return { en: Date.now(), items: items.slice(0, 8) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (!cache || Date.now() - cache.en > 20 * 60 * 1000) cache = { en: Date.now(), datos: await leer() };
    return new Response(JSON.stringify(cache.datos), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });
  } catch (e) {
    console.error(e);
    if (cache) return new Response(JSON.stringify(cache.datos), { headers: { ...CORS, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ items: [] }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
