-- Primera migracion del CRM de ventas. Crea el esquema base multi-tenant.
--
-- NO correr este archivo suelto: es parte de una secuencia de migraciones y
-- hay 7 mas encima. Para levantar el esquema en un proyecto nuevo se aplican
-- todas en orden (npx supabase db push). Ver supabase/README.md.
--
-- Va en un proyecto Supabase dedicado al CRM: no el de hellominus.com ni el
-- de KAIROS.

-- ============================================================
-- Extensiones
-- ============================================================
create extension if not exists vector;

-- ============================================================
-- Domains compartidos (vocabularios reutilizados en 2+ tablas)
-- ============================================================

-- Canales conversacionales reales (no incluye meta_ads/manual: no son
-- canales donde ocurra una conversación de ida y vuelta).
do $$ begin
  create domain canal_type as text check (value in ('chat_web', 'whatsapp', 'instagram', 'messenger', 'linkedin'));
exception when duplicate_object then null; end $$;

-- Origen/fuente de un contacto o deal: superset de canal_type, incluye
-- meta_ads (formulario, no canal de mensajería) y manual (alta a mano).
do $$ begin
  create domain fuente_type as text check (value in ('chat_web', 'whatsapp', 'instagram', 'messenger', 'linkedin', 'meta_ads', 'manual'));
exception when duplicate_object then null; end $$;

do $$ begin
  create domain sentimiento_type as text check (value in ('positivo', 'neutro', 'negativo'));
exception when duplicate_object then null; end $$;

-- ============================================================
-- Multi-tenant
-- ============================================================
-- Un solo CRM, un solo código, una sola base de datos — los datos de cada
-- empresa cliente (cada "tenant") quedan aislados entre sí por RLS, no por
-- un filtro que el código deba acordarse de agregar. Hellominus es el
-- primer tenant (usa el CRM para su propio pipeline de ventas); el mismo
-- esquema es el que se vende como CRM a otras empresas más adelante — no
-- son tenants de ejemplo, son clientes reales del producto.

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Primer tenant real. Al sumar una empresa nueva que compra el CRM, se
-- inserta su fila acá (y se le siembra su propio pipeline — ver el insert
-- junto a pipeline_stages más abajo, no necesariamente con las mismas 7
-- etapas que usa Hellominus).
insert into tenants (nombre, slug) values ('Hellominus', 'hellominus')
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- Administración de plataforma (equipo de Hellominus operando el SaaS)
-- ------------------------------------------------------------
-- Rol que cruza tenants, separado del rol de usuario cliente. Es lo que
-- permite que el equipo de Hellominus dé soporte sobre el CRM de un
-- tenant-cliente sin ser miembro de su equipo, y que existan reportes
-- agregados del SaaS. Hasta ahora eso solo lo podía hacer la service_role,
-- que salta RLS por completo y no distingue quién la usó.
--
-- Es tabla y no un claim en app_metadata (que es lo que proponía
-- docs/tener-en-cuenta-base-de-datos.md, punto 42) por una razón: revocar
-- el rol más privilegiado del sistema tiene que ser inmediato. Un claim en
-- el JWT sigue vigente hasta que ese token expira; una fila se borra y el
-- acceso se corta en la siguiente consulta.
create table if not exists platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nota text,
  created_at timestamptz not null default now()
);

-- security definer: la usan las policies de todas las tablas, así que tiene
-- que poder leer platform_admins sin quedar atrapada en el RLS de esa misma
-- tabla.
create or replace function is_platform_admin(uid uuid default auth.uid())
returns boolean as $$
  select exists (select 1 from platform_admins where user_id = uid);
$$ language sql stable security definer;

-- ------------------------------------------------------------
-- Sesiones de soporte (la auditoría del acceso cruzado)
-- ------------------------------------------------------------
-- Postgres no dispara triggers en SELECT, así que es imposible registrar
-- fila por fila qué leyó un admin de plataforma dentro de un tenant ajeno.
-- En vez de fingir esa auditoría, se invierte el problema: para pararse
-- sobre otro tenant hay que ABRIR UNA SESIÓN declarando el motivo, y esa
-- sesión vence sola. El rastro deja de ser un efecto secundario que se
-- pueda olvidar de escribir — es la condición para que el acceso exista.
--
-- Consecuencia buscada: un admin de plataforma que no abrió sesión es, a
-- todos los efectos, un usuario común de su propio tenant.
create table if not exists support_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users (id),
  tenant_id uuid not null references tenants (id),
  -- Obligatorio y con largo mínimo: "soporte" o "test" no son un motivo.
  -- Es lo que se le muestra al tenant si pregunta por qué entramos.
  motivo text not null check (length(trim(motivo)) >= 10),
  inicio_at timestamptz not null default now(),
  expira_at timestamptz not null default now() + interval '60 minutes',
  cerrada_at timestamptz,
  check (expira_at > inicio_at)
);

create index if not exists idx_support_sessions_activa
  on support_sessions (admin_user_id, tenant_id, expira_at)
  where cerrada_at is null;

create index if not exists idx_support_sessions_tenant_id on support_sessions (tenant_id);

-- Una sesión de soporte es un registro de auditoría: una vez abierta, lo
-- único que puede cambiar es su cierre. Ni el motivo ni las fechas se
-- reescriben después de los hechos.
create or replace function support_session_solo_cerrar()
returns trigger as $$
begin
  if new.id is distinct from old.id
     or new.admin_user_id is distinct from old.admin_user_id
     or new.tenant_id is distinct from old.tenant_id
     or new.motivo is distinct from old.motivo
     or new.inicio_at is distinct from old.inicio_at
     or new.expira_at is distinct from old.expira_at then
    raise exception 'De una sesión de soporte solo se puede cerrar (cerrada_at); el resto es inmutable.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_support_session_inmutable on support_sessions;
create trigger trg_support_session_inmutable
  before update on support_sessions
  for each row execute function support_session_solo_cerrar();

-- El tenant del usuario autenticado viaja en app_metadata del JWT (nunca en
-- user_metadata: ese sí lo puede editar el propio usuario desde el cliente,
-- lo que le permitiría cambiarse de tenant a voluntad). Se asigna una sola
-- vez al crear el usuario vía supabase.auth.admin.createUser({ ...,
-- app_metadata: { tenant_id } }) — paso manual, ver supabase/README.md.
--
-- Excepción de soporte: un admin de plataforma se para sobre otro tenant
-- mandando el header X-Acting-Tenant, y solo si tiene una sesión de soporte
-- abierta y vigente para ese tenant. El header es trivial de falsificar y no
-- importa: sin la fila en support_sessions no habilita nada, y esa fila solo
-- la puede crear alguien que ya es admin de plataforma.
--
-- security definer: tiene que poder leer support_sessions sin quedar sujeta
-- al RLS de esa tabla, igual que is_admin() con team_members.
create or replace function current_tenant_id()
returns uuid as $$
  select coalesce(
    (
      select ss.tenant_id
      from support_sessions ss
      where ss.admin_user_id = auth.uid()
        and ss.cerrada_at is null
        and ss.expira_at > now()
        and ss.tenant_id = nullif(current_setting('request.headers', true)::json ->> 'x-acting-tenant', '')::uuid
        and is_platform_admin()
      limit 1
    ),
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  );
$$ language sql stable security definer;

-- La sesión de soporte vigente, si la hay. La usan los triggers de auditoría
-- para marcar qué escrituras se hicieron durante un soporte y bajo qué
-- sesión — el "quién y por qué" de cada cambio hecho sobre un tenant ajeno.
create or replace function active_support_session_id()
returns uuid as $$
  select ss.id
  from support_sessions ss
  where ss.admin_user_id = auth.uid()
    and ss.cerrada_at is null
    and ss.expira_at > now()
    and ss.tenant_id = nullif(current_setting('request.headers', true)::json ->> 'x-acting-tenant', '')::uuid
    and is_platform_admin()
  limit 1;
$$ language sql stable security definer;

-- ============================================================
-- Helpers
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- team_members se crea antes que is_admin() porque la función depende de
-- ella. Cada persona pertenece a un solo tenant, a propósito: dar soporte
-- sobre el CRM de otro tenant NO se resuelve agregándole membresías al
-- vendedor, sino con el rol de plataforma de arriba (platform_admins). Así
-- "trabajo acá" y "opero el SaaS" quedan como dos permisos distintos, y se
-- puede revocar uno sin tocar el otro.
create table if not exists team_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null references tenants (id),
  rol text not null default 'agent' check (rol in ('owner', 'admin', 'agent')),
  created_at timestamptz not null default now()
);

create index if not exists idx_team_members_tenant_id on team_members (tenant_id);

-- "Puede administrar el tenant sobre el que estoy parado ahora mismo": por
-- ser admin/owner de su propio equipo, o por ser admin de plataforma dando
-- soporte. Se resuelve acá y no en cada policy para que las políticas de
-- todas las tablas queden iguales que en single-tenant.
create or replace function is_admin(uid uuid)
returns boolean as $$
  select is_platform_admin(uid) or exists (
    select 1 from team_members
    where user_id = uid
      and rol in ('owner', 'admin')
      and tenant_id = current_tenant_id()
  );
$$ language sql stable security definer;

-- ============================================================
-- Tablas de negocio
-- ============================================================

-- Verticales de cliente, configurables por tenant. Antes era un check
-- hardcodeado con los sectores de Hellominus (construccion/derecho/ventas/
-- cobranza/otro) — eso no sirve para un tenant que venda a otro rubro, y
-- cambiar un check obliga a tocar el esquema. Como tabla, cada tenant define
-- los suyos sin migración.
create table if not exists sectors (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  nombre text not null,
  slug text not null,
  orden smallint,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug),
  -- Redundante con la PK, pero es lo que habilita las FK compuestas
  -- (tenant_id, sector_id) que impiden referenciar un sector de otro tenant.
  unique (tenant_id, id)
);

-- Sectores iniciales del tenant Hellominus (los mismos valores que antes
-- vivían en el check de contacts.sector, para no perder el mapeo con
-- leads.sector de hellominus.com). Otro tenant siembra los suyos.
insert into sectors (tenant_id, nombre, slug, orden)
select t.id, s.nombre, s.slug, s.orden
from tenants t
cross join (values
  ('Construcción', 'construccion', 1),
  ('Derecho', 'derecho', 2),
  ('Ventas', 'ventas', 3),
  ('Cobranza', 'cobranza', 4),
  ('Otro', 'otro', 5)
) as s(nombre, slug, orden)
where t.slug = 'hellominus'
on conflict (tenant_id, slug) do nothing;

create table if not exists contacts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  nombre text not null,
  empresa text,
  sector_id bigint,
  email text,
  telefono text,
  origen fuente_type not null default 'manual',
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK compuesta: el sector tiene que ser del mismo tenant que el contacto.
  -- Con sector_id nulo la FK no se evalúa (MATCH SIMPLE), que es lo buscado:
  -- el sector es opcional.
  foreign key (tenant_id, sector_id) references sectors (tenant_id, id),
  unique (tenant_id, id)
);

create table if not exists contact_channels (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  contact_id bigint not null,
  tipo text not null check (tipo in ('whatsapp', 'instagram', 'messenger', 'linkedin', 'email')),
  valor text not null,
  created_at timestamptz not null default now(),
  -- único por tenant, no global: dos empresas-cliente distintas pueden tener
  -- cada una un contacto con el mismo número de WhatsApp sin chocar entre sí.
  unique (tenant_id, tipo, valor),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade
);

create table if not exists conversations (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  contact_id bigint not null,
  canal canal_type not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  ultimo_mensaje_at timestamptz,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references conversations (id) on delete cascade,
  direccion text not null check (direccion in ('in', 'out')),
  canal canal_type not null,
  contenido text not null,
  payload_raw jsonb,
  lead_score smallint check (lead_score between 0 and 100),
  sentimiento sentimiento_type,
  created_at timestamptz not null default now()
);

-- Estado "actual" de la IA para una conversación (1:1) — score, sentimiento,
-- resumen y sugerencia vigentes. Distinto de messages.lead_score/sentimiento,
-- que es el historial por mensaje individual (útil a futuro para un gráfico
-- de sentimiento en el tiempo); esta tabla es el snapshot que consume la UI.
create table if not exists conversation_insights (
  conversation_id bigint primary key references conversations (id) on delete cascade,
  score smallint check (score between 0 and 100),
  -- Nivel de interés (1-4) derivado del score, no una fuente de verdad
  -- aparte: evita que ambos valores queden desincronizados. Los cortes
  -- (25/50/75) extienden los mismos umbrales ya usados en la UI del canvas
  -- de diseño (ScoreBadge/CandyAero/CandyInbox: >=75 y >=50).
  nivel_interes smallint generated always as (
    case
      when score is null then null
      when score >= 75 then 4
      when score >= 50 then 3
      when score >= 25 then 2
      else 1
    end
  ) stored,
  sentimiento sentimiento_type,
  resumen text,
  sugerencia text,
  presupuesto_extraido text,
  proxima_accion_sugerida text,
  -- Snapshot de las citas RAG mostradas al agente: [{kb_chunk_id, fuente,
  -- texto, similitud}, ...]. kb_chunk_id es informativo (no FK real, no se
  -- puede referenciar un elemento de un array jsonb) — se congela el texto
  -- citado aunque el chunk original cambie después. Se llama citas_rag y no
  -- "citas" para no chocar con el sentido de "cita" = reunión (ver meetings).
  citas_rag jsonb not null default '[]'
    check (jsonb_typeof(citas_rag) = 'array' and jsonb_array_length(citas_rag) <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Conveniencia para el dashboard: contacto -> su conversación más reciente
-- -> insights actuales. security_invoker es obligatorio: sin eso la vista
-- corre RLS como su dueño (quien la creó) y no como quien consulta, lo que
-- reabriría una fuga de datos entre agentes en un esquema RLS-estricto.
create or replace view contact_latest_insight with (security_invoker = true) as
select distinct on (co.contact_id)
  co.contact_id, ci.*
from conversations co
join conversation_insights ci on ci.conversation_id = co.id
order by co.contact_id, co.ultimo_mensaje_at desc nulls last, co.created_at desc;

create table if not exists pipeline_stages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  nombre text not null,
  orden smallint not null,
  color text not null default '#22d3ee',
  unique (tenant_id, nombre),
  unique (tenant_id, id)
);

-- Etapas iniciales del tenant Hellominus. Cada tenant nuevo que compre el
-- CRM siembra las suyas — no necesariamente estas mismas 7.
insert into pipeline_stages (tenant_id, nombre, orden, color)
select t.id, s.nombre, s.orden, s.color
from tenants t
cross join (values
  ('Nuevo', 1, '#22d3ee'),
  ('Contactado', 2, '#22d3ee'),
  ('Calificado', 3, '#a78bfa'),
  ('Propuesta', 4, '#a78bfa'),
  ('Negociación', 5, '#a78bfa'),
  ('Ganado', 6, '#34d399'),
  ('Perdido', 7, '#64748b')
) as s(nombre, orden, color)
where t.slug = 'hellominus'
on conflict (tenant_id, nombre) do nothing;

create table if not exists deals (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  contact_id bigint not null,
  stage_id bigint not null,
  valor_estimado numeric(12, 2),
  probabilidad smallint check (probabilidad between 0 and 100),
  fuente fuente_type not null default 'manual',
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  -- Impide que un deal de un tenant caiga en una etapa del Kanban de otro.
  foreign key (tenant_id, stage_id) references pipeline_stages (tenant_id, id),
  unique (tenant_id, id)
);

create table if not exists quotes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  deal_id bigint not null,
  items jsonb not null default '[]',
  total numeric(12, 2) not null default 0,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'aceptada', 'rechazada')),
  pdf_url text,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  unique (tenant_id, id)
);

create table if not exists payments (
  id bigint generated always as identity primary key,
  quote_id bigint not null references quotes (id) on delete cascade,
  stripe_payment_intent_id text unique,
  monto numeric(12, 2) not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'exitoso', 'fallido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists activities (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  deal_id bigint not null,
  tipo text not null check (tipo in ('llamada', 'nota', 'recordatorio')),
  contenido text not null,
  vence_at timestamptz,
  completada boolean not null default false,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade
);

-- Reuniones agendadas con un contacto (franja de "Agenda del día" del
-- dashboard). Distinta de activities: acá el dato central es un horario con
-- duración, no un recordatorio con un solo vencimiento. Ancla en contact_id
-- (no deal_id) porque una reunión puede agendarse sin deal todavía; deal_id
-- es opcional para reportes futuros por etapa de pipeline. El destacado
-- "en curso" de la UI no se guarda: se calcula en la query/render a partir
-- de inicio_at + duracion_minutos contra now().
create table if not exists meetings (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  contact_id bigint not null,
  deal_id bigint,
  contenido text,
  inicio_at timestamptz not null,
  duracion_minutos smallint not null default 30 check (duracion_minutos > 0),
  estado text not null default 'programada' check (estado in ('programada', 'completada', 'cancelada')),
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  -- set null solo sobre deal_id: sin la lista de columnas, Postgres querría
  -- anular también tenant_id (not null) y el delete del deal fallaría.
  -- Requiere Postgres 15+, que es lo que provisiona Supabase hoy.
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete set null (deal_id)
);

-- Cubre dos casos con la misma tabla:
--   1. Cambios de etapa de un deal (campo/valor_anterior/valor_nuevo), que
--      es lo que el Kanban necesita mostrar como historia del negocio.
--   2. Cualquier escritura hecha por un admin de plataforma durante una
--      sesión de soporte (operacion + fila_anterior/fila_nueva completas).
-- Por eso campo es nullable: en el caso 2 no hay un único campo, hay una
-- fila entera.
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  tabla text not null,
  -- Nullable a propósito: no toda tabla auditable tiene PK bigint llamada
  -- "id" (team_members se identifica por user_id uuid). Cuando queda nulo,
  -- la clave se recupera de fila_anterior/fila_nueva, que traen la fila
  -- entera. Para el caso 1 (cambio de etapa) siempre viene con valor.
  registro_id bigint,
  operacion text check (operacion in ('insert', 'update', 'delete')),
  campo text,
  valor_anterior text,
  valor_nuevo text,
  fila_anterior jsonb,
  fila_nueva jsonb,
  actor uuid references auth.users (id),
  -- No nulo => la escritura se hizo desde afuera del tenant, durante un
  -- soporte. Es el join que responde "qué tocó Hellominus en mi CRM y por qué".
  support_session_id uuid references support_sessions (id),
  created_at timestamptz not null default now()
);

-- RAG: catálogo/FAQ del tenant para el panel copiloto. Cada empresa-cliente
-- tiene su propia base de conocimiento — no se comparte entre tenants.
create table if not exists kb_chunks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  contenido text not null,
  embedding vector(1536),
  fuente text not null check (fuente in ('catalogo', 'faq', 'documento')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_kb_chunks_embedding on kb_chunks using hnsw (embedding vector_cosine_ops);

-- Cola de reproceso manual para eventos de n8n que agotaron reintentos.
-- tenant_id nullable: un webhook puede llegar malformado, sin forma de
-- resolver a qué tenant pertenece, antes de haber sido normalizado.
create table if not exists n8n_dead_letters (
  id bigint generated always as identity primary key,
  tenant_id uuid references tenants (id),
  flujo text not null,
  payload jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  resuelto boolean not null default false
);

-- ============================================================
-- Índices
-- ============================================================
-- Postgres no indexa automático el lado que referencia una FK. Cubre las
-- columnas por las que efectivamente se filtra hoy (owner_id de cada tabla
-- con RLS directo, y las FK que resuelven las políticas "vía padre").
-- quotes(deal_id) y payments(quote_id) tienen el mismo gap pero quedan
-- fuera de esta pasada: esas tablas no se tocan en este cambio.

create index if not exists idx_contacts_owner_id on contacts (owner_id);
create index if not exists idx_contact_channels_contact_id on contact_channels (contact_id);
create index if not exists idx_conversations_contact_id on conversations (contact_id);
create index if not exists idx_conversations_owner_id on conversations (owner_id);
create index if not exists idx_messages_conversation_id_created_at on messages (conversation_id, created_at);
create index if not exists idx_deals_contact_id on deals (contact_id);
create index if not exists idx_deals_stage_id on deals (stage_id);
create index if not exists idx_deals_owner_id on deals (owner_id);
create index if not exists idx_activities_deal_id on activities (deal_id);
create index if not exists idx_meetings_contact_id on meetings (contact_id);
create index if not exists idx_meetings_owner_inicio on meetings (owner_id, inicio_at);

-- Índices de tenant_id: toda tabla multi-tenant se filtra por tenant en
-- cada policy de RLS, así que esta columna se consulta en cada request.
create index if not exists idx_contacts_tenant_id on contacts (tenant_id);
create index if not exists idx_contacts_sector_id on contacts (sector_id);
create index if not exists idx_sectors_tenant_id on sectors (tenant_id);
create index if not exists idx_contact_channels_tenant_id on contact_channels (tenant_id);
create index if not exists idx_conversations_tenant_id on conversations (tenant_id);
create index if not exists idx_pipeline_stages_tenant_id on pipeline_stages (tenant_id);
create index if not exists idx_deals_tenant_id on deals (tenant_id);
create index if not exists idx_quotes_tenant_id on quotes (tenant_id);
create index if not exists idx_activities_tenant_id on activities (tenant_id);
create index if not exists idx_meetings_tenant_id on meetings (tenant_id);
create index if not exists idx_kb_chunks_tenant_id on kb_chunks (tenant_id);
create index if not exists idx_audit_log_tenant_id on audit_log (tenant_id);
-- "Qué se tocó en mi CRM durante los soportes": el índice parcial cubre solo
-- las filas de soporte, que son una fracción mínima de audit_log.
create index if not exists idx_audit_log_support_session
  on audit_log (support_session_id)
  where support_session_id is not null;

-- ============================================================
-- Triggers: updated_at
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'conversations', 'deals', 'quotes', 'payments', 'conversation_insights', 'meetings']
  loop
    execute format(
      'drop trigger if exists trg_set_updated_at on %I; create trigger trg_set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end;
$$;

-- ============================================================
-- Trigger: auditoría de cambio de stage en deals
-- ============================================================

create or replace function audit_deal_stage_change()
returns trigger as $$
begin
  if new.stage_id is distinct from old.stage_id then
    insert into audit_log (tenant_id, tabla, registro_id, operacion, campo, valor_anterior, valor_nuevo, actor, support_session_id)
    values (new.tenant_id, 'deals', new.id, 'update', 'stage_id', old.stage_id::text, new.stage_id::text, auth.uid(), active_support_session_id());
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_audit_deal_stage on deals;
create trigger trg_audit_deal_stage
  after update on deals
  for each row execute function audit_deal_stage_change();

-- ============================================================
-- Trigger: auditoría de escrituras durante una sesión de soporte
-- ============================================================
-- Solo escribe cuando hay sesión de soporte activa: la actividad normal de
-- un tenant sobre sus propios datos no se audita acá (eso sería otra cosa,
-- con otro volumen y otro propósito). Acá interesa exclusivamente lo que
-- toca alguien de afuera del tenant.
create or replace function audit_support_write()
returns trigger as $$
declare
  sesion uuid;
  fila jsonb;
  t uuid;
begin
  sesion := active_support_session_id();
  if sesion is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    fila := to_jsonb(old);
  else
    fila := to_jsonb(new);
  end if;
  -- messages, conversation_insights y payments no llevan tenant_id propio
  -- (lo heredan del padre): para esas se usa el tenant de la sesión, que es
  -- justamente sobre el que se está dando soporte.
  t := coalesce(
    (fila ->> 'tenant_id')::uuid,
    (select ss.tenant_id from support_sessions ss where ss.id = sesion)
  );

  insert into audit_log (
    tenant_id, tabla, registro_id, operacion,
    fila_anterior, fila_nueva, actor, support_session_id
  )
  values (
    t,
    tg_table_name,
    -- Queda nulo en tablas sin PK bigint (team_members): la fila completa
    -- va igual en fila_anterior/fila_nueva, así que no se pierde nada.
    coalesce((fila ->> 'id')::bigint, (fila ->> 'conversation_id')::bigint),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid(),
    sesion
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$ language plpgsql security definer;

do $$
declare
  t text;
begin
  foreach t in array array[
    'contacts', 'contact_channels', 'conversations', 'messages',
    'conversation_insights', 'sectors', 'pipeline_stages', 'deals',
    'quotes', 'payments', 'activities', 'meetings', 'kb_chunks', 'team_members'
  ]
  loop
    execute format(
      'drop trigger if exists trg_audit_support on %I; create trigger trg_audit_support after insert or update or delete on %I for each row execute function audit_support_write();',
      t, t
    );
  end loop;
end;
$$;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table tenants enable row level security;
alter table platform_admins enable row level security;
alter table support_sessions enable row level security;
alter table team_members enable row level security;
alter table sectors enable row level security;
alter table contacts enable row level security;
alter table contact_channels enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table conversation_insights enable row level security;
alter table pipeline_stages enable row level security;
alter table deals enable row level security;
alter table quotes enable row level security;
alter table payments enable row level security;
alter table activities enable row level security;
alter table meetings enable row level security;
alter table audit_log enable row level security;
alter table kb_chunks enable row level security;
alter table n8n_dead_letters enable row level security;

-- Las policies no admiten "create ... if not exists", así que se limpian las
-- de public antes de recrearlas. Es lo que permite re-correr este archivo
-- entero después de editarlo, que es como se trabaja el esquema mientras no
-- exista un proyecto Supabase real con datos (ver supabase/README.md).
do $$
declare
  r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

-- tenants: cada usuario ve solo la fila de su propio tenant (para que el
-- frontend muestre el nombre de la empresa, por ejemplo). El admin de
-- plataforma las ve todas — necesita la lista para elegir sobre cuál pararse
-- al dar soporte.
create policy "tenants: el propio, o todos si es plataforma" on tenants
  for select using (id = current_tenant_id() or is_platform_admin());

-- platform_admins: solo los propios admins de plataforma saben quiénes son.
-- El alta y la baja van por service_role (ver supabase/README.md): un admin
-- de plataforma no puede sumar a otro ni removerse solo.
create policy "platform_admins: solo lectura interna" on platform_admins
  for select using (is_platform_admin());

-- support_sessions: el admin de plataforma abre y cierra las suyas, y las ve
-- todas. Y —esto es lo importante— el admin del tenant ve las sesiones
-- abiertas SOBRE SU tenant: quién entró, cuándo y con qué motivo declarado.
-- Un registro de acceso que el auditado no puede leer no es transparencia.
--
-- Ojo con el uso de tenant_id acá: se compara contra el tenant del JWT, no
-- contra current_tenant_id(), justamente para que el admin de plataforma no
-- se vea a sí mismo como "el tenant" mientras está actuando de soporte.
create policy "support_sessions: plataforma, o el tenant auditado" on support_sessions
  for select using (
    is_platform_admin()
    or (
      tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
      and exists (
        select 1 from team_members tm
        where tm.user_id = auth.uid()
          and tm.rol in ('owner', 'admin')
          and tm.tenant_id = support_sessions.tenant_id
      )
    )
  );

-- Solo puede abrir sesiones a su propio nombre: nadie declara un soporte en
-- nombre de otra persona.
create policy "support_sessions: apertura propia" on support_sessions
  for insert with check (is_platform_admin() and admin_user_id = auth.uid());

-- Cerrar la propia. No hay policy de delete a propósito: la sesión es el
-- rastro, y el rastro no se borra desde la aplicación.
create policy "support_sessions: cierre propio" on support_sessions
  for update using (is_platform_admin() and admin_user_id = auth.uid())
  with check (is_platform_admin() and admin_user_id = auth.uid());

-- pipeline_stages, sectors y kb_chunks: catálogo por tenant, lectura para
-- cualquier usuario autenticado de ese tenant (no hay owner_id que aislar
-- dentro del tenant, pero sí hay que aislar entre tenants distintos).
create policy "pipeline_stages: lectura del propio tenant" on pipeline_stages
  for select using (tenant_id = current_tenant_id());

create policy "sectors: lectura del propio tenant" on sectors
  for select using (tenant_id = current_tenant_id());

-- Configurar los verticales es cosa de admin: un agente no debería poder
-- inventar sectores al vuelo y ensuciar los reportes.
create policy "sectors: escritura de admin" on sectors
  for all using (tenant_id = current_tenant_id() and is_admin(auth.uid()))
  with check (tenant_id = current_tenant_id() and is_admin(auth.uid()));

create policy "kb_chunks: lectura del propio tenant" on kb_chunks
  for select using (tenant_id = current_tenant_id());

-- team_members: cada quien ve su propia fila; solo admin/owner ven las de
-- su mismo tenant (is_admin ya viene scoped por tenant, ver más arriba).
create policy "team_members: propia fila o admin del tenant" on team_members
  for select using (user_id = auth.uid() or (tenant_id = current_tenant_id() and is_admin(auth.uid())));

-- Patrón repetido para las tablas con owner_id directo: mismo tenant, y
-- dentro de él, dueño o admin.
create policy "contacts: tenant + dueño o admin" on contacts
  for all using (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())))
  with check (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())));

create policy "conversations: tenant + dueño o admin" on conversations
  for all using (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())))
  with check (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())));

create policy "deals: tenant + dueño o admin" on deals
  for all using (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())))
  with check (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())));

create policy "quotes: tenant + dueño o admin" on quotes
  for all using (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())))
  with check (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())));

create policy "activities: tenant + dueño o admin" on activities
  for all using (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())))
  with check (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())));

create policy "meetings: tenant + dueño o admin" on meetings
  for all using (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())))
  with check (tenant_id = current_tenant_id() and (owner_id = auth.uid() or is_admin(auth.uid())));

-- Tablas sin owner_id propio: se resuelven a través de la tabla padre, que
-- ya trae su tenant_id — se valida ahí en vez de duplicar la columna.
create policy "contact_channels: vía contacto" on contact_channels
  for all using (
    tenant_id = current_tenant_id()
    and exists (select 1 from contacts c where c.id = contact_id and (c.owner_id = auth.uid() or is_admin(auth.uid())))
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from contacts c where c.id = contact_id and (c.owner_id = auth.uid() or is_admin(auth.uid())))
  );

create policy "messages: vía conversación" on messages
  for all using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and c.tenant_id = current_tenant_id()
        and (c.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and c.tenant_id = current_tenant_id()
        and (c.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  );

create policy "conversation_insights: vía conversación" on conversation_insights
  for all using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and c.tenant_id = current_tenant_id()
        and (c.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and c.tenant_id = current_tenant_id()
        and (c.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  );

create policy "payments: vía cotización" on payments
  for all using (
    exists (
      select 1 from quotes q
      where q.id = quote_id
        and q.tenant_id = current_tenant_id()
        and (q.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from quotes q
      where q.id = quote_id
        and q.tenant_id = current_tenant_id()
        and (q.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  );

-- audit_log: solo admin del propio tenant (visibilidad operativa, no de
-- agente individual).
create policy "audit_log: solo admin del tenant" on audit_log
  for select using (tenant_id = current_tenant_id() and is_admin(auth.uid()));

-- n8n_dead_letters: solo admin del tenant al que sí se logró resolver el
-- dead letter. Los huérfanos (tenant_id nulo: webhook que no se pudo
-- normalizar, así que no se sabe de quién es) los ve el admin de plataforma
-- — es quien opera la integración, y si no los viera nadie quedarían
-- invisibles hasta que alguien se acordara de mirarlos con service_role.
create policy "n8n_dead_letters: admin del tenant o de plataforma" on n8n_dead_letters
  for all using (
    (tenant_id = current_tenant_id() and is_admin(auth.uid()))
    or (tenant_id is null and is_platform_admin())
  )
  with check (
    (tenant_id = current_tenant_id() and is_admin(auth.uid()))
    or (tenant_id is null and is_platform_admin())
  );

-- ============================================================
-- Realtime
-- ============================================================

-- duplicate_object: la tabla ya estaba en la publicación de una corrida
-- anterior del script. No es error, es que ya estaba hecho.
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'deals', 'conversation_insights']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end;
$$;
