-- ============================================================
-- docs/tener-en-cuenta-base-de-datos — parte 2 de 4
-- Reglas de mensajería de WhatsApp/Meta
-- ============================================================

-- [6] categorías de mensaje: cada una tiene tarifa distinta en Meta.
do $$ begin
  create domain categoria_mensaje_t as text check (value in ('marketing', 'utility', 'authentication', 'service'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- [1][2] Ventana de servicio de 24 horas
-- ------------------------------------------------------------
-- ventana_abierta_hasta la actualiza la ingesta con cada mensaje entrante.
-- ventana_horas NO es siempre 24: un lead que entra por Click-to-WhatsApp
-- Ads tiene 72. Asumir 24 fijo cierra la ventana antes de tiempo y el bot
-- deja de poder responder libre cuando todavía podía.
alter table conversations add column if not exists ventana_abierta_hasta timestamptz;
alter table conversations add column if not exists ventana_horas integer not null default 24
  check (ventana_horas > 0);

-- [43] % resuelto por IA sin intervención humana — la métrica que justifica
-- el proyecto entero. agent_executions registra ejecuciones sueltas; esto
-- marca si la CONVERSACIÓN COMPLETA terminó resuelta y por quién.
alter table conversations add column if not exists resuelta_por text
  check (resuelta_por in ('ia', 'humano'));
alter table conversations add column if not exists resuelta_at timestamptz;

-- [45] derivable de messages, pero recalcularlo en cada carga del dashboard
-- sobre millones de filas es caro. Materializarlo cuesta una columna.
alter table conversations add column if not exists primera_respuesta_at timestamptz;

create index if not exists idx_conversations_ventana on conversations (ventana_abierta_hasta)
  where estado = 'abierta';

-- ------------------------------------------------------------
-- [3] message_templates — la fuente de verdad de lo que el bot puede
-- enviar fuera de la ventana de 24h.
-- ------------------------------------------------------------
create table if not exists message_templates (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  nombre text not null,
  categoria categoria_mensaje_t not null,
  idioma text not null default 'es',
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobada', 'rechazada', 'pausada')),
  cuerpo text not null,
  -- Nombres de las variables {{1}}, {{2}}... que espera la plantilla.
  variables jsonb not null default '[]',
  -- El id que le asigna Meta al aprobarla; nulo mientras está pendiente.
  meta_template_id text,
  motivo_rechazo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, nombre, idioma),
  unique (tenant_id, id)
);

create index if not exists idx_message_templates_tenant_id on message_templates (tenant_id);

drop trigger if exists trg_set_updated_at on message_templates;
create trigger trg_set_updated_at before update on message_templates
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------
-- Columnas nuevas de messages
-- ------------------------------------------------------------
-- [4] qué plantilla exacta se usó: sirve para depurar cuando una empieza a
-- fallar, y para el costo por plantilla.
alter table messages add column if not exists template_id bigint references message_templates (id);

-- [6] sin esto ningún reporte puede separar cuánto gastó el Bot de Catálogo
-- en confirmaciones (utility) de una campaña de reactivación (marketing).
alter table messages add column if not exists categoria categoria_mensaje_t;

-- [13] Meta cobra al ENTREGAR, no al enviar — por eso `entregado` es su
-- propia columna y no se infiere del estado del envío.
alter table messages add column if not exists costo_estimado numeric(12, 6);
alter table messages add column if not exists moneda_costo text;
alter table messages add column if not exists entregado boolean not null default false;
alter table messages add column if not exists entregado_at timestamptz;

-- [35] mide la tasa de alucinación. Requiere además un botón en la bandeja
-- para que el vendedor marque la corrección — no alcanza con la columna.
alter table messages add column if not exists corregido_por_humano boolean not null default false;
alter table messages add column if not exists motivo_correccion text;

-- Idempotencia. No está numerado en el documento pero sí exigido por
-- docs/configurar-webhook-meta.md: Meta reintenta el mismo mensaje si la
-- función no confirma en 5s. Sin esto se guarda duplicado.
-- Único por conversación y no global: dos tenants distintos podrían recibir
-- ids externos que colisionen entre proveedores.
alter table messages add column if not exists externo_id text;
create unique index if not exists uq_messages_externo_id
  on messages (conversation_id, externo_id)
  where externo_id is not null;

create index if not exists idx_messages_template_id on messages (template_id);

-- ------------------------------------------------------------
-- [5] Validación "solo plantilla para iniciar"
-- ------------------------------------------------------------
-- Como regla de base de datos y no como algo que el código "debería
-- recordar": hace imposible que se rompa por un descuido en una Edge
-- Function. Solo aplica a whatsapp — el widget web no tiene esta regla.
create or replace function private.validar_plantilla_para_iniciar()
returns trigger as $$
declare
  abierta_hasta timestamptz;
begin
  if new.direccion <> 'out' or new.canal <> 'whatsapp' or new.template_id is not null then
    return new;
  end if;

  select c.ventana_abierta_hasta into abierta_hasta
  from conversations c where c.id = new.conversation_id;

  if abierta_hasta is null or abierta_hasta <= now() then
    raise exception 'Fuera de la ventana de servicio de WhatsApp: un mensaje saliente sin ventana abierta requiere template_id (plantilla aprobada por Meta).';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = private, public;

drop trigger if exists trg_validar_plantilla on messages;
create trigger trg_validar_plantilla
  before insert on messages
  for each row execute function private.validar_plantilla_para_iniciar();

-- ------------------------------------------------------------
-- [7][9][11][41] whatsapp_numbers — un registro por número real conectado.
-- Es también el mapeo phone_number_id → tenant_id del que depende la
-- ingesta multi-tenant: Meta permite un solo webhook por app, así que
-- todos los mensajes llegan al mismo endpoint y hay que resolver de quién
-- es cada uno por el número que lo recibió.
-- ------------------------------------------------------------
create table if not exists whatsapp_numbers (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  -- [11] El documento pedía el UNIQUE sobre waba_id. Va sobre
  -- phone_number_id: la regla de Meta es "un número, una WABA", y una WABA
  -- legítimamente agrupa VARIOS números — hacer único el waba_id rompería
  -- ese caso válido. Este constraint es el que expresa la regla real.
  phone_number_id text not null unique,
  numero_display text,
  waba_id text not null,
  -- [9] agrupa qué números comparten límite de mensajería en Meta. En
  -- multi-tenant, un tenant puede consumirle capacidad de envío a otro sin
  -- que se note hasta que empiezan a fallar los mensajes.
  business_portfolio_id text,
  -- [41] si la calidad cae, Meta puede suspender el número y ese tenant se
  -- queda sin canal — es riesgo operativo, no analítica.
  tier_actual text check (tier_actual in ('tier_250', 'tier_1k', 'tier_10k', 'tier_100k', 'ilimitado')),
  quality_rating text check (quality_rating in ('alta', 'media', 'baja')),
  throughput_limite integer,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create index if not exists idx_whatsapp_numbers_tenant_id on whatsapp_numbers (tenant_id);
create index if not exists idx_whatsapp_numbers_waba on whatsapp_numbers (waba_id);
create index if not exists idx_whatsapp_numbers_portfolio on whatsapp_numbers (business_portfolio_id);

drop trigger if exists trg_set_updated_at on whatsapp_numbers;
create trigger trg_set_updated_at before update on whatsapp_numbers
  for each row execute function private.set_updated_at();

-- [8] histórico de calidad: permite correlacionar una caída con qué se
-- envió esa semana (ej. alguien escribiendo sin consentimiento reciente).
create table if not exists quality_rating_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  whatsapp_number_id bigint not null,
  quality_rating text not null check (quality_rating in ('alta', 'media', 'baja')),
  tier text,
  registrado_at timestamptz not null default now(),
  foreign key (tenant_id, whatsapp_number_id) references whatsapp_numbers (tenant_id, id) on delete cascade
);

create index if not exists idx_quality_history_number on quality_rating_history (whatsapp_number_id, registrado_at desc);
create index if not exists idx_quality_history_tenant on quality_rating_history (tenant_id);

-- ------------------------------------------------------------
-- [14] whatsapp_pricing — tarifa por país + categoría.
-- En tabla y no en código: Meta actualiza tarifas hasta 4 veces al año, y
-- así se ajusta sin redeployar nada. NO lleva tenant_id: son las tarifas de
-- Meta, iguales para todos.
-- ------------------------------------------------------------
create table if not exists whatsapp_pricing (
  id bigint generated always as identity primary key,
  pais text not null,
  categoria categoria_mensaje_t not null,
  tarifa numeric(12, 6) not null,
  moneda text not null default 'USD',
  vigente_desde date not null,
  vigente_hasta date,
  created_at timestamptz not null default now(),
  unique (pais, categoria, vigente_desde),
  check (vigente_hasta is null or vigente_hasta > vigente_desde)
);

create index if not exists idx_whatsapp_pricing_lookup on whatsapp_pricing (pais, categoria, vigente_desde desc);

-- ------------------------------------------------------------
-- [12] Consentimiento (opt-in) — la regla que más rápido tumba el Quality
-- Rating si no se respeta. El Router y los agentes tienen que poder
-- verificar consentimiento vigente ANTES de escribirle a alguien, y el
-- sistema tiene que poder demostrar cuándo y cómo se dio si Meta lo pide.
-- ------------------------------------------------------------
alter table contacts add column if not exists opt_in_at timestamptz;
alter table contacts add column if not exists opt_in_source text;
alter table contacts add column if not exists opt_out_at timestamptz;

-- [29] única forma de capturar referidos, voz a voz y eventos — canales sin
-- rastro digital que suelen traer los mejores clientes. Lo pregunta el SDR.
alter table contacts add column if not exists como_nos_conocio text
  check (como_nos_conocio in ('busqueda_google', 'redes_sociales', 'anuncio', 'referido', 'evento', 'voz_a_voz', 'otro'));

-- [30] revela el ciclo real de decisión, casi siempre más largo de lo
-- asumido. Materializado desde contact_touchpoints (parte 3).
alter table contacts add column if not exists visitas_antes_contacto integer not null default 0;

-- [10] muestra tenant por tenant cuál ya está verificado, sin ir a revisar
-- Business Manager a mano.
alter table tenants add column if not exists meta_business_verificado boolean not null default false;
alter table tenants add column if not exists meta_verified_at timestamptz;
