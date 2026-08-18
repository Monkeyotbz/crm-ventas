-- Ejecutar en el SQL Editor de un proyecto Supabase NUEVO y dedicado al CRM
-- de ventas (no el de hellominus.com ni el de KAIROS). Ver supabase/README.md
-- para el paso a paso.

-- ============================================================
-- Extensiones
-- ============================================================
create extension if not exists vector;

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

-- team_members se crea antes que is_admin() porque la función depende de ella.
create table if not exists team_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rol text not null default 'agent' check (rol in ('owner', 'admin', 'agent')),
  created_at timestamptz not null default now()
);

create or replace function is_admin(uid uuid)
returns boolean as $$
  select exists (
    select 1 from team_members
    where user_id = uid and rol in ('owner', 'admin')
  );
$$ language sql stable security definer;

-- ============================================================
-- Tablas de negocio
-- ============================================================

create table if not exists contacts (
  id bigint generated always as identity primary key,
  nombre text not null,
  empresa text,
  email text,
  telefono text,
  origen text not null default 'manual' check (origen in ('chat_web', 'whatsapp', 'instagram', 'meta_ads', 'manual')),
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contact_channels (
  id bigint generated always as identity primary key,
  contact_id bigint not null references contacts (id) on delete cascade,
  tipo text not null check (tipo in ('whatsapp', 'instagram', 'email')),
  valor text not null,
  created_at timestamptz not null default now(),
  unique (tipo, valor)
);

create table if not exists conversations (
  id bigint generated always as identity primary key,
  contact_id bigint not null references contacts (id) on delete cascade,
  canal text not null check (canal in ('chat_web', 'whatsapp', 'instagram')),
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  ultimo_mensaje_at timestamptz,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references conversations (id) on delete cascade,
  direccion text not null check (direccion in ('in', 'out')),
  canal text not null check (canal in ('chat_web', 'whatsapp', 'instagram')),
  contenido text not null,
  payload_raw jsonb,
  lead_score smallint,
  sentimiento text check (sentimiento in ('positivo', 'neutro', 'negativo')),
  created_at timestamptz not null default now()
);

create table if not exists pipeline_stages (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  orden smallint not null,
  color text not null default '#22d3ee'
);

insert into pipeline_stages (nombre, orden, color) values
  ('Nuevo', 1, '#22d3ee'),
  ('Contactado', 2, '#22d3ee'),
  ('Calificado', 3, '#a78bfa'),
  ('Propuesta', 4, '#a78bfa'),
  ('Negociación', 5, '#a78bfa'),
  ('Ganado', 6, '#34d399'),
  ('Perdido', 7, '#64748b')
on conflict (nombre) do nothing;

create table if not exists deals (
  id bigint generated always as identity primary key,
  contact_id bigint not null references contacts (id) on delete cascade,
  stage_id bigint not null references pipeline_stages (id),
  valor_estimado numeric(12, 2),
  probabilidad smallint check (probabilidad between 0 and 100),
  fuente text not null default 'manual' check (fuente in ('chat_web', 'whatsapp', 'instagram', 'meta_ads', 'manual')),
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quotes (
  id bigint generated always as identity primary key,
  deal_id bigint not null references deals (id) on delete cascade,
  items jsonb not null default '[]',
  total numeric(12, 2) not null default 0,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'aceptada', 'rechazada')),
  pdf_url text,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  deal_id bigint not null references deals (id) on delete cascade,
  tipo text not null check (tipo in ('llamada', 'nota', 'recordatorio')),
  contenido text not null,
  vence_at timestamptz,
  completada boolean not null default false,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id bigint not null,
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  actor uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- RAG: catálogo/FAQ de hellominus.com para el panel copiloto.
create table if not exists kb_chunks (
  id bigint generated always as identity primary key,
  contenido text not null,
  embedding vector(1536),
  fuente text not null check (fuente in ('catalogo', 'faq', 'documento')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_kb_chunks_embedding on kb_chunks using hnsw (embedding vector_cosine_ops);

-- Cola de reproceso manual para eventos de n8n que agotaron reintentos.
create table if not exists n8n_dead_letters (
  id bigint generated always as identity primary key,
  flujo text not null,
  payload jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  resuelto boolean not null default false
);

-- ============================================================
-- Triggers: updated_at
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'conversations', 'deals', 'quotes', 'payments']
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
    insert into audit_log (tabla, registro_id, campo, valor_anterior, valor_nuevo, actor)
    values ('deals', new.id, 'stage_id', old.stage_id::text, new.stage_id::text, auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_audit_deal_stage on deals;
create trigger trg_audit_deal_stage
  after update on deals
  for each row execute function audit_deal_stage_change();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table team_members enable row level security;
alter table contacts enable row level security;
alter table contact_channels enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table pipeline_stages enable row level security;
alter table deals enable row level security;
alter table quotes enable row level security;
alter table payments enable row level security;
alter table activities enable row level security;
alter table audit_log enable row level security;
alter table kb_chunks enable row level security;
alter table n8n_dead_letters enable row level security;

-- pipeline_stages y kb_chunks: catálogo compartido, lectura para cualquier
-- usuario autenticado (no hay owner_id que aislar).
create policy "pipeline_stages: lectura autenticada" on pipeline_stages
  for select using (auth.role() = 'authenticated');

create policy "kb_chunks: lectura autenticada" on kb_chunks
  for select using (auth.role() = 'authenticated');

-- team_members: cada quien ve su propia fila; solo admin/owner ven todas.
create policy "team_members: propia fila o admin" on team_members
  for select using (user_id = auth.uid() or is_admin(auth.uid()));

-- Patrón repetido para las tablas con owner_id directo: dueño o admin.
create policy "contacts: dueño o admin" on contacts
  for all using (owner_id = auth.uid() or is_admin(auth.uid()))
  with check (owner_id = auth.uid() or is_admin(auth.uid()));

create policy "conversations: dueño o admin" on conversations
  for all using (owner_id = auth.uid() or is_admin(auth.uid()))
  with check (owner_id = auth.uid() or is_admin(auth.uid()));

create policy "deals: dueño o admin" on deals
  for all using (owner_id = auth.uid() or is_admin(auth.uid()))
  with check (owner_id = auth.uid() or is_admin(auth.uid()));

create policy "quotes: dueño o admin" on quotes
  for all using (owner_id = auth.uid() or is_admin(auth.uid()))
  with check (owner_id = auth.uid() or is_admin(auth.uid()));

create policy "activities: dueño o admin" on activities
  for all using (owner_id = auth.uid() or is_admin(auth.uid()))
  with check (owner_id = auth.uid() or is_admin(auth.uid()));

-- Tablas sin owner_id propio: se resuelven a través de la tabla padre.
create policy "contact_channels: vía contacto" on contact_channels
  for all using (
    exists (select 1 from contacts c where c.id = contact_id and (c.owner_id = auth.uid() or is_admin(auth.uid())))
  )
  with check (
    exists (select 1 from contacts c where c.id = contact_id and (c.owner_id = auth.uid() or is_admin(auth.uid())))
  );

create policy "messages: vía conversación" on messages
  for all using (
    exists (select 1 from conversations c where c.id = conversation_id and (c.owner_id = auth.uid() or is_admin(auth.uid())))
  )
  with check (
    exists (select 1 from conversations c where c.id = conversation_id and (c.owner_id = auth.uid() or is_admin(auth.uid())))
  );

create policy "payments: vía cotización" on payments
  for all using (
    exists (select 1 from quotes q where q.id = quote_id and (q.owner_id = auth.uid() or is_admin(auth.uid())))
  )
  with check (
    exists (select 1 from quotes q where q.id = quote_id and (q.owner_id = auth.uid() or is_admin(auth.uid())))
  );

-- audit_log y n8n_dead_letters: solo admin/owner (visibilidad operativa, no de agente individual).
create policy "audit_log: solo admin" on audit_log
  for select using (is_admin(auth.uid()));

create policy "n8n_dead_letters: solo admin" on n8n_dead_letters
  for all using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- ============================================================
-- Realtime
-- ============================================================

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table deals;
