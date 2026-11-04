// Inicio de sesión y registro de cuentas de la app 100% Natural.
// Verifica las claves contra los claveHash existentes (mismo formato que la app) y entrega
// una sesión de Supabase Auth cuyo app_metadata { portal, cuenta } usan las reglas RLS.
import { createClient } from "jsr:@supabase/supabase-js@2.49.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const adm = createClient(URL, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });

const COLECCION: Record<string, string> = {
  cliente: "clientes", repartidor: "repartidores", agua: "usuarios_agua", papas: "usuarios_papas",
  prov: "proveedores", pos: "usuarios_pos", utfsm: "usuarios_utfsm", pizzas: "usuarios_pizzas",
  prueba: "usuarios_prueba", admin: "usuarios_admin",
};
// Códigos de registro del personal: [prefijo, sha256(prefijo + código)]. Antes estaban en la página.
const CODIGOS: Record<string, [string, string]> = {
  repartidor: ["pya-reparto:", "bb88784654f77e34b711d69167d3850b55471f83db1c47c5a61945993e6e1a2a"],
  prov: ["pya-proveedor:", "b4e1ea261b9bc70b8bfd6164fd5fe0a7108afacf6adf16ce18d40dbf95a647ec"],
  prueba: ["pya-prueba:", "fd6c7bd5cad3e224cfecc0d8a30d1d25cc2d1e066728b36c873c45f4611e44da"],
  pos: ["pya-pos:", "df75339fa8ed5ed45b2c633f712cb1e77ae780785b669c1dea0318139c1ce0a7"],
  admin: ["pya-admin:", "eb567c43092e0806101fa055b37147bb0da578abe7cf0a5b7cdf3f6e780f12a9"],
  agua: ["pya-produccion:", "da1777a2edd74195c3a70b8f3d21b1cd0633f061c0bd880509c77d282d2484de"],
  papas: ["pya-produccion:", "da1777a2edd74195c3a70b8f3d21b1cd0633f061c0bd880509c77d282d2484de"],
};
// Campos que alguien puede poner al registrarse solo (el resto lo fija el administrador).
const CAMPOS_REGISTRO: Record<string, string[]> = {
  cliente: ["nombre", "telefono", "tipo", "comuna", "direccion", "depto", "email"],
  pizzas: ["nombre", "telefono", "direccion", "comuna"],
};
const CAMPOS_BASE = ["nombre", "telefono"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const slug = (s: unknown) => String(s ?? "").trim().toLowerCase();
const sinClave = (d: Record<string, unknown>) => { const c = { ...d }; delete c.claveHash; return c; };

// Igual que buscarCuenta() en la app: primero por id, luego por el campo «usuario».
async function buscarCuenta(col: string, usuario: string) {
  const { data: porId } = await adm.from("documentos").select("id,data").eq("coleccion", col).eq("id", usuario).maybeSingle();
  if (porId && String(porId.data?.usuario || porId.id) === usuario) return porId;
  const { data } = await adm.from("documentos").select("id,data").eq("coleccion", col).eq("data->>usuario", usuario).limit(5);
  return (data ?? [])[0] ?? null;
}

async function sesionPara(portal: string, cuenta: string) {
  // El id de cuenta puede tener «@», «+», etc.: el correo interno usa un resumen del id.
  const email = `${portal}.${(await sha(cuenta)).slice(0, 32)}@cuentas.100natural.app`;
  const meta = { portal, cuenta };
  const creado = await adm.auth.admin.createUser({ email, email_confirm: true, app_metadata: meta });
  if (creado.error && !/already|registered|exists/i.test(creado.error.message)) throw creado.error;
  const enlace = await adm.auth.admin.generateLink({ type: "magiclink", email });
  if (enlace.error) throw enlace.error;
  const u = enlace.data.user;
  if (u.app_metadata?.portal !== portal || u.app_metadata?.cuenta !== cuenta) {
    const r = await adm.auth.admin.updateUserById(u.id, { app_metadata: meta });
    if (r.error) throw r.error;
  }
  const pub = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await pub.auth.verifyOtp({ type: "magiclink", token_hash: enlace.data.properties.hashed_token });
  if (v.error || !v.data.session) throw v.error ?? new Error("sin sesión");
  const s = v.data.session;
  return { access_token: s.access_token, refresh_token: s.refresh_token };
}

async function portalDelLlamador(req: Request) {
  const t = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t || t === ANON) return null;
  const { data } = await adm.auth.getUser(t);
  return (data.user?.app_metadata?.portal as string) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "solicitud inválida" }, 400); }
  const portal = String(b.portal ?? ""), col = COLECCION[portal];
  if (!col) return json({ error: "portal desconocido" }, 400);
  const usuario = slug(b.usuario), clave = String(b.clave ?? "");

  try {
    if (b.accion === "entrar") {
      if (!usuario || !clave) return json({ ok: false });
      const c = await buscarCuenta(col, usuario);
      if (!c || c.data?.claveHash !== await sha(`pya:${portal}:${c.id}:${clave}`)) return json({ ok: false });
      return json({ ok: true, cuenta: { id: c.id, data: sinClave(c.data) }, sesion: await sesionPara(portal, c.id) });
    }

    if (b.accion === "registrar") {
      const porAdmin = !!b.porAdmin;
      if (porAdmin) {
        if (await portalDelLlamador(req) !== "admin") return json({ error: "solo el administrador puede crear esta cuenta" }, 403);
      } else if (portal === "utfsm") {
        return json({ error: "Las cuentas UTFSM las crea el administrador." }, 403);
      } else if (CODIGOS[portal]) {
        const [pre, h] = CODIGOS[portal];
        if (await sha(pre + slug(b.codigo)) !== h) return json({ error: "codigo" }, 403);
      }
      if (usuario.length < 3 || usuario.length > 60 || !/^[a-z0-9._\-@+]+$/.test(usuario)) return json({ error: "usuario inválido" }, 400);
      if (clave.length < 4) return json({ error: "clave muy corta" }, 400);
      if (await buscarCuenta(col, usuario)) return json({ ok: false, existe: true });
      const entrada = (b.datos && typeof b.datos === "object") ? b.datos as Record<string, unknown> : {};
      const campos = porAdmin ? Object.keys(entrada) : (CAMPOS_REGISTRO[portal] ?? CAMPOS_BASE);
      const datos: Record<string, unknown> = {};
      for (const k of campos) if (k in entrada && k !== "claveHash") datos[k] = entrada[k];
      Object.assign(datos, { usuario, creado: Date.now(), claveHash: await sha(`pya:${portal}:${usuario}:${clave}`) });
      const { error } = await adm.from("documentos").insert({ coleccion: col, id: usuario, data: datos });
      if (error) return error.code === "23505" ? json({ ok: false, existe: true }) : json({ error: error.message }, 500);
      return json({ ok: true, cuenta: { id: usuario, data: sinClave(datos) }, sesion: porAdmin ? null : await sesionPara(portal, usuario) });
    }
    return json({ error: "acción desconocida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "error del servidor" }, 500);
  }
});
