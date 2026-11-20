// Titulares del día de Chile para la página de Clientes (Inicio).
// Lee el RSS de Google Noticias Chile y devuelve los primeros titulares; guarda el resultado 20 minutos.
const FUENTE = "https://news.google.com/rss?hl=es-419&gl=CL&ceid=CL:es-419";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };
let cache: { en: number; datos: unknown } | null = null;

const des = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
const tag = (x: string, n: string) => { const m = x.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)); return m ? des(m[1]) : ""; };

async function leer() {
  const r = await fetch(FUENTE, { headers: { "User-Agent": "Mozilla/5.0 (100natural noticias)" } });
  if (!r.ok) throw new Error("rss " + r.status);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map((m) => {
    const x = m[1];
    const src = tag(x, "source");
    let t = tag(x, "title");
    if (src && t.endsWith(" - " + src)) t = t.slice(0, -(src.length + 3));
    return { t, url: tag(x, "link"), src, en: Date.parse(tag(x, "pubDate")) || 0 };
  }).filter((x) => x.t && /^https?:\/\//.test(x.url));
  return { en: Date.now(), items };
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
