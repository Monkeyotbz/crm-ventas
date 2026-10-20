-- Agente Analista (candidato [7b] de docs/DECISIONES.md).
--
-- Llena conversation_insights, que alimenta el panel Copiloto de la Bandeja. Esta
-- migración pone todo lo que el agente necesita del lado de la base:
--   1. tres columnas en conversation_insights para saber CUÁNDO y HASTA QUÉ
--      mensaje se analizó, y con qué modelo;
--   2. cierra la escritura desde el navegador (la policy era `for all`);
--   3. analista_ejecuciones: tokens y costo de cada análisis, desde el primer día;
--   4. el trigger que dispara la Edge Function supabase/functions/analista/;
--   5. la vista de la bandeja ve los campos nuevos.
--
-- El secret del header (x-analista-secret) vive en Vault, como router_secret. Se
-- siembra aparte, nunca en este archivo:
--   select vault.create_secret('<valor>', 'analista_secret', '...');

-- ---------------------------------------------------------------------------
-- 1. Trazabilidad del análisis
-- ---------------------------------------------------------------------------
alter table conversation_insights
  add column if not exists modelo text,
  add column if not exists ultimo_mensaje_id bigint,
  add column if not exists analizado_at timestamptz;

comment on column conversation_insights.ultimo_mensaje_id is
  'Id del último mensaje que el Analista tuvo a la vista. Si hay mensajes con id mayor, el análisis está desactualizado.';
comment on column conversation_insights.analizado_at is
  'Cuándo corrió el Analista. updated_at no sirve para esto: cualquier escritura lo mueve.';

-- ---------------------------------------------------------------------------
-- 2. Escritura solo del lado servidor
-- ---------------------------------------------------------------------------
-- La policy original era `for all`: el dueño de la conversación (o un admin)
-- podía hacer update del score desde el navegador con su propio JWT. Si el
-- vendedor puede editar lo que el copiloto "analizó", ese análisis deja de ser
-- una medición. Ahora el navegador solo lee; el Analista escribe con
-- service_role, que no pasa por RLS.
drop policy if exists "conversation_insights: vía conversación" on conversation_insights;

create policy "conversation_insights: lectura vía conversación" on conversation_insights
  for select using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and c.tenant_id = private.current_tenant_id()
        and (c.owner_id = auth.uid() or private.is_admin(auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Costo de cada análisis
-- ---------------------------------------------------------------------------
create table if not exists analista_ejecuciones (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  conversation_id bigint not null,
  modelo text not null,
  tokens_entrada integer,
  tokens_salida integer,
  -- Estimado con la tabla de precios del código de la función, que hay que
  -- verificar contra la página de precios de Anthropic. No es la factura.
  costo_usd numeric(10, 6),
  duracion_ms integer,
  resultado text not null check (resultado in ('ok', 'error')),
  error text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conversation_id)
    references conversations (tenant_id, id) on delete cascade
);

create index if not exists analista_ejecuciones_tenant_fecha_idx
  on analista_ejecuciones (tenant_id, created_at desc);
create index if not exists analista_ejecuciones_conversacion_idx
  on analista_ejecuciones (conversation_id);

alter table analista_ejecuciones enable row level security;

-- Solo lectura y solo para admins del tenant: es gasto interno del negocio, no
-- algo que cada vendedor tenga que ver. Sin policy de escritura: la escribe la
-- función con service_role.
create policy "analista_ejecuciones: lectura de admin del tenant" on analista_ejecuciones
  for select using (
    tenant_id = private.current_tenant_id() and private.is_admin(auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4. Disparo
-- ---------------------------------------------------------------------------
-- Mismo patrón que private.disparar_router(). No se frena la espera mínima entre
-- análisis acá sino en la función, que ya tiene que leer la fila de insights.
create or replace function private.disparar_analista()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  -- Solo entrantes: que el vendedor responda no cambia lo que piensa el cliente.
  if new.direccion <> 'in' then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'analista_secret';

  if v_secret is null then
    -- No se rompe el insert del mensaje por un problema de configuración.
    raise warning 'disparar_analista: no se encontró el secret "analista_secret" en Vault';
    return new;
  end if;

  perform net.http_post(
    url := 'https://jrygtluycndiyvrxjmib.supabase.co/functions/v1/analista',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'schema', 'public',
      'record', to_jsonb(new)
    ),
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'x-analista-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

comment on function private.disparar_analista() is
  'Dispara supabase/functions/analista/ vía net.http_post en cada insert de mensaje entrante. Mismo patrón que disparar_router().';

drop trigger if exists trg_disparar_analista on messages;
create trigger trg_disparar_analista
  after insert on messages
  for each row
  execute function private.disparar_analista();

-- ---------------------------------------------------------------------------
-- 5. La bandeja ve los campos nuevos
-- ---------------------------------------------------------------------------
-- create or replace view solo permite AGREGAR columnas al final: por eso van
-- después de ultimo_mensaje_contenido y no junto a las de insights.
create or replace view inbox_conversaciones
with (security_invoker = true) as
select
  co.id as conversation_id,
  co.tenant_id,
  co.canal,
  co.estado,
  co.ultimo_mensaje_at,
  co.ventana_abierta_hasta,
  co.owner_id,
  c.id as contact_id,
  c.nombre as contacto_nombre,
  c.empresa as contacto_empresa,
  d.id as deal_id,
  d.valor_estimado,
  d.probabilidad,
  ps.nombre as etapa_nombre,
  p.nombre as pipeline_nombre,
  ci.score,
  ci.sentimiento,
  ci.nivel_interes,
  ci.sugerencia,
  um.direccion as ultimo_mensaje_direccion,
  um.contenido as ultimo_mensaje_contenido,
  ci.resumen,
  ci.presupuesto_extraido,
  ci.proxima_accion_sugerida,
  ci.analizado_at as insight_analizado_at,
  ci.ultimo_mensaje_id as insight_ultimo_mensaje_id
from conversations co
join contacts c on c.id = co.contact_id
left join lateral (
  select d2.*
  from deals d2
  where d2.contact_id = c.id
  order by d2.created_at desc
  limit 1
) d on true
left join pipeline_stages ps on ps.id = d.stage_id
left join pipelines p on p.id = d.pipeline_id
left join conversation_insights ci on ci.conversation_id = co.id
left join lateral (
  select m.direccion, m.contenido
  from messages m
  where m.conversation_id = co.id
  order by m.created_at desc
  limit 1
) um on true;
