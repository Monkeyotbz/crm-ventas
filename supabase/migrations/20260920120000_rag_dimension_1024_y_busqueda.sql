-- RAG por tenant (candidato [10] de docs/DECISIONES.md).
--
-- Tres cosas, en este orden:
--   1. kb_chunks.embedding pasa de vector(1536) a vector(1024), la dimensión de Voyage AI
--      `voyage-3.5` (decisión del 20 oct 2026; la columna estaba pensada para OpenAI 1536).
--   2. kb_chunks gana lo que necesita una ingesta IDEMPOTENTE y reindexable: `origen_id` (el
--      registro del que salió el fragmento), `contenido_hash` (para saber si cambió) y
--      `actualizado_at`, más una restricción única para que reingestar actualice en vez de duplicar.
--   3. match_kb_chunks(): la búsqueda por similitud. El aislamiento entre tenants lo hace la RLS
--      (security invoker), nunca un tenant_id que llegue por parámetro.
--
-- SEGURO DE DATOS: cambiar la dimensión de una columna vector destruye lo que haya en ella. El
-- 20 oct 2026 la tabla tenía 0 filas (verificado). Si para cuando se aplique tiene alguna, esta
-- migración se detiene en vez de borrarlas: ahí hay que decidir a mano si se recalculan.
--
-- Cambiar de modelo de embeddings en el futuro obliga a recalcular TODOS los vectores.

do $guardia$
begin
  if exists (select 1 from public.kb_chunks) then
    raise exception 'kb_chunks ya tiene filas: cambiar la dimension del vector las destruiria. Decidir a mano antes de seguir.';
  end if;
end
$guardia$;

-- ---------------------------------------------------------------------------
-- 1. Dimensión 1024
-- ---------------------------------------------------------------------------
drop index if exists public.idx_kb_chunks_embedding;
alter table public.kb_chunks drop column embedding;
alter table public.kb_chunks add column embedding extensions.vector(1024);

-- Coseno, el mismo operador que la función de búsqueda (<=>): si no coinciden, el índice no se usa.
create index idx_kb_chunks_embedding
  on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 2. Ingesta idempotente y reindexable
-- ---------------------------------------------------------------------------
alter table public.kb_chunks
  add column if not exists origen_id text,
  add column if not exists contenido_hash text,
  add column if not exists actualizado_at timestamptz not null default now();

comment on column public.kb_chunks.origen_id is
  'Id del registro del que salió el fragmento (ej. el slug del tour). Con tenant_id y fuente identifica al fragmento: reingestar lo actualiza.';
comment on column public.kb_chunks.contenido_hash is
  'Hash del texto del fragmento. Si no cambió, la ingesta no vuelve a pagar el embedding.';

-- Restricción completa y no un índice parcial a propósito: PostgREST (supabase-js .upsert con
-- onConflict) no sabe inferir un índice único parcial y fallaría. Los NULL no chocan entre sí,
-- así que los fragmentos sin origen siguen siendo posibles.
alter table public.kb_chunks
  add constraint kb_chunks_origen_key unique (tenant_id, fuente, origen_id);

-- ---------------------------------------------------------------------------
-- 3. Búsqueda por similitud
-- ---------------------------------------------------------------------------
-- security INVOKER: corre con los permisos de quien la llama, así que la policy
-- "kb_chunks: lectura del propio tenant" decide qué filas existen para esa persona. Por eso no
-- recibe tenant_id: uno que viniera del cliente sería exactamente el hueco que la RLS evita.
--
-- El ORDER BY ... LIMIT va ADENTRO y el umbral AFUERA: si el filtro por similitud estuviera en el
-- WHERE de la consulta de abajo, Postgres no podría usar el índice HNSW y recorrería la tabla.
--
-- [por verificar] con muchos tenants, el HNSW busca primero los vecinos más cercanos de TODA la
-- tabla y la RLS filtra después: un tenant chico podría recibir menos resultados de los pedidos.
-- No pasa con un tenant de prueba; medirlo con volumen antes de vender (pgvector >= 0.8 tiene
-- hnsw.iterative_scan para esto).
create or replace function public.match_kb_chunks(
  query_embedding extensions.vector(1024),
  match_count int default 6,
  min_similitud float default 0.3,
  p_fuente text default null
)
returns table (id bigint, contenido text, fuente text, metadata jsonb, similitud float)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.id, c.contenido, c.fuente, c.metadata, c.similitud
  from (
    select k.id, k.contenido, k.fuente, k.metadata,
           1 - (k.embedding <=> query_embedding) as similitud
    from public.kb_chunks k
    where k.embedding is not null
      and (p_fuente is null or k.fuente = p_fuente)
    order by k.embedding <=> query_embedding
    limit match_count
  ) c
  where c.similitud >= min_similitud
  order by c.similitud desc;
$$;

comment on function public.match_kb_chunks(extensions.vector, int, float, text) is
  'Búsqueda semántica en kb_chunks. security invoker: la RLS aísla por tenant, no hay parámetro de tenant a propósito.';

-- Quien no está logueado no tiene tenant, así que no tiene nada que buscar.
revoke all on function public.match_kb_chunks(extensions.vector, int, float, text) from public, anon;
grant execute on function public.match_kb_chunks(extensions.vector, int, float, text) to authenticated, service_role;
