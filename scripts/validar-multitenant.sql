-- Validador de aislamiento multi-tenant — candidato [2] de docs/DECISIONES.md.
--
-- Verifica las tres capas del Paso 2 de docs/guia-fases-1-2.md:
--   Capa 1  toda tabla de negocio tiene tenant_id, y no es nullable
--   Capa 2  las FK entre tablas de negocio son compuestas (tenant_id, padre_id)
--   Capa 3  toda tabla tiene RLS habilitado y policies que realmente filtran
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
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = con.conrelid and a.attname = 'tenant_id' and not a.attisdropped
    )
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = con.confrelid and a.attname = 'tenant_id' and not a.attisdropped
    )
    and not exists (
      select 1 from pg_attribute a
      where a.attrelid = con.conrelid
        and a.attnum = any(con.conkey)
        and a.attname = 'tenant_id'
    )
),

-- CAPA 2b — el punto ciego que encontró la auditoría (H5).
-- La capa 2 solo mira FK donde AMBOS lados tienen tenant_id, así que toda FK
-- hacia (o desde) una tabla que "hereda el tenant del padre" le es invisible.
-- Así se le escapó messages.template_id → message_templates: un cruce real que
-- el validador certificaba como limpio.
capa2b as (
  select
    2 as capa,
    'REVISAR' as severidad,
    con.conrelid::regclass::text as tabla,
    'FK ' || con.conname || ' → ' || con.confrelid::regclass::text
      || ' cruza la frontera de tenant sin poder expresarse como FK compuesta '
      || '(uno de los dos lados hereda el tenant). Confirmar que un trigger o '
      || 'la lógica de la aplicación lo valide.' as hallazgo
  from pg_constraint con
  join pg_namespace n on n.oid = con.connamespace
  join pg_class padre on padre.oid = con.confrelid
  join pg_namespace np on np.oid = padre.relnamespace
  where n.nspname = 'public'
    and con.contype = 'f'
    and con.conrelid <> con.confrelid
    -- exactamente uno de los dos lados tiene tenant_id
    and (
      exists (select 1 from pg_attribute a where a.attrelid = con.conrelid
                and a.attname = 'tenant_id' and not a.attisdropped)
      <>
      exists (select 1 from pg_attribute a where a.attrelid = con.confrelid
                and a.attname = 'tenant_id' and not a.attisdropped)
    )
    -- Excluye los casos estructuralmente correctos, que si no ahogan la señal:
    --   · apuntar a `tenants` es la definición misma de pertenecer a un tenant
    --   · `auth.users` es global de Supabase, no tiene ni puede tener tenant_id
    and np.nspname = 'public'
    and padre.relname <> 'tenants'
),

-- CAPA 1b — nulabilidad (el agujero que descubrió payments.tenant_id).
-- Con MATCH SIMPLE, una FK compuesta cuyo tenant_id sea null simplemente NO se
-- evalúa: la protección queda decorativa.
capa1b as (
  select
    1 as capa,
    'ERROR' as severidad,
    t.tabla,
    'tenant_id es nullable — con MATCH SIMPLE, toda FK compuesta que lo incluya '
      || 'deja de evaluarse cuando es null' as hallazgo
  from tablas t
  join pg_attribute a on a.attrelid = t.oid and a.attname = 'tenant_id' and not a.attisdropped
  where not a.attnotnull
    and t.tabla not in (select tabla from exentas)
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

-- CAPA 3b — evaluación POLICY POR POLICY (H6).
-- Antes esto concatenaba todas las policies de la tabla y buscaba 'tenant' en el
-- conjunto: una tabla con tres policies correctas y una cuarta `using (true)`
-- pasaba limpia. Que es literalmente el caso "RLS activo pero no filtra nada".
capa3_permisiva as (
  select 3 as capa, 'ERROR' as severidad, p.tablename as tabla,
         'policy "' || p.policyname || '" no filtra nada (USING/WITH CHECK = true): '
           || 'RLS figura activo pero deja pasar todo' as hallazgo
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename <> 'tenants'
    and (
      replace(replace(coalesce(p.qual, ''), '(', ''), ')', '') = 'true'
      or replace(replace(coalesce(p.with_check, ''), '(', ''), ')', '') = 'true'
    )
),

-- Y tampoco miraba a QUIÉN se le otorga. Ojo con la trampa acá: en Postgres una
-- policy sin cláusula TO queda en `public`, y eso NO significa "accesible sin
-- autenticar" — quien restringe es la expresión (`tenant_id = current_tenant_id()`),
-- que para un anónimo sin JWT da falso. `public` es el patrón normal de Supabase.
-- Lo que sí es un olor real es otorgar a `anon` EXPLÍCITAMENTE: eso solo se escribe
-- a propósito, y en una tabla de negocio casi nunca es lo que se quiso.
capa3_rol_anon as (
  select 3 as capa, 'ERROR' as severidad, p.tablename as tabla,
         'policy "' || p.policyname || '" otorgada explícitamente a anon — '
           || 'una tabla de negocio no debería ser accesible sin autenticar' as hallazgo
  from pg_policies p
  where p.schemaname = 'public'
    and p.roles && array['anon']::name[]
),

capa3_sin_tenant as (
  select 3 as capa, 'REVISAR' as severidad, p.tablename as tabla,
         'policy "' || p.policyname || '" no menciona el tenant ni is_platform_admin — '
           || 'verificar que el aislamiento venga de la tabla padre' as hallazgo
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename <> 'tenants'
    and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%tenant%'
    and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%platform_admin%'
)

select capa, severidad, tabla, hallazgo
from (
  select * from capa1
  union all select * from capa1b
  union all select * from capa2
  union all select * from capa2b
  union all select * from capa3_sin_rls
  union all select * from capa3_sin_policy
  union all select * from capa3_permisiva
  union all select * from capa3_rol_anon
  union all select * from capa3_sin_tenant
) hallazgos
order by severidad, capa, tabla;
