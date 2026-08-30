-- Validador de aislamiento multi-tenant — candidato [2] de docs/DECISIONES.md.
--
-- Verifica las tres capas del Paso 2 de docs/guia-fases-1-2.md:
--   Capa 1  toda tabla de negocio tiene tenant_id
--   Capa 2  las FK entre tablas de negocio son compuestas (tenant_id, padre_id)
--   Capa 3  toda tabla tiene RLS habilitado y al menos una policy que filtre por tenant
--
-- SQL puro, sin meta-comandos de psql: corre igual en el SQL Editor del panel,
-- en `execute_sql` del MCP de Supabase, o por psql. Devuelve una fila por hallazgo.
-- Cero filas con severidad ERROR = el aislamiento está completo.
--
-- Las tablas exentas se declaran abajo con su motivo. Si aparece una tabla nueva que
-- legítimamente no lleva tenant_id, se agrega ahí — nunca se relaja el criterio general.

with exentas as (
  -- Tablas que a propósito NO llevan tenant_id, cada una por un motivo distinto.
  select * from (values
    ('tenants',           'es la tabla de tenants misma'),
    ('platform_admins',   'rol de plataforma, transversal a los tenants'),
    ('support_sessions',  'tiene tenant_id pero como objetivo del soporte, no como dueño'),
    ('whatsapp_pricing',  'tarifas de Meta: son globales, no de un tenant'),
    ('messages',          'hereda el tenant de conversations (documentado en el esquema)'),
    ('conversation_insights', 'hereda el tenant de conversations'),
    ('audit_log',         'transversal: registra escrituras de soporte cruzado'),
    ('n8n_dead_letters',  'tenant_id nullable: puede fallar antes de saber de quién es'),
    ('webhook_errors',    'tenant_id nullable: puede fallar antes de resolver el tenant')
  ) as t(tabla, motivo)
),

tablas as (
  select c.relname as tabla, c.oid, c.relrowsecurity as rls_activo
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),

-- CAPA 1 -------------------------------------------------------------------
capa1 as (
  select
    1 as capa,
    'ERROR' as severidad,
    t.tabla,
    'sin columna tenant_id y sin exención declarada' as hallazgo
  from tablas t
  where not exists (
      select 1 from pg_attribute a
      where a.attrelid = t.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
    )
    and t.tabla not in (select tabla from exentas)
),

-- CAPA 2 -------------------------------------------------------------------
-- Una FK simple hacia una tabla que sí tiene tenant_id deja escribir filas cruzadas:
-- RLS aísla la lectura, pero nada impide apuntar a un padre de otro tenant.
capa2 as (
  select
    2 as capa,
    'ERROR' as severidad,
    con.conrelid::regclass::text as tabla,
    'FK simple ' || con.conname || ' → ' || con.confrelid::regclass::text
      || ' (debería ser compuesta con tenant_id)' as hallazgo
  from pg_constraint con
  join pg_namespace n on n.oid = con.connamespace
  where n.nspname = 'public'
    and con.contype = 'f'
    -- el hijo tiene tenant_id...
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = con.conrelid and a.attname = 'tenant_id' and not a.attisdropped
    )
    -- ...el padre también...
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = con.confrelid and a.attname = 'tenant_id' and not a.attisdropped
    )
    -- ...pero la FK no incluye tenant_id entre sus columnas.
    and not exists (
      select 1 from pg_attribute a
      where a.attrelid = con.conrelid
        and a.attnum = any(con.conkey)
        and a.attname = 'tenant_id'
    )
),

-- CAPA 3 -------------------------------------------------------------------
capa3_sin_rls as (
  select 3 as capa, 'ERROR' as severidad, t.tabla,
         'RLS deshabilitado: cualquiera con la anon key lee la tabla entera' as hallazgo
  from tablas t
  where not t.rls_activo
),

capa3_sin_policy as (
  select 3 as capa, 'ERROR' as severidad, t.tabla,
         'RLS habilitado pero sin ninguna policy: la tabla queda cerrada a todos' as hallazgo
  from tablas t
  where t.rls_activo
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tabla)
),

capa3_sin_tenant as (
  select 3 as capa, 'REVISAR' as severidad, t.tabla,
         'ninguna policy menciona el tenant — verificar que el aislamiento venga de la tabla padre' as hallazgo
  from tablas t
  where t.rls_activo
    and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tabla)
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t.tabla
        and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%tenant%'
    )
    and t.tabla <> 'tenants'
)

select capa, severidad, tabla, hallazgo
from (
  select * from capa1
  union all select * from capa2
  union all select * from capa3_sin_rls
  union all select * from capa3_sin_policy
  union all select * from capa3_sin_tenant
) hallazgos
order by severidad, capa, tabla;
