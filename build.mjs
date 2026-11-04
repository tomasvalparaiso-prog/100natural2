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

// 1. Adaptador antes de cualquier script de la app (en el <head> del comienzo del archivo).
{
  const i = html.indexOf("</head>");
  if (i < 0 || i > 2000) throw new Error("Cambio «cargar adaptador»: no encontré el </head> inicial.");
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
writeFileSync("public/index.html", html);
copyFileSync("web/supabase-db.js", "public/supabase-db.js");
copyFileSync("web/importar.html", "public/importar.html");
const require = createRequire(import.meta.url);
copyFileSync(require.resolve("@supabase/supabase-js/dist/umd/supabase.js"), "public/vendor/supabase.js");
console.log("Listo: public/index.html (" + Math.round(html.length / 1024) + " KB)");
