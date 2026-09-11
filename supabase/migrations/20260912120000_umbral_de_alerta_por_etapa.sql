-- Umbral de "sin moverse" por etapa, para el tablero de Pipeline.
--
-- Columna, no constante en JS: cada tenant define su propio embudo (ya lo
-- decidimos con `pipeline_stages.tipo`), y el ritmo de "esto lleva demasiado
-- sin moverse" no es el mismo para un alquiler de 3 noches que para un ERP de
-- 6 meses. Una constante global estaría mal calibrada para casi todos.
--
-- Mismo criterio que `tenants.modulos` (migración 20260910120000): el dato
-- queda listo en la base desde ya, aunque hoy no exista una pantalla para
-- editarlo por etapa. Se configura por SQL hasta que haya una pantalla de
-- administración de etapas — fuera de esta tanda.

alter table pipeline_stages add column if not exists horas_alerta int;

comment on column pipeline_stages.horas_alerta is
  'Horas en esta etapa antes de que el tablero la marque como estancada. Null = sin alerta (uso normal en etapas ganada/perdida, donde "sin moverse" no aplica). El tablero deriva dos niveles con un multiplicador fijo del lado del cliente: por encima de este número, ámbar; por encima del triple, rojo.';

-- Backfill: 48h para las etapas abiertas que ya existen. ganada/perdida quedan
-- en null a propósito — una oportunidad cerrada no necesita alerta de
-- estancamiento, ya terminó su recorrido.
update pipeline_stages set horas_alerta = 48 where tipo = 'abierta' and horas_alerta is null;

-- pipeline_tablero (migración 20260910130000) necesita este dato para que el
-- tablero pueda colorear cada tarjeta: se agrega la columna a la vista en vez
-- de que el cliente haga una segunda consulta a pipeline_stages por cada fila.
create or replace view pipeline_tablero
with (security_invoker = true) as
select
  d.id                                as deal_id,
  d.tenant_id,
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
  extract(epoch from (now() - d.stage_changed_at)) / 3600.0 as horas_en_etapa,
  case when d.closed_at is not null
       then extract(epoch from (d.closed_at - d.created_at)) / 3600.0
  end                                                        as horas_ciclo,
  -- Agregada al final a propósito: `create or replace view` de Postgres no
  -- permite reordenar columnas existentes, solo agregar al final.
  s.horas_alerta                      as etapa_horas_alerta
from deals d
join contacts c        on c.tenant_id = d.tenant_id and c.id = d.contact_id
join pipeline_stages s on s.tenant_id = d.tenant_id and s.id = d.stage_id
join pipelines p       on p.tenant_id = d.tenant_id and p.id = d.pipeline_id;

grant select on pipeline_tablero to authenticated;
