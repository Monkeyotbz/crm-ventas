-- Sprint 1 — bandeja unificada, solo lectura (docs/pendientes.md).
--
-- La lista de conversaciones necesita, por fila: el contacto, el último
-- mensaje (para la preview), el deal asociado (valor, etapa) y los insights
-- del copiloto — cuatro tablas. Resolverlo con joins anidados desde
-- supabase-js es fràgil (el JOIN de deals no tiene FK directa con
-- conversations, solo comparten contact_id) y no deja limitar "el último
-- mensaje" a uno solo sin traer todos. Una vista es lo que ya usa este mismo
-- esquema para el mismo problema (contact_latest_insight) — se sigue ese
-- patrón, no se inventa uno nuevo.
--
-- security_invoker = true: la vista corre con los permisos y las RLS de
-- QUIEN LA CONSULTA, no del dueño de la vista — sin esto, RLS quedaría
-- decorativa (cualquier usuario vería todos los tenants a través de la
-- vista). Mismo criterio que la vista existente.
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
  um.contenido as ultimo_mensaje_contenido
from conversations co
join contacts c on c.id = co.contact_id
-- LATERAL, no un LEFT JOIN liso: un contacto puede tener más de un deal (un
-- pipeline Transaccional y uno de Ventas a la vez), y un join liso duplicaría
-- la fila de la conversación por cada deal. Se elige el más reciente — es una
-- simplificación deliberada para esta primera versión de la bandeja, no un
-- descuido: el día que haga falta elegir "el deal de ESTE canal" en vez de
-- "el último creado", hace falta una relación conversación→deal que hoy no
-- existe en el esquema.
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

comment on view inbox_conversaciones is
  'Una fila por conversación con todo lo que necesita el listado de la bandeja unificada (Sprint 1): contacto, último mensaje, deal más reciente del contacto, insights del copiloto. security_invoker=true — RLS corre como quien consulta. El deal es "el más reciente del contacto", no "el de este canal": el esquema no tiene esa relación directa hoy.';
