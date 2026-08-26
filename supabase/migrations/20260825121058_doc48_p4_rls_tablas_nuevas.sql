-- ============================================================
-- docs/tener-en-cuenta-base-de-datos — parte 4 de 4
-- RLS de las 17 tablas nuevas
-- ============================================================
-- Las funciones viven en el schema `private` desde el hardening, así que
-- acá se las llama calificadas: al crear una policy la expresión se resuelve
-- con el search_path del momento, y `private` no está en él.
--
-- Criterio de separación, tomado del ítem 42 del documento (los indicadores
-- internos NUNCA son visibles a un tenant-cliente):
--   · Catálogo/operativo del tenant  -> lee el tenant, escribe su admin
--   · Indicadores internos del SaaS  -> solo admin de plataforma

alter table pipelines enable row level security;
alter table products enable row level security;
alter table deal_items enable row level security;
alter table message_templates enable row level security;
alter table whatsapp_numbers enable row level security;
alter table quality_rating_history enable row level security;
alter table whatsapp_pricing enable row level security;
alter table contact_touchpoints enable row level security;
alter table agent_executions enable row level security;
alter table router_decisions enable row level security;
alter table pipeline_transfers enable row level security;
alter table payment_links enable row level security;
alter table subscriptions enable row level security;
alter table feature_usage enable row level security;
alter table webhook_errors enable row level security;
alter table metrics_snapshots enable row level security;
alter table search_console_data enable row level security;

-- ------------------------------------------------------------
-- Catálogo del tenant: lo lee cualquiera del tenant, lo escribe su admin.
-- Mismo criterio que ya regía para pipeline_stages y sectors — un agente no
-- debería poder inventar productos o pipelines al vuelo.
-- ------------------------------------------------------------
create policy "pipelines: lectura del propio tenant" on pipelines
  for select using (tenant_id = private.current_tenant_id());
create policy "pipelines: escritura de admin" on pipelines
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "products: lectura del propio tenant" on products
  for select using (tenant_id = private.current_tenant_id());
create policy "products: escritura de admin" on products
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "message_templates: lectura del propio tenant" on message_templates
  for select using (tenant_id = private.current_tenant_id());
create policy "message_templates: escritura de admin" on message_templates
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

-- whatsapp_numbers: el tenant necesita VER el estado de su canal (si el
-- quality_rating cae, se queda sin WhatsApp), pero conectar o desconectar
-- un número es operación de plataforma.
create policy "whatsapp_numbers: lectura del propio tenant" on whatsapp_numbers
  for select using (tenant_id = private.current_tenant_id());
create policy "whatsapp_numbers: escritura de plataforma" on whatsapp_numbers
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

create policy "quality_rating_history: lectura del propio tenant" on quality_rating_history
  for select using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

-- whatsapp_pricing: son las tarifas de Meta, iguales para todos — no lleva
-- tenant_id. Lectura para cualquier autenticado; escribirlas es de
-- plataforma (las actualiza quien opera la integración).
create policy "whatsapp_pricing: lectura autenticada" on whatsapp_pricing
  for select using (auth.role() = 'authenticated');
create policy "whatsapp_pricing: escritura de plataforma" on whatsapp_pricing
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

-- ------------------------------------------------------------
-- Operativo del tenant, colgado de un padre con owner_id: se resuelve a
-- través del padre, igual que contact_channels y messages.
-- ------------------------------------------------------------
create policy "deal_items: vía deal" on deal_items
  for all using (
    tenant_id = private.current_tenant_id()
    and exists (select 1 from deals d where d.id = deal_id and (d.owner_id = auth.uid() or private.is_admin(auth.uid())))
  )
  with check (
    tenant_id = private.current_tenant_id()
    and exists (select 1 from deals d where d.id = deal_id and (d.owner_id = auth.uid() or private.is_admin(auth.uid())))
  );

create policy "pipeline_transfers: vía deal" on pipeline_transfers
  for all using (
    tenant_id = private.current_tenant_id()
    and exists (select 1 from deals d where d.id = deal_id and (d.owner_id = auth.uid() or private.is_admin(auth.uid())))
  )
  with check (
    tenant_id = private.current_tenant_id()
    and exists (select 1 from deals d where d.id = deal_id and (d.owner_id = auth.uid() or private.is_admin(auth.uid())))
  );

-- payment_links: deal_id y contact_id son nullable (un link puede existir
-- antes de que haya deal), así que se acepta por cualquiera de los dos
-- padres; sin ninguno, solo admin.
create policy "payment_links: vía deal o contacto" on payment_links
  for all using (
    tenant_id = private.current_tenant_id()
    and (
      private.is_admin(auth.uid())
      or exists (select 1 from deals d where d.id = deal_id and d.owner_id = auth.uid())
      or exists (select 1 from contacts c where c.id = contact_id and c.owner_id = auth.uid())
    )
  )
  with check (
    tenant_id = private.current_tenant_id()
    and (
      private.is_admin(auth.uid())
      or exists (select 1 from deals d where d.id = deal_id and d.owner_id = auth.uid())
      or exists (select 1 from contacts c where c.id = contact_id and c.owner_id = auth.uid())
    )
  );

-- contact_touchpoints: contact_id es nullable a propósito (toques anónimos
-- previos a la identificación). Los anónimos los ve el admin del tenant;
-- los ya asociados, el dueño del contacto.
create policy "contact_touchpoints: vía contacto" on contact_touchpoints
  for all using (
    tenant_id = private.current_tenant_id()
    and (
      private.is_admin(auth.uid())
      or exists (select 1 from contacts c where c.id = contact_id and c.owner_id = auth.uid())
    )
  )
  with check (
    tenant_id = private.current_tenant_id()
    and (
      private.is_admin(auth.uid())
      or exists (select 1 from contacts c where c.id = contact_id and c.owner_id = auth.uid())
    )
  );

-- ------------------------------------------------------------
-- Dashboards del tenant sobre su propio negocio.
-- ------------------------------------------------------------
create policy "metrics_snapshots: lectura del propio tenant" on metrics_snapshots
  for select using (tenant_id = private.current_tenant_id());

create policy "search_console_data: lectura del propio tenant" on search_console_data
  for select using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

-- ------------------------------------------------------------
-- Indicadores internos de la plataforma — ítem 42: NUNCA visibles a un
-- tenant-cliente. Acá es donde esa separación deja de ser una intención de
-- diseño y pasa a ser una barrera real protegida por RLS.
--
-- agent_executions y router_decisions salen de
-- indicadores-internos-plataforma (Grupo 1): miden el rendimiento de los
-- agentes y la precisión del Router, no el negocio del tenant. Lo que el
-- tenant sí ve de esto es conversations.resuelta_por, que es su métrica.
-- ------------------------------------------------------------
create policy "agent_executions: solo plataforma" on agent_executions
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

create policy "router_decisions: solo plataforma" on router_decisions
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

-- subscriptions y feature_usage son la relación comercial y de uso entre
-- Hellominus y cada tenant-cliente: el tenant no ve ni su propio plan desde
-- acá (eso sería una pantalla de facturación, con su propia vista acotada).
create policy "subscriptions: solo plataforma" on subscriptions
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

create policy "feature_usage: solo plataforma" on feature_usage
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

-- webhook_errors: salud técnica de la integración, que opera la plataforma.
-- Incluye los huérfanos (tenant_id nulo) que ningún tenant podría reclamar.
create policy "webhook_errors: solo plataforma" on webhook_errors
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());
