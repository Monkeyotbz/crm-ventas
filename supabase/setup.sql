-- Ejecutar en el SQL Editor de un proyecto Supabase NUEVO y dedicado al CRM
-- de ventas (no el de hellominus.com ni el de KAIROS). Ver supabase/README.md
-- para el paso a paso.

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
  sector text check (sector in ('construccion', 'derecho', 'ventas', 'cobranza', 'otro')),
  email text,
  telefono text,
  origen fuente_type not null default 'manual',
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contact_channels (
  id bigint generated always as identity primary key,
  contact_id bigint not null references contacts (id) on delete cascade,
  tipo text not null check (tipo in ('whatsapp', 'instagram', 'messenger', 'linkedin', 'email')),
  valor text not null,
  created_at timestamptz not null default now(),
  unique (tipo, valor)
);

create table if not exists conversations (
  id bigint generated always as identity primary key,
  contact_id bigint not null references contacts (id) on delete cascade,
  canal canal_type not null,
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
create view contact_latest_insight with (security_invoker = true) as
select distinct on (co.contact_id)
  co.contact_id, ci.*
from conversations co
join conversation_insights ci on ci.conversation_id = co.id
order by co.contact_id, co.ultimo_mensaje_at desc nulls last, co.created_at desc;

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
  fuente fuente_type not null default 'manual',
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

-- Reuniones agendadas con un contacto (franja de "Agenda del día" del
-- dashboard). Distinta de activities: acá el dato central es un horario con
-- duración, no un recordatorio con un solo vencimiento. Ancla en contact_id
-- (no deal_id) porque una reunión puede agendarse sin deal todavía; deal_id
-- es opcional para reportes futuros por etapa de pipeline. El destacado
-- "en curso" de la UI no se guarda: se calcula en la query/render a partir
-- de inicio_at + duracion_minutos contra now().
create table if not exists meetings (
  id bigint generated always as identity primary key,
  contact_id bigint not null references contacts (id) on delete cascade,
  deal_id bigint references deals (id) on delete set null,
  contenido text,
  inicio_at timestamptz not null,
  duracion_minutos smallint not null default 30 check (duracion_minutos > 0),
  estado text not null default 'programada' check (estado in ('programada', 'completada', 'cancelada')),
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create policy "meetings: dueño o admin" on meetings
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

create policy "conversation_insights: vía conversación" on conversation_insights
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
alter publication supabase_realtime add table conversation_insights;
