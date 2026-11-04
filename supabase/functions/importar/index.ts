// Importación única del respaldo del artifact de claude.ai a la tabla «documentos».
// Protegida por la clave IMPORTAR_CLAVE (secreto de Edge Functions), que se envía en el encabezado x-importar-clave.
import { createClient } from "jsr:@supabase/supabase-js@2.49.4";

const CLAVE = Deno.env.get("IMPORTAR_CLAVE") ?? "";
const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-importar-clave",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function iguales(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  if (CLAVE.length < 8) return json({ error: "La importación no está habilitada (falta IMPORTAR_CLAVE en Supabase)." }, 503);
  if (!iguales(req.headers.get("x-importar-clave") ?? "", CLAVE)) return json({ error: "Clave de importación incorrecta." }, 403);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "solicitud inválida" }, 400); }

  if (b.accion === "cargar") {
    const col = String(b.coleccion ?? "");
    if (!/^[A-Za-z0-9_]{1,80}$/.test(col)) return json({ error: "colección inválida" }, 400);
    const docs = Array.isArray(b.docs) ? b.docs as { id: unknown; data: unknown }[] : [];
    const filas = docs
      .filter((d) => typeof d.id === "string" && d.id && d.data && typeof d.data === "object" && !Array.isArray(d.data))
      .map((d) => ({ coleccion: col, id: d.id as string, data: d.data }));
    if (!filas.length) return json({ ok: true, cargados: 0 });
    const { error } = await adm.from("documentos").upsert(filas, { onConflict: "coleccion,id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, cargados: filas.length });
  }

  if (b.accion === "contar") {
    const { data, error } = await adm.rpc("contar_documentos");
    if (error) return json({ error: error.message }, 500);
    const conteos: Record<string, number> = {};
    for (const r of data ?? []) conteos[r.coleccion] = Number(r.n);
    return json({ ok: true, conteos });
  }
  return json({ error: "acción desconocida" }, 400);
});
