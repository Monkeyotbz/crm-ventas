-- Genera la foto del esquema que vive en supabase/schema-referencia.md
--
-- Por que existe: schema-referencia.md se desactualiza en cuanto se aplica
-- una migracion nueva. Este script la vuelve a generar en vez de obligar a
-- mantenerla a mano (que es como se desincronizan las cosas).
--
-- Como correrlo:
--   Opcion A - SQL Editor de Supabase: pegar y ejecutar, copiar la salida.
--   Opcion B - psql:
--     psql "$DATABASE_URL" -At -f scripts/generar-schema-referencia.sql
--
-- La salida NO reemplaza el archivo automaticamente: hay prosa escrita a mano
-- ahi (el "como leer este esquema", los porques de cada decision) que este
-- script no puede reproducir. Se usa para actualizar las partes mecanicas.
--
-- NOTA: no es `supabase db dump`. Ese requiere la password de la base, que no
-- esta en el repo. Este script solo necesita permisos de lectura del catalogo.

-- ============================================================
-- 1. Tablas: columnas, constraints, indices y policies
-- ============================================================
select string_agg(linea, E'\n' order by orden, sub) as dump
from (
  select 1 as orden, c.relname as sub,
    '## ' || c.relname || E'\n\n| columna | tipo | nulo | default |\n|---|---|---|---|\n' ||
    (select string_agg('| `' || a.attname || '` | ' || format_type(a.atttypid, a.atttypmod) ||
        ' | ' || case when a.attnotnull then 'NO' else 'si' end ||
        ' | ' || coalesce('`' || replace(pg_get_expr(d.adbin, d.adrelid), '|', '\|') || '`', '-') || ' |', E'\n'
        order by a.attnum)
     from pg_attribute a
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) ||
    coalesce(E'\n\n**Constraints:**\n' ||
      (select string_agg('- `' || con.conname || '` - ' || replace(pg_get_constraintdef(con.oid), '|', '\|'), E'\n'
          order by con.contype, con.conname)
       from pg_constraint con where con.conrelid = c.oid), '') ||
    coalesce(E'\n\n**Indices:**\n' ||
      (select string_agg('- ' || replace(pg_get_indexdef(i.indexrelid), '|', '\|'), E'\n'
          order by i.indexrelid::regclass::text)
       from pg_index i where i.indrelid = c.oid and not i.indisprimary), '') ||
    coalesce(E'\n\n**Policies RLS:**\n' ||
      (select string_agg('- **' || p.polname || '** (' ||
          case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                        when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end || ')', E'\n'
          order by p.polname)
       from pg_policy p where p.polrelid = c.oid), E'\n\n**Policies RLS:** NINGUNA (revisar!)') ||
    E'\n' as linea
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
) t;

-- ============================================================
-- 2. Funciones, triggers, domains, realtime y vistas
-- ============================================================
select
  (select string_agg('- **`' || n.nspname || '.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')`** -> `' ||
      pg_get_function_result(p.oid) || '`' ||
      case when p.prosecdef then ' - SECURITY DEFINER' else '' end, E'\n' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('private')) as funciones,
  (select string_agg('- `' || t.tgname || '` en **' || c.relname || '** -> `' || pr.proname || '()`', E'\n'
      order by c.relname, t.tgname)
   from pg_trigger t join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace join pg_proc pr on pr.oid = t.tgfoid
   where not t.tgisinternal and n.nspname = 'public') as triggers,
  (select string_agg('- **`' || t.typname || '`** - ' || replace(pg_get_constraintdef(con.oid), '|', '\|'), E'\n'
      order by t.typname)
   from pg_type t join pg_namespace n on n.oid = t.typnamespace
   left join pg_constraint con on con.contypid = t.oid
   where n.nspname = 'public' and t.typtype = 'd') as domains,
  (select string_agg('- `' || c.relname || '`', E'\n' order by c.relname)
   from pg_publication_rel pr join pg_class c on c.oid = pr.prrelid
   join pg_publication p on p.oid = pr.prpubid where p.pubname = 'supabase_realtime') as realtime,
  (select string_agg('- `' || viewname || '`', E'\n') from pg_views where schemaname = 'public') as vistas;

-- ============================================================
-- 3. Chequeo de salud: tablas sin RLS (deberia devolver 0 filas)
-- ============================================================
select c.relname as tabla_sin_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
