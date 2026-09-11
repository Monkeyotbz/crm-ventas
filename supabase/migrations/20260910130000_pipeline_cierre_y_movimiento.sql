-- Modelo de datos del Pipeline: etapas terminales, cierre de oportunidades y
-- movimiento con historial.
--
-- El hueco que cierra: hasta hoy NADA movía un deal de etapa. El Router lo crea
-- en la primera etapa del pipeline que eligió (supabase/functions/router/index.ts)
-- y ahí queda congelado para siempre; el único update de stage_id del repo es una
-- reclasificación de pipeline, que lo DEVUELVE a la primera etapa. Por eso el
-- Panel de hoy no puede mostrar conversión, ciclo de venta ni ingreso ganado.
--
-- Las tablas deals / pipeline_stages / pipelines YA existen desde
-- 20260825115320 y 20260825120751. Esta migración las completa; no crea un
-- modelo paralelo. En particular NO se crea una tabla `deal_stages`: ese papel
-- lo cumple `pipeline_stages`, que además ya cuelga de `pipelines` (los tres
-- embudos A/B/C viven ahí, como filas con `tipo`, no como un campo de texto).

-- ---------------------------------------------------------------------------
-- 1. Etapas terminales: pipeline_stages.tipo
-- ---------------------------------------------------------------------------
-- Hasta hoy "ganado" estaba codificado ÚNICAMENTE en el texto del nombre. Y los
-- nombres difieren entre los pipelines de un mismo tenant: el consultivo dice
-- 'Ganado'/'Perdido', el transaccional y el de expansión dicen 'Cerrado ganado'/
-- 'Cerrado perdido' (ver el seed de 20260902123843). Cualquier métrica de cierre
-- tendría que comparar strings, y se rompe el día que un tenant del carril
-- masivo renombre su etapa a "Cerramos!!".
--
-- Con esta columna, la tasa de conversión se calcula igual para todos aunque
-- cada uno bautice sus etapas como quiera.

alter table pipeline_stages
  add column if not exists tipo text not null default 'abierta';

do $$ begin
  alter table pipeline_stages
    add constraint pipeline_stages_tipo_check check (tipo in ('abierta', 'ganada', 'perdida'));
exception when duplicate_object then null; end $$;

comment on column pipeline_stages.tipo is
  'Rol de la etapa en el embudo: abierta (en curso), ganada o perdida. Es la base de TODAS las métricas de cierre — se consulta esto, nunca el nombre, que cada tenant elige libremente.';

-- Backfill por nombre. Es legítimo acá y solo acá: son los nombres exactos que
-- sembraron 20260825115320 (Ganado/Perdido) y 20260902123843 (Cerrado ganado/
-- Cerrado perdido), y ocurre una única vez. De acá en adelante el dato es `tipo`.
update pipeline_stages set tipo = 'ganada'  where nombre in ('Ganado', 'Cerrado ganado');
update pipeline_stages set tipo = 'perdida' where nombre in ('Perdido', 'Cerrado perdido');

-- ---------------------------------------------------------------------------
-- 2. Policy de escritura de pipeline_stages
-- ---------------------------------------------------------------------------
-- La tabla tenía UNA sola policy, de select (20260825115320). Con RLS activo eso
-- significaba que ningún tenant podía editar su propio embudo desde la app —
-- justo lo contrario de por qué las etapas son una tabla y no un enum.
--
-- Sin esto, un cliente del carril masivo no puede adaptar su embudo solo, que es
-- la regla de oro del proyecto (ver CLAUDE.md, "Se vende por dos carriles").
-- Mismo patrón que ya usa `pipelines` en 20260825121058.

do $$ begin
  create policy "pipeline_stages: escritura de admin" on pipeline_stages
    for all
    using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
    with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Columnas nuevas en deals
-- ---------------------------------------------------------------------------

alter table deals
  add column if not exists titulo text,
  add column if not exists moneda text not null default 'USD',
  add column if not exists conversation_id bigint,
  add column if not exists stage_changed_at timestamptz not null default now(),
  add column if not exists closed_at timestamptz;

-- El deal cuelga del CONTACTO (así lo resuelve el Router), pero necesita saber de
-- qué conversación nació para poder mostrar ese hilo en el panel de detalle. Es
-- la opción B: se agrega el vínculo del lado del deal en vez de un deal_id en
-- messages — un mensaje ambiguo (el saludo inicial, antes de saber qué quiere)
-- no tendría a qué apuntar.
do $$ begin
  alter table deals
    add constraint deals_conversation_fk
    foreign key (tenant_id, conversation_id) references conversations (tenant_id, id) on delete set null;
exception when duplicate_object then null; end $$;

comment on column deals.titulo is
  'Qué se está vendiendo. Nullable a propósito: hoy nadie lo escribe, y la UI cae al nombre del contacto. Que el Router lo genere se decide junto con el avance automático de etapas.';
comment on column deals.stage_changed_at is
  'Cuándo entró a la etapa actual. Es lo que responde "¿qué oportunidades llevan días sin moverse?" — la pregunta que convierte el tablero en una lista de pendientes en vez de un archivo muerto.';
comment on column deals.closed_at is
  'Se llena solo (via mover_deal) cuando la etapa destino es ganada o perdida; vuelve a null si el deal se reabre. Habilita ciclo de venta = closed_at - created_at.';

create index if not exists idx_deals_conversation_id on deals (conversation_id);
create index if not exists idx_deals_closed_at on deals (closed_at);

-- ---------------------------------------------------------------------------
-- 4. deals.pipeline_id a NOT NULL
-- ---------------------------------------------------------------------------
-- Quedó nullable en 20260825120751 mientras pipeline_stages.pipeline_id sí se
-- puso NOT NULL. Un tablero agrupado por pipeline perdería esas filas en
-- silencio. Se arregla ahora, que hay una sola fila; con datos reales sería un
-- backfill incómodo.
update deals d
   set pipeline_id = s.pipeline_id
  from pipeline_stages s
 where s.id = d.stage_id
   and d.pipeline_id is null;

alter table deals alter column pipeline_id set not null;

-- ---------------------------------------------------------------------------
-- 5. deal_events — el log de negocio del pipeline
-- ---------------------------------------------------------------------------
-- NO es cierto que no hubiera historial: audit_log + el trigger
-- trg_audit_deal_stage (20260825115320) ya registran cada cambio de stage_id, en
-- la misma transacción del update. Los dos conviven y hacen cosas distintas:
--
--   audit_log   → log de SEGURIDAD. Su columna `actor` es uuid, así que no puede
--                 representar al bot (que no tiene usuario). Responde "¿quién
--                 tocó qué?" para auditar una sesión de soporte.
--   deal_events → log de NEGOCIO. Distingue bot / humano / sistema y guarda el
--                 motivo de pérdida. Responde "¿cuánto cierra la IA sin que
--                 intervenga una persona?" y "¿cuánto tarda cada etapa?".
--
-- Append-only: no lleva policy de insert/update/delete. La única vía de
-- escritura es mover_deal(), que es security definer.

create table if not exists deal_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  deal_id bigint not null,
  -- null en el primer evento de un deal: la UI lo muestra como "Creado en X",
  -- no como "— → X".
  de_stage_id bigint,
  a_stage_id bigint not null,
  actor text not null check (actor in ('bot', 'humano', 'sistema')),
  -- Solo se llena cuando actor = 'humano'. El bot no tiene fila en auth.users.
  actor_user_id uuid references auth.users (id),
  motivo text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, a_stage_id) references pipeline_stages (tenant_id, id),
  foreign key (tenant_id, de_stage_id) references pipeline_stages (tenant_id, id),
  unique (tenant_id, id)
);

comment on table deal_events is
  'Historial append-only de movimientos de etapa. De acá salen el tiempo por etapa, la tasa de conversión y cuánto cierra el bot solo. Nunca se actualiza ni se borra; solo lo escribe public.mover_deal().';

-- Reconstruir la línea de tiempo de un deal sin este índice recorre la tabla
-- entera. Barato ahora, molesto después.
create index if not exists idx_deal_events_deal on deal_events (deal_id, created_at);
create index if not exists idx_deal_events_tenant on deal_events (tenant_id);

alter table deal_events enable row level security;

-- Espeja la regla de `deals`: un 'agent' ve el historial de SUS oportunidades, un
-- owner/admin el de todo el tenant. Sin esto, un vendedor podría leer el
-- historial de deals que no puede ver en la tabla deals.
do $$ begin
  create policy "deal_events: lectura del propio tenant" on deal_events
    for select
    using (
      tenant_id = private.current_tenant_id()
      and exists (
        select 1 from deals d
         where d.tenant_id = deal_events.tenant_id
           and d.id = deal_events.deal_id
           and (d.owner_id = auth.uid() or private.is_admin(auth.uid()))
      )
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 6. public.mover_deal() — la única forma de mover una oportunidad
-- ---------------------------------------------------------------------------
-- La atomicidad NO es el motivo de que exista: el trigger de audit_log ya corre
-- en la misma transacción que el update, así que hoy tampoco se puede mover un
-- deal sin dejar rastro. Lo que aporta esta función es la VALIDACIÓN:
--
--   · que la etapa destino sea del mismo tenant Y del mismo pipeline;
--   · que una pérdida traiga motivo;
--   · que closed_at y stage_changed_at se llenen solos, sin depender de que
--     cada quien que mueva un deal se acuerde de hacerlo.

create or replace function public.mover_deal(
  p_deal_id bigint,
  p_stage_id bigint,
  p_actor text default 'humano',
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant       uuid;
  v_deal         record;
  v_etapa        record;
  v_actor        text;
  v_actor_user   uuid;
  v_motivo       text;
begin
  v_tenant := private.current_tenant_id();
  if v_tenant is null then
    raise exception 'No hay tenant en la sesión';
  end if;

  -- El deal, del tenant actual y visible para quien llama. security definer
  -- saltea la RLS, así que la regla de dueño/admin se aplica acá a mano — si no,
  -- un 'agent' podría mover oportunidades de sus compañeros.
  select d.id, d.stage_id, d.pipeline_id, d.owner_id
    into v_deal
    from public.deals d
   where d.tenant_id = v_tenant and d.id = p_deal_id;

  if not found then
    raise exception 'La oportunidad % no existe en este espacio', p_deal_id;
  end if;

  if not (v_deal.owner_id = auth.uid() or private.is_admin(auth.uid())) then
    raise exception 'No tenés permiso para mover esta oportunidad';
  end if;

  -- La etapa destino, del mismo tenant Y del mismo pipeline. El filtro por
  -- tenant es el que impide el cruce entre espacios; el de pipeline impide que
  -- un deal del embudo transaccional caiga en una etapa del consultivo.
  select s.id, s.tipo, s.pipeline_id
    into v_etapa
    from public.pipeline_stages s
   where s.tenant_id = v_tenant and s.id = p_stage_id;

  if not found then
    raise exception 'La etapa % no existe en este espacio', p_stage_id;
  end if;

  if v_etapa.pipeline_id is distinct from v_deal.pipeline_id then
    raise exception 'La etapa % pertenece a otro embudo que el de la oportunidad', p_stage_id;
  end if;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');

  if v_etapa.tipo = 'perdida' and v_motivo is null then
    raise exception 'Para dar una oportunidad por perdida hace falta indicar el motivo';
  end if;

  -- El actor NO se confía al cliente. Si hay alguien logueado, el movimiento es
  -- humano y punto: sin esto, un vendedor podría atribuirle sus movimientos al
  -- bot e inflar la métrica de "cuánto cierra la IA sola". Solo el contexto
  -- service_role (auth.uid() null) — o sea el Router — puede declarar su actor.
  if auth.uid() is not null then
    v_actor      := 'humano';
    v_actor_user := auth.uid();
  else
    v_actor      := coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'sistema');
    v_actor_user := null;
    if v_actor not in ('bot', 'humano', 'sistema') then
      raise exception 'Actor inválido: %', v_actor;
    end if;
  end if;

  -- Mover y cerrar. closed_at vuelve a null si el deal se reabre hacia una etapa
  -- abierta, para que el ciclo de venta no quede mintiendo.
  update public.deals
     set stage_id         = p_stage_id,
         stage_changed_at = now(),
         closed_at        = case when v_etapa.tipo in ('ganada', 'perdida') then now() else null end
   where tenant_id = v_tenant and id = p_deal_id;

  insert into public.deal_events (tenant_id, deal_id, de_stage_id, a_stage_id, actor, actor_user_id, motivo)
  values (v_tenant, p_deal_id, v_deal.stage_id, p_stage_id, v_actor, v_actor_user, v_motivo);
end;
$$;

comment on function public.mover_deal(bigint, bigint, text, text) is
  'Mueve una oportunidad de etapa: valida tenant/embudo/permiso, exige motivo si es pérdida, actualiza stage_changed_at y closed_at, y deja el evento en deal_events. Es la única vía de movimiento — un update directo a deals.stage_id se saltea todo esto.';

-- Postgres crea toda función ejecutable por PUBLIC. El revoke va ANTES del grant.
revoke all on function public.mover_deal(bigint, bigint, text, text) from public, anon;
grant execute on function public.mover_deal(bigint, bigint, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Vista de lectura: pipeline_tablero
-- ---------------------------------------------------------------------------
-- El contrato entre backend y frontend, definido ANTES de la pantalla. Una fila
-- por oportunidad con todo lo que necesita la tarjeta, para no hacer joins
-- anidados frágiles desde el cliente — mismo criterio que inbox_conversaciones.
--
-- security_invoker = true es lo que hace que la vista herede la RLS de las tablas
-- base. Sin eso correría con los permisos del dueño de la vista y filtraría entre
-- tenants.

create or replace view pipeline_tablero
with (security_invoker = true) as
select
  d.id                                as deal_id,
  d.tenant_id,
  -- Nadie escribe `titulo` todavía; caer al nombre del contacto evita tarjetas
  -- sin encabezado y deja de ser necesario el día que el Router lo genere.
  coalesce(nullif(btrim(coalesce(d.titulo, '')), ''), c.nombre) as titulo,
  c.id                                as contacto_id,
  c.nombre                            as contacto_nombre,
  c.empresa                           as contacto_empresa,
  d.valor_estimado,
  d.moneda,
  d.probabilidad,
  d.fuente,
  d.conversation_id,
  d.owner_id,
  p.id                                as pipeline_id,
  p.nombre                            as pipeline_nombre,
  p.tipo                              as pipeline_tipo,
  s.id                                as stage_id,
  s.nombre                            as etapa_nombre,
  s.orden                             as etapa_orden,
  s.color                             as etapa_color,
  s.tipo                              as etapa_tipo,
  d.created_at,
  d.stage_changed_at,
  d.closed_at,
  -- Calculados al vuelo a propósito: guardarlos los dejaría desincronizados de
  -- la fecha de la que salen, y el cálculo es barato.
  extract(epoch from (now() - d.stage_changed_at)) / 3600.0 as horas_en_etapa,
  case when d.closed_at is not null
       then extract(epoch from (d.closed_at - d.created_at)) / 3600.0
  end                                                        as horas_ciclo
from deals d
join contacts c        on c.tenant_id = d.tenant_id and c.id = d.contact_id
join pipeline_stages s on s.tenant_id = d.tenant_id and s.id = d.stage_id
join pipelines p       on p.tenant_id = d.tenant_id and p.id = d.pipeline_id;

comment on view pipeline_tablero is
  'Una fila por oportunidad, lista para pintar una tarjeta del tablero. security_invoker: hereda la RLS de deals, así que un agent ve solo las suyas. Los totales de cabecera se agregan desde esta misma vista.';

grant select on pipeline_tablero to authenticated;
