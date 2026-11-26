-- Juegos (Figuritas, Ruleta, Raspa y gana, Racha de pedidos): todo pasa por estas funciones (el cliente no puede escribir «juegos»).
create or replace function privado.juego_cfg() returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d jsonb := jsonb_build_object('activo', true, 'prob', 0.05, 'cada', 1000, 'jugadas', 1, 'premios', '["ap20","p1b12","p1g"]'::jsonb, 'desde', 0,
  'ruleta', '{"activo":true,"prob":0.1,"cada":1000,"bonoTransf":3}'::jsonb, 'raspa', '{"activo":true,"prob":0.15}'::jsonb, 'racha', '{"activo":true,"semanas":4,"premio":"ap20"}'::jsonb);
  c jsonb := coalesce((select data from documentos where coleccion = 'config' and id = 'juego'), '{}'::jsonb);
begin
  return d || c || jsonb_build_object('ruleta', (d->'ruleta') || coalesce(c->'ruleta', '{}'), 'raspa', (d->'raspa') || coalesce(c->'raspa', '{}'), 'racha', (d->'racha') || coalesce(c->'racha', '{}'));
end $$;
create or replace function privado.juego_lunes(d date) returns date language sql immutable as $$ select (d - ((extract(isodow from d)::int - 1)))::date $$;
create or replace function privado.juego_hoy() returns date language sql stable as $$ select (now() at time zone 'America/Santiago')::date $$;
-- Semanas seguidas con pedidos entregados (desde la semana del último premio de racha).
create or replace function privado.juego_racha_de(cid text) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c jsonb := privado.juego_cfg(); ult date; act date := privado.juego_lunes(privado.juego_hoy()); s date; n int := 0; tope date; sems date[]; esta boolean;
begin
  select max((data->>'semana')::date) into ult from documentos where coleccion = 'juegos' and data->>'clienteId' = cid and data->>'tipo' = 'racha';
  select array_agg(distinct privado.juego_lunes(case when coalesce(data->>'fechaEntrega', '') ~ '^\d{4}-\d{2}-\d{2}' then left(data->>'fechaEntrega', 10)::date
      else (to_timestamp(coalesce(nullif(data->>'creado', '')::numeric, 0) / 1000) at time zone 'America/Santiago')::date end)) into sems
    from documentos where coleccion = 'pedidos' and data->>'clienteId' = cid and data->>'estado' = 'entregado'
     and coalesce(nullif(data->>'creado', '')::numeric, 0) >= coalesce((c->>'desde')::numeric, 0);
  sems := coalesce(sems, '{}'); esta := act = any(sems);
  s := case when esta then act else act - 7 end;
  while s = any(sems) and (ult is null or s > ult) loop if tope is null then tope := s; end if; n := n + 1; s := s - 7; end loop;
  return jsonb_build_object('semanas', n, 'tope', tope, 'estaSemana', esta);
end $$;
create or replace function privado.juego_saldo(cid text) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c jsonb := privado.juego_cfg(); compras numeric; npeds int; ntr int; bt int; trul int; usadas int; nras int; nrul int; crul numeric; cada numeric; porc int; total int; act date := privado.juego_lunes(privado.juego_hoy()); r jsonb; meta int;
begin
  select coalesce(sum(nullif(data->>'total', '')::numeric), 0), count(*), count(*) filter (where data->>'pago' = 'Transferencia') into compras, npeds, ntr from documentos
   where coleccion = 'pedidos' and data->>'clienteId' = cid and data->>'estado' = 'entregado'
     and coalesce(nullif(data->>'creado', '')::numeric, 0) >= coalesce((c->>'desde')::numeric, 0);
  select count(*) filter (where coalesce(data->>'tipo', 'figuritas') = 'figuritas'), count(*) filter (where data->>'tipo' = 'raspa'),
         count(*) filter (where data->>'tipo' = 'ruleta')
    into usadas, nras, nrul from documentos where coleccion = 'juegos' and data->>'clienteId' = cid;
  cada := greatest(1, coalesce((c->>'cada')::numeric, 1000)); porc := greatest(1, coalesce((c->>'jugadas')::int, 1));
  total := floor(compras / cada)::int * porc; crul := greatest(1, coalesce((c->'ruleta'->>'cada')::numeric, 1000));
  bt := greatest(0, coalesce((c->'ruleta'->>'bonoTransf')::int, 3)); trul := floor(compras / crul)::int + bt * ntr; r := privado.juego_racha_de(cid); meta := greatest(2, coalesce((c->'racha'->>'semanas')::int, 4));
  return jsonb_build_object('compras', compras, 'total', total, 'usadas', usadas, 'restantes', greatest(0, total - usadas),
    'falta', cada - mod(compras, cada), 'cada', cada, 'porCompra', porc, 'activo', coalesce((c->>'activo')::boolean, true), 'premios', c->'premios',
    'ruleta', jsonb_build_object('activo', coalesce((c->'ruleta'->>'activo')::boolean, true), 'cada', crul, 'bonoTransf', bt, 'total', trul,
      'restantes', greatest(0, trul - nrul), 'falta', crul - mod(compras, crul)),
    'raspa', jsonb_build_object('activo', coalesce((c->'raspa'->>'activo')::boolean, true), 'total', npeds, 'restantes', greatest(0, npeds - nras)),
    'racha', jsonb_build_object('activo', coalesce((c->'racha'->>'activo')::boolean, true), 'meta', meta, 'premio', c->'racha'->>'premio',
      'semanas', (r->>'semanas')::int, 'estaSemana', (r->>'estaSemana')::boolean, 'listo', (r->>'semanas')::int >= meta));
end $$;
drop function if exists public.juego_estado(); drop function if exists public.juego_jugar(text); drop function if exists public.juego_jugar(); drop function if exists public.juego_racha(); drop function if exists public.juego_canjear(text[], text);
-- Cliente que juega: el de la sesión (portal Clientes) o, si entra el personal viendo la página de un cliente, ese cliente.
create or replace function privado.juego_cid(p_cliente text) returns text language plpgsql stable security definer set search_path to 'public' as $$
declare p text := privado.dato('portal'); yo text := privado.dato('cuenta');
begin
  if p = 'cliente' and yo is not null then return yo; end if;
  if privado.es_personal() and p_cliente is not null and exists (select 1 from documentos where coleccion = 'clientes' and id = p_cliente) then return p_cliente; end if;
  raise exception 'Solo clientes' using errcode = 'P0001';
end $$;
create or replace function public.juego_estado(p_cliente text default null) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare cid text := privado.juego_cid(p_cliente); s jsonb;
begin
  s := privado.juego_saldo(cid);
  return s || jsonb_build_object('local', privado.cliente_es_local(cid), 'ganados', coalesce((select jsonb_agg(jsonb_build_object('id', id) || data order by data->>'en' desc) from documentos
     where coleccion = 'juegos' and data->>'clienteId' = cid and (data->>'gano')::boolean), '[]'::jsonb));
end $$;
create or replace function public.juego_jugar(tipo text default 'figuritas', p_cliente text default null) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare cid text := privado.juego_cid(p_cliente); s jsonb; c jsonb := privado.juego_cfg(); gano boolean; prod text; ps jsonb; nid text; prob numeric;
  ahora bigint := (extract(epoch from now()) * 1000)::bigint; act date := privado.juego_lunes(privado.juego_hoy());
begin
  if privado.cliente_es_local(cid) then raise exception 'Los juegos son para clientes particulares' using errcode = 'P0001'; end if;
  if tipo not in ('figuritas', 'ruleta', 'raspa') then raise exception 'Juego no válido' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('juego_' || cid));
  s := privado.juego_saldo(cid);
  if tipo = 'figuritas' then
    if not (s->>'activo')::boolean then raise exception 'El juego no está disponible' using errcode = 'P0001'; end if;
    if (s->>'restantes')::int <= 0 then raise exception 'No te quedan jugadas' using errcode = 'P0001'; end if;
    prob := coalesce((c->>'prob')::numeric, 0.05);
  elsif tipo = 'ruleta' then
    if not (s->'ruleta'->>'activo')::boolean then raise exception 'La ruleta no está disponible' using errcode = 'P0001'; end if;
    if (s->'ruleta'->>'restantes')::int <= 0 then raise exception 'No te quedan giros' using errcode = 'P0001'; end if;
    prob := coalesce((c->'ruleta'->>'prob')::numeric, 0.1);
  else
    if not (s->'raspa'->>'activo')::boolean then raise exception 'Raspa y gana no está disponible' using errcode = 'P0001'; end if;
    if (s->'raspa'->>'restantes')::int <= 0 then raise exception 'No te quedan tarjetas' using errcode = 'P0001'; end if;
    prob := coalesce((c->'raspa'->>'prob')::numeric, 0.15);
  end if;
  ps := coalesce(c->'premios', '[]'::jsonb);
  gano := jsonb_array_length(ps) > 0 and random() < least(1, greatest(0, prob));
  if gano then prod := ps->>(floor(random() * jsonb_array_length(ps))::int); end if;
  nid := 'jg' || to_hex(ahora) || substr(md5(random()::text), 1, 5);
  insert into documentos (coleccion, id, data) values ('juegos', nid, jsonb_build_object('clienteId', cid, 'tipo', tipo, 'gano', gano, 'prod', prod, 'en', ahora,
    'fecha', privado.juego_hoy()::text, 'semana', act::text, 'estado', case when gano then 'pendiente' else null end));
  return jsonb_build_object('id', nid, 'gano', gano, 'prod', prod);
end $$;
create or replace function public.juego_racha(p_cliente text default null) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare cid text := privado.juego_cid(p_cliente); c jsonb := privado.juego_cfg(); r jsonb; meta int; prod text; nid text; ahora bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if privado.cliente_es_local(cid) then raise exception 'Los juegos son para clientes particulares' using errcode = 'P0001'; end if;
  if not coalesce((c->'racha'->>'activo')::boolean, true) then raise exception 'La racha no está disponible' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('juego_' || cid));
  r := privado.juego_racha_de(cid); meta := greatest(2, coalesce((c->'racha'->>'semanas')::int, 4)); prod := c->'racha'->>'premio';
  if (r->>'semanas')::int < meta or prod is null then raise exception 'Aún no completas la racha' using errcode = 'P0001'; end if;
  nid := 'jg' || to_hex(ahora) || substr(md5(random()::text), 1, 5);
  insert into documentos (coleccion, id, data) values ('juegos', nid, jsonb_build_object('clienteId', cid, 'tipo', 'racha', 'gano', true, 'prod', prod, 'en', ahora,
    'fecha', privado.juego_hoy()::text, 'semana', r->>'tope', 'estado', 'pendiente'));
  return jsonb_build_object('id', nid, 'gano', true, 'prod', prod);
end $$;
create or replace function public.juego_canjear(ids text[], pedido text, p_cliente text default null) returns int language plpgsql security definer set search_path to 'public' as $$
declare cid text := privado.juego_cid(p_cliente); n int;
begin
  if not exists (select 1 from documentos where coleccion = 'pedidos' and id = pedido and data->>'clienteId' = cid) then return 0; end if;
  update documentos set data = data || jsonb_build_object('estado', 'canjeado', 'pedido', pedido, 'canjeadoEn', (extract(epoch from now()) * 1000)::bigint)
   where coleccion = 'juegos' and id = any(ids) and data->>'clienteId' = cid and data->>'estado' = 'pendiente';
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.juego_estado(text), public.juego_jugar(text, text), public.juego_racha(text), public.juego_canjear(text[], text, text) from public;
grant execute on function public.juego_estado(text), public.juego_jugar(text, text), public.juego_racha(text), public.juego_canjear(text[], text, text) to anon, authenticated;
-- Los clientes no escriben ni leen «juegos» directamente: todo va por las funciones de arriba.
create or replace function privado.es_propio(c text, i text, d jsonb)
 returns boolean language plpgsql stable set search_path to 'public' as $function$
declare p text := privado.dato('portal'); yo text := privado.dato('cuenta');
begin
  if p is null or yo is null then return false; end if;
  if p = 'cliente' then
    if c = 'clientes' then return i = yo; end if;
    if privado.es_cuentas(c) or c = 'registro_sistema' or c = 'juegos' then return false; end if;
    if c = 'programados_auto' then return i = yo; end if;
    if c in ('facturas','comprobantes') then
      return privado.pedido_propio(coalesce(d ->> 'pedido', split_part(i, '__p', 1)));
    end if;
    return d ->> 'clienteId' = yo;
  elsif p = 'pizzas' then
    if c = 'usuarios_pizzas' then return i = yo; end if;
    if c = 'pedidos_pizzas' then return d ->> 'usuarioPz' = yo; end if;
    return false;
  elsif p = 'prov' then
    if c = 'proveedores' then return i = yo; end if;
    if c = 'prov_pedidos' then return d ->> 'proveedorId' = yo; end if;
    if c = 'comprobantes_prov' then
      return d ->> 'proveedorId' = yo or privado.prov_pedido_propio(coalesce(d ->> 'pedido', i));
    end if;
    if c in ('mensajes', 'mensajes_fotos', 'mensajes_leidos', 'encuestas') then return d ->> 'proveedorId' = yo; end if;
    return false;
  end if;
  return false;
end $function$;
-- Solo cuentan los pedidos entregados desde hoy.
insert into documentos (coleccion, id, data) values ('config', 'juego', jsonb_build_object('desde', (extract(epoch from now()) * 1000)::bigint))
on conflict (coleccion, id) do update set data = documentos.data || jsonb_build_object('desde', coalesce((documentos.data->>'desde')::bigint, (extract(epoch from now()) * 1000)::bigint));
