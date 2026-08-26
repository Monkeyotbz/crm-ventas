-- ============================================================
-- docs/tener-en-cuenta-base-de-datos — parte 3 de 4
-- Atribución multi-touch, rendimiento de agentes, plataforma como producto
-- ============================================================

-- ------------------------------------------------------------
-- [26][27][28] contact_touchpoints — un registro por interacción ANTES de
-- que el contacto escriba. Hoy solo se guardaba contacts.origen, que
-- colapsa toda la historia en un campo y le da todo el crédito al último
-- toque.
-- ------------------------------------------------------------
create table if not exists contact_touchpoints (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  -- Nullable: un toque puede registrarse ANÓNIMO (visita web sin
  -- identificar) y recién asociarse al contacto cuando este se identifica.
  -- Es justamente el caso que habilita contar visitas_antes_contacto.
  contact_id bigint,
  -- Identificador de sesión anónima (cookie/localStorage del widget web),
  -- el puente entre los toques previos y el contacto ya identificado.
  sesion_anonima text,
  ocurrido_at timestamptz not null default now(),
  canal fuente_type not null,
  campaign_id text,
  adset_id text,
  ad_id text,
  ctwa_clid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  -- [27] sin esto, un lead de un foro de constructores y uno de un
  -- comparador de software se ven idénticos como "orgánico".
  referrer text,
  landing_page text,
  -- [28] el dispositivo cambia el comportamiento de compra; la ciudad
  -- revela concentraciones geográficas.
  dispositivo text check (dispositivo in ('movil', 'escritorio', 'tablet', 'otro')),
  ciudad text,
  pais text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade
);

create index if not exists idx_touchpoints_tenant_id on contact_touchpoints (tenant_id);
create index if not exists idx_touchpoints_contact_id on contact_touchpoints (contact_id, ocurrido_at);
create index if not exists idx_touchpoints_sesion on contact_touchpoints (sesion_anonima) where sesion_anonima is not null;
create index if not exists idx_touchpoints_campaign on contact_touchpoints (campaign_id) where campaign_id is not null;

-- ------------------------------------------------------------
-- [31][32][33] agent_executions — una fila por ejecución de agente. Es la
-- base de la mitad de los indicadores internos: % resuelto por IA, turnos
-- hasta resolver, tiempo de primera respuesta, costo por conversación.
-- ------------------------------------------------------------
do $$ begin
  create domain motivo_escalamiento_t as text check (value in ('monto_alto', 'cliente_molesto', 'fuera_de_alcance', 'no_supo_responder', 'pedido_explicito'));
exception when duplicate_object then null; end $$;

create table if not exists agent_executions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  agente text not null,
  conversation_id bigint references conversations (id) on delete set null,
  deal_id bigint,
  modelo text,
  latencia_ms integer,
  resultado text check (resultado in ('ok', 'error', 'timeout')),
  error text,
  -- [32] distingue el escalamiento SANO (correcto por diseño) del
  -- escalamiento por falla del agente. Solo el segundo hay que arreglarlo;
  -- sin el enum los dos se ven igual en el dashboard.
  escalado boolean not null default false,
  motivo_escalamiento motivo_escalamiento_t,
  -- [33] detecta agentes con prompts inflados o que arrastran demasiado
  -- contexto.
  tokens_entrada integer,
  tokens_salida integer,
  costo_tokens numeric(12, 6),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete set null (deal_id),
  -- Coherencia: si no escaló, no puede haber motivo de escalamiento.
  check (escalado or motivo_escalamiento is null)
);

create index if not exists idx_agent_exec_tenant_id on agent_executions (tenant_id, created_at desc);
create index if not exists idx_agent_exec_conversation on agent_executions (conversation_id);
create index if not exists idx_agent_exec_agente on agent_executions (agente, created_at desc);
create index if not exists idx_agent_exec_escalado on agent_executions (tenant_id, motivo_escalamiento) where escalado;

-- ------------------------------------------------------------
-- [34] router_decisions — única forma de medir la precisión del Router, la
-- pieza más upstream del sistema. Sin el registro de corrección manual no
-- hay forma de saber qué reglas ajustar.
-- ------------------------------------------------------------
create table if not exists router_decisions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  conversation_id bigint references conversations (id) on delete set null,
  message_id bigint references messages (id) on delete set null,
  pipeline_id bigint,
  -- Qué capa resolvió: las reglas determinísticas (gratis) o el LLM.
  capa text not null check (capa in ('reglas', 'semantica')),
  regla_aplicada text,
  confianza numeric(4, 3) check (confianza between 0 and 1),
  senales jsonb not null default '[]',
  -- Corrección posterior: es lo que convierte esta tabla en una medición
  -- de precisión y no en un simple log.
  corregido_por_humano boolean not null default false,
  pipeline_corregido_id bigint,
  corregido_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, pipeline_id) references pipelines (tenant_id, id),
  foreign key (tenant_id, pipeline_corregido_id) references pipelines (tenant_id, id)
);

create index if not exists idx_router_decisions_tenant on router_decisions (tenant_id, created_at desc);
create index if not exists idx_router_decisions_conversation on router_decisions (conversation_id);
create index if not exists idx_router_decisions_corregido on router_decisions (tenant_id) where corregido_por_humano;

-- ------------------------------------------------------------
-- [44] pipeline_transfers — el salto A→B. La tabla no existía; el
-- documento la daba por hecha ("hoy solo se guarda que el salto ocurrió").
-- Sin distinguir detección automática de hallazgo tardío solo se pueden
-- contar los aciertos y nunca las fallas — que son el dinero perdido.
-- ------------------------------------------------------------
create table if not exists pipeline_transfers (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  deal_id bigint not null,
  conversation_id bigint references conversations (id) on delete set null,
  pipeline_origen_id bigint,
  pipeline_destino_id bigint not null,
  detectado_por text not null check (detectado_por in ('router', 'humano')),
  -- Se descubrió tarde: el lead venía siendo atendido con el pipeline
  -- equivocado. Es la métrica de falla, no de acierto.
  detectado_tarde boolean not null default false,
  motivo text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, pipeline_origen_id) references pipelines (tenant_id, id),
  foreign key (tenant_id, pipeline_destino_id) references pipelines (tenant_id, id)
);

create index if not exists idx_pipeline_transfers_tenant on pipeline_transfers (tenant_id, created_at desc);
create index if not exists idx_pipeline_transfers_deal on pipeline_transfers (deal_id);
create index if not exists idx_pipeline_transfers_tarde on pipeline_transfers (tenant_id) where detectado_tarde;

-- ------------------------------------------------------------
-- [20][21] Pagos del Pipeline A — el bot cobra y entrega solo.
-- payments YA EXISTÍA pero colgaba obligatoriamente de una cotización; en
-- Pipeline A no hay cotización, hay un link de pago directo. Se agrega
-- payment_links y se afloja payments para admitir las dos rutas.
-- ------------------------------------------------------------
create table if not exists payment_links (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  deal_id bigint,
  contact_id bigint,
  monto numeric(12, 2) not null,
  moneda text not null default 'USD',
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'pagado', 'expirado', 'cancelado')),
  proveedor text,
  proveedor_link_id text,
  url text,
  expira_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete set null (deal_id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete set null (contact_id)
);

create index if not exists idx_payment_links_tenant on payment_links (tenant_id);
create index if not exists idx_payment_links_deal on payment_links (deal_id);
-- El Agente de Recuperación pregunta exactamente esto: links pendientes que
-- ya pasaron su ventana de abandono.
create index if not exists idx_payment_links_pendientes on payment_links (tenant_id, created_at)
  where estado = 'pendiente';

drop trigger if exists trg_set_updated_at on payment_links;
create trigger trg_set_updated_at before update on payment_links
  for each row execute function private.set_updated_at();

alter table payments add column if not exists tenant_id uuid references tenants (id);
alter table payments add column if not exists payment_link_id bigint;
alter table payments alter column quote_id drop not null;

do $$ begin
  alter table payments add constraint payments_payment_link_fk
    foreign key (tenant_id, payment_link_id) references payment_links (tenant_id, id);
exception when duplicate_object then null; end $$;

-- Un pago viene de una cotización (Pipeline B) o de un link (Pipeline A),
-- nunca de ninguno de los dos.
do $$ begin
  alter table payments add constraint payments_origen_check
    check (quote_id is not null or payment_link_id is not null);
exception when duplicate_object then null; end $$;

create index if not exists idx_payments_tenant on payments (tenant_id);
create index if not exists idx_payments_link on payments (payment_link_id);

-- ------------------------------------------------------------
-- [36][37][38][39] La plataforma como producto (SaaS)
-- ------------------------------------------------------------
-- [36] alimenta MRR y detección de expansión de cuenta. Hasta ahora tenants
-- solo tenía nombre y slug: ningún dato comercial de la relación.
create table if not exists subscriptions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  plan text not null,
  precio_mensual numeric(12, 2) not null,
  moneda text not null default 'USD',
  estado text not null default 'activa'
    check (estado in ('trial', 'activa', 'morosa', 'cancelada')),
  inicio_at timestamptz not null default now(),
  renueva_at timestamptz,
  cancelada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_tenant on subscriptions (tenant_id);
create index if not exists idx_subscriptions_estado on subscriptions (estado, renueva_at);

drop trigger if exists trg_set_updated_at on subscriptions;
create trigger trg_set_updated_at before update on subscriptions
  for each row execute function private.set_updated_at();

-- [38] adopción por funcionalidad. Con pocos tenants y producto nuevo van a
-- usar casi todo — cobra sentido cuando haya funciones viejas compitiendo
-- con nuevas.
create table if not exists feature_usage (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  feature text not null,
  user_id uuid references auth.users (id) on delete set null,
  usado_at timestamptz not null default now()
);

create index if not exists idx_feature_usage_tenant on feature_usage (tenant_id, feature, usado_at desc);

-- [37] time-to-value. [39] señales tempranas de churn: recuperar una cuenta
-- antes de que se vaya es mucho más barato que conseguir una nueva.
alter table tenants add column if not exists onboarding_completado_at timestamptz;
alter table tenants add column if not exists primer_deal_cerrado_at timestamptz;
alter table tenants add column if not exists ultimo_login_at timestamptz;
alter table tenants add column if not exists deals_movidos_ultimos_30d integer not null default 0;

-- ------------------------------------------------------------
-- [40] webhook_errors — un mensaje perdido es un lead perdido que nadie
-- reclama, porque nadie sabe que existió. El fallo más silencioso y más
-- caro del sistema.
-- tenant_id nullable: un webhook puede fallar ANTES de poder resolver de
-- qué tenant era — mismo criterio que n8n_dead_letters.
-- ------------------------------------------------------------
create table if not exists webhook_errors (
  id bigint generated always as identity primary key,
  tenant_id uuid references tenants (id),
  origen text not null,
  evento text,
  http_status integer,
  error text not null,
  payload jsonb,
  reintentos integer not null default 0,
  resuelto boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_webhook_errors_pendientes on webhook_errors (origen, created_at desc)
  where not resuelto;
create index if not exists idx_webhook_errors_tenant on webhook_errors (tenant_id);

-- ------------------------------------------------------------
-- [46] metrics_snapshots — ningún dashboard sirve sin series de tiempo.
-- "¿el % resuelto por IA está subiendo o bajando?" no se responde con el
-- dato de hoy. Es la diferencia entre un panel que carga en un segundo y
-- uno que se vuelve inusable a los seis meses.
-- ------------------------------------------------------------
create table if not exists metrics_snapshots (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  fecha date not null,
  conversaciones_nuevas integer not null default 0,
  conversaciones_resueltas integer not null default 0,
  resueltas_por_ia integer not null default 0,
  mensajes_entrantes integer not null default 0,
  mensajes_salientes integer not null default 0,
  deals_creados integer not null default 0,
  deals_ganados integer not null default 0,
  ingreso numeric(14, 2) not null default 0,
  costo_mensajes numeric(14, 6) not null default 0,
  costo_tokens numeric(14, 6) not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, fecha)
);

create index if not exists idx_metrics_snapshots_tenant_fecha on metrics_snapshots (tenant_id, fecha desc);

-- ------------------------------------------------------------
-- [47] search_console_data — dato externo de Google, no una carencia del
-- modelo propio. El propio documento lo marca ⚪ Baja: no bloquea nada.
-- ------------------------------------------------------------
create table if not exists search_console_data (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  fecha date not null,
  consulta text not null,
  pagina text,
  impresiones integer not null default 0,
  clics integer not null default 0,
  posicion numeric(6, 2),
  created_at timestamptz not null default now(),
  unique (tenant_id, fecha, consulta, pagina)
);

create index if not exists idx_search_console_tenant_fecha on search_console_data (tenant_id, fecha desc);
