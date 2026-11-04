// Construye el sitio para Vercel a partir del HTML del artifact de claude.ai (fuente/100natural.html):
// le agrega el adaptador de Supabase y cambia el inicio de sesión y el registro para que pasen por el servidor.
// Cada cambio debe aplicarse exactamente una vez; si el HTML cambió y un cambio ya no calza, el build falla.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const SUPABASE = {
  url: "https://zfbytqxlyuhqgrplgbre.supabase.co",
  // Clave pública (anon): pensada para el navegador; el acceso lo limitan las reglas RLS.
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmYnl0cXhseXVocWdycGxnYnJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3NjE1NjIsImV4cCI6MjEwOTMzNzU2Mn0.EXTcSR4ucP1-6Fb96nUQsth_aDQd_m-2x3WuD5UiuGA",
};

let html = readFileSync("fuente/100natural.html", "utf8");

function cambiar(nombre, buscar, poner) {
  const n = typeof buscar === "string" ? html.split(buscar).length - 1 : (html.match(new RegExp(buscar.source, buscar.flags.includes("g") ? buscar.flags : buscar.flags + "g")) || []).length;
  if (n !== 1) throw new Error(`Cambio «${nombre}»: se esperaba 1 coincidencia y hay ${n}. Revisa build.mjs contra el HTML nuevo.`);
  html = html.replace(buscar, () => poner);
}

// Para textos que pueden repetirse: reemplaza todas las apariciones (al menos una).
function cambiarTextos(nombre, buscar, poner) {
  const n = html.split(buscar).length - 1;
  if (n < 1) throw new Error(`Cambio «${nombre}»: no encontré el texto. Revisa build.mjs contra el HTML nuevo.`);
  html = html.split(buscar).join(poner);
}

// 0. Vista previa al compartir el link (WhatsApp, Facebook, etc.): etiquetas Open Graph al comienzo del <head>.
//    La página pesa varios MB y los lectores de vista previa solo leen el principio, así que van antes de todo.
const SITIO = "https://100natural2.vercel.app";
const OG = {
  titulo: "100% Natural",
  descripcion: "Agua purificada y alcalina, papas y helados con despacho a domicilio en Viña del Mar, Concón, Valparaíso, Curauma, Quilpué y Villa Alemana. Crea tu cuenta y haz tu pedido en línea.",
};
const esc = t => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const ETIQUETAS_OG = [
    `<title>${esc(OG.titulo)}</title>`,
    `<meta name="description" content="${esc(OG.descripcion)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(OG.titulo)}">`,
    `<meta property="og:locale" content="es_CL">`,
    `<meta property="og:url" content="${SITIO}/">`,
    `<meta property="og:title" content="${esc(OG.titulo)}">`,
    `<meta property="og:description" content="${esc(OG.descripcion)}">`,
    `<meta property="og:image" content="${SITIO}/og.jpg">`,
    `<meta property="og:image:secure_url" content="${SITIO}/og.jpg">`,
    `<meta property="og:image:type" content="image/jpeg">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="Logo de 100% Natural sobre un paisaje de montañas y lago">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(OG.titulo)}">`,
    `<meta name="twitter:description" content="${esc(OG.descripcion)}">`,
    `<meta name="twitter:image" content="${SITIO}/og.jpg">`,
    `<link rel="canonical" href="${SITIO}/">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    `<meta name="theme-color" content="#2f6a12">`,
].join("");
{
  const ini = "<head><meta charset=utf8>";
  if (!html.startsWith("<!doctype html><html>" + ini)) throw new Error("Cambio «Open Graph»: el HTML no empieza como se esperaba.");
  html = html.replace(ini, () => ini + ETIQUETAS_OG);
}
// Página liviana solo para los lectores de vista previa (WhatsApp, Facebook, Telegram…): la app pesa varios MB
// y WhatsApp abandona antes de armar la vista previa. vercel.json la sirve en «/» a esos lectores.
const COMPARTIR = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${ETIQUETAS_OG}</head>` +
  `<body style="font-family:system-ui,sans-serif;text-align:center;padding:24px"><img src="/og.jpg" alt="" width="600" height="315" style="max-width:100%;height:auto;border-radius:12px">` +
  `<h1>${esc(OG.titulo)}</h1><p>${esc(OG.descripcion)}</p><p><a href="/app.html">Abrir 100% Natural</a></p>` +
  `<script>location.replace("/app.html" + location.hash);</script></body></html>`;

// 1. Adaptador antes de cualquier script de la app (en el <head> del comienzo del archivo).
{
  const i = html.indexOf("</head>");
  if (i < 0 || i > 8000) throw new Error("Cambio «cargar adaptador»: no encontré el </head> inicial.");
  html = html.slice(0, i) +
    `<script>window.PYA_SUPABASE=${JSON.stringify(SUPABASE)};</script>` +
    `<script src="vendor/supabase.js"></script><script src="supabase-db.js"></script>` + html.slice(i);
}

// 2. Inicio de sesión de cada portal: la clave se verifica en el servidor.
cambiar("entrar",
  /const snap = await buscarCuenta\(col\(k\), usuario\);\s*const h = snap \? await sha\(`pya:\$\{k\}:\$\{snap\.id\}:\$\{clave\}`\) : "";\s*if \(!snap \|\| snap\.data\(\)\.claveHash !== h\) \{/,
  "const snap = await window.__pya.entrar(k, usuario, clave);\n    if (!snap) {");

// 3. Inicio de sesión del punto de venta (prueba cuentas de POS, locales y administrador).
cambiar("entrar POS",
  /const snap = await buscarCuenta\(col\(k\), usuario\);\s*if \(snap && snap\.data\(\)\.claveHash === await sha\(`pya:\$\{k\}:\$\{snap\.id\}:\$\{clave\}`\)\) \{/,
  "const snap = await window.__pya.entrar(k, usuario, clave);\n      if (snap) {");

// 4. Registro: el servidor valida el código del personal, que el usuario no exista, y calcula la clave.
cambiar("registrar",
  /const ref = S\.db\.doc\(col\(k\) \+ "\/" \+ usuario\);[\s\S]*?await conReintento\(\(\) => ref\.set\(datos\)\);/,
  `datos.usuario = usuario;
    if (f.dataset.adm) datos.creadoPorAdmin = (S.ses.admin || {}).nombre || true;
    let rr;
    try { rr = await window.__pya.registrar(k, usuario, clave, datos, v("codigo"), !!f.dataset.adm); }
    catch (e2) {
      if (e2 && e2.code === "codigo") { err.textContent = "El código no es correcto. Pídeselo a la empresa."; return; }
      if (e2 && e2.code === "rechazado") { err.textContent = e2.message; return; }
      throw e2;
    }
    if (rr.existe) { err.textContent = \`El usuario «\${usuario}» ya existe. Elige otro o entra con tu clave.\`; return; }`);

// 5. Los códigos del personal ya no van en la página: lo decide el servidor.
for (const c of ["CODIGO_HASH", "CODIGO_PROD_HASH", "CODIGO_PRUEBA_HASH", "CODIGO_POS_HASH", "CODIGO_ADMIN_HASH", "CODIGO_PROV_HASH"]) {
  cambiar(`quitar ${c}`, new RegExp(`const ${c} = "[0-9a-f]{64}"`), `const ${c} = ""`);
  cambiar(`no comparar ${c}`, new RegExp(`if \\(ch !== ${c}\\)`), "if (false)");
}

// 6. Mensajes que hablaban de claude.ai.
cambiarTextos("aviso sin base de datos", "Para crear tu cuenta y hacer pedidos, abre esta página desde claude.ai con tu sesión iniciada.",
  "No hay conexión con el servidor. Revisa tu internet y recarga la página.");
cambiarTextos("entrar sin base de datos", "Esta página necesita abrirse desde claude.ai con tu sesión iniciada.",
  "No hay conexión con el servidor. Revisa tu internet y recarga la página.");
cambiarTextos("sin permiso (error)", "Tu cuenta de claude.ai no tiene permiso para guardar datos aquí. Pide al dueño de la página que te invite como editor.",
  "No tienes permiso para guardar esto. Revisa que entraste con la cuenta correcta.");
cambiarTextos("sin permiso (aviso)", "Tu cuenta de claude.ai puede ver esta página, pero no guardar datos. El dueño debe invitarte como editor desde el menú Compartir.",
  "Tu cuenta no tiene permiso para guardar datos aquí.");
cambiar("mensaje genérico de permiso", 'if (c === "quota_exceeded")',
  'if (c === "permission_denied") return "No tienes permiso para guardar esto. Revisa que entraste con la cuenta correcta.";\n  if (c === "quota_exceeded")');

// Salida
rmSync("public", { recursive: true, force: true });
mkdirSync("public/vendor", { recursive: true });
writeFileSync("public/app.html", html);
writeFileSync("public/compartir.html", COMPARTIR);
copyFileSync("web/supabase-db.js", "public/supabase-db.js");
copyFileSync("web/importar.html", "public/importar.html");
for (const f of ["og.jpg", "apple-touch-icon.png", "favicon-32.png"]) copyFileSync("web/" + f, "public/" + f);
const require = createRequire(import.meta.url);
copyFileSync(require.resolve("@supabase/supabase-js/dist/umd/supabase.js"), "public/vendor/supabase.js");
console.log("Listo: public/app.html (" + Math.round(html.length / 1024) + " KB), public/compartir.html (" + Math.round(COMPARTIR.length / 1024) + " KB)");
