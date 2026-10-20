-- Métricas por consulta del RAG (paso 11 del traspaso, candidato [10] de docs/DECISIONES.md).
--
-- Una fila por pregunta que pasa por el RAG, para medir EN PRODUCCIÓN lo que hasta ahora solo se mide
-- a mano con el set de evaluación: la similitud máxima (la mejor alarma de que algo cambió), la tasa de
-- abstención, la latencia desglosada, los tokens, el costo, y con qué prompt y modelo se respondió.
-- Mismo patrón que analista_ejecuciones (migración 20260918120000).
--
-- PRIVACIDAD: la pregunta del cliente YA está guardada en `messages`. Esta tabla NO la copia: apunta al
-- mensaje con `message_id`. El texto propio (`consulta_texto`) solo existe cuando no hay cliente de por
-- medio (la consola o una evaluación), y un check impide guardar texto junto con una conversación.
--
-- ESCRITURA solo del lado servidor (service_role): no hay policy de insert/update/delete a propósito,
-- igual que kb_chunks y analista_ejecuciones. Un navegador no debe poder inventar métricas.

create table if not exists public.rag_consultas (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id),

  -- De dónde viene la consulta
  conversation_id bigint,
  -- FK simple y no compuesta: `messages` no tiene tenant_id (lo hereda de la conversación). La
  -- coherencia de tenant la da la FK compuesta de conversation_id y la escritura solo del servidor.
  message_id bigint references public.messages (id) on delete set null,
  consulta_texto text,
  origen text not null default 'agente'
    check (origen in ('agente', 'copiloto', 'consola', 'evaluacion')),

  -- Recuperación
  k smallint not null,
  recuperados jsonb not null default '[]',   -- [{"slug": "...", "sim": 0.53}, ...] en orden
  sim_max real,                              -- similitud del mejor resultado
  ms_embedding integer,
  ms_busqueda integer,

  -- Respuesta
  respondio boolean,                         -- null si solo hubo recuperación; false = «no lo sé»
  fuentes text[] not null default '{}',
  ms_llm integer,
  tokens_embedding integer,
  tokens_entrada integer,
  tokens_salida integer,
  -- Estimado con una tabla de precios en el código, que hay que verificar. No es la factura.
  costo_usd numeric(10, 6),

  -- Versiones: sin esto no se puede comparar un cambio con el anterior
  prompt_version text,
  modelo text,
  modelo_embedding text,

  -- Calidad
  corregida_por_humano boolean,
  auditada boolean not null default false,   -- true si un juez revisó esta respuesta (se audita una muestra)
  afirmaciones_sin_respaldo smallint,
  datos_sin_respaldo smallint,               -- las de gravedad «dato»: las que importan

  -- Fallos (429 de Voyage, 400 de Anthropic, timeouts)
  error text,

  created_at timestamptz not null default now(),

  foreign key (tenant_id, conversation_id)
    references public.conversations (tenant_id, id) on delete cascade,
  constraint rag_consultas_texto_solo_sin_cliente
    check (consulta_texto is null or conversation_id is null)
);

create index if not exists rag_consultas_tenant_fecha_idx
  on public.rag_consultas (tenant_id, created_at desc);
create index if not exists rag_consultas_conversacion_idx
  on public.rag_consultas (conversation_id) where conversation_id is not null;

alter table public.rag_consultas enable row level security;

-- Solo lectura y solo para admins del tenant: es información de operación, no algo que cada vendedor
-- tenga que ver. El tablero de plataforma la lee con permisos de plataforma, no con esta policy.
create policy "rag_consultas: lectura de admin del tenant" on public.rag_consultas
  for select using (
    tenant_id = private.current_tenant_id() and private.is_admin(auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Vista diaria: lo que mira quien opera el sistema
-- ---------------------------------------------------------------------------
-- security_invoker: corre con los permisos de quien consulta, así que la policy de arriba aísla por
-- tenant (mismo criterio que inbox_conversaciones y pipeline_tablero).
--
-- Cómo leerla (de lo aprendido al medir, 20 oct 2026): la ABSTENCIÓN y la SIMILITUD se leen JUNTAS.
-- Si la abstención sube sin que baje la similitud, el prompt se volvió demasiado cauteloso. Si la
-- abstención baja y la similitud máxima también, el sistema está contestando cosas que no tiene:
-- riesgo de inventos. Un umbral de similitud solo no separa «no hay respuesta» de «pregunta vaga».
create or replace view public.rag_metricas_diarias
with (security_invoker = true) as
select
  tenant_id,
  -- Mercado de Colombia: el «día» se corta a medianoche de Bogotá, no de UTC.
  (created_at at time zone 'America/Bogota')::date as fecha,
  coalesce(prompt_version, '(sin versión)') as prompt_version,
  origen,
  count(*) as consultas,
  count(*) filter (where respondio) as respondidas,
  count(*) filter (where respondio is false) as abstenciones,
  round(100.0 * count(*) filter (where respondio is false)
        / nullif(count(*) filter (where respondio is not null), 0), 1) as pct_abstencion,
  round((percentile_cont(0.5) within group (order by sim_max))::numeric, 3) as sim_max_p50,
  round((percentile_cont(0.05) within group (order by sim_max))::numeric, 3) as sim_max_p05,
  round((percentile_cont(0.5) within group (order by ms_busqueda))::numeric) as ms_busqueda_p50,
  round((percentile_cont(0.95) within group (order by ms_busqueda))::numeric) as ms_busqueda_p95,
  round((percentile_cont(0.95) within group (order by ms_llm))::numeric) as ms_llm_p95,
  round(avg(tokens_entrada)) as tokens_entrada_medio,
  sum(costo_usd) as costo_usd,
  count(*) filter (where error is not null) as errores,
  count(*) filter (where corregida_por_humano) as corregidas_por_humano,
  count(*) filter (where auditada) as auditadas,
  sum(datos_sin_respaldo) filter (where auditada) as datos_sin_respaldo
from public.rag_consultas
group by 1, 2, 3, 4;

comment on view public.rag_metricas_diarias is
  'Métricas diarias del RAG por tenant, versión de prompt y origen. security_invoker: la RLS de rag_consultas aísla por tenant.';
