-- ============================================================
-- docs/tener-en-cuenta-base-de-datos — parte 1 de 4
-- Pipelines como entidad + catálogo de productos
-- ============================================================

-- ------------------------------------------------------------
-- pipelines — NO está numerado en el documento, pero los ítems 16
-- (products.pipeline_default_id) y 44 (pipeline_transfers, el salto A→B)
-- lo dan por existente. El esquema real solo tenía pipeline_stages planas
-- por tenant, sin nada que las agrupara. Sin esta tabla, "transferir de
-- pipeline A a B" no tiene referente.
-- ------------------------------------------------------------
create table if not exists pipelines (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  nombre text not null,
  -- transaccional (A) / consultivo (B) / expansion (C) según los documentos
  -- de planeación. Es el dato que el Router escribe al clasificar un lead.
  tipo text not null check (tipo in ('transaccional', 'consultivo', 'expansion')),
  orden smallint,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, nombre),
  unique (tenant_id, id)
);

create index if not exists idx_pipelines_tenant_id on pipelines (tenant_id);

-- Pipeline por defecto para las 7 etapas que ya estaban sembradas. NO se
-- siembran A/B/C: cuáles pipelines usa Hellominus es una decisión de negocio
-- todavía no tomada — acá solo se le da un contenedor a lo que ya existía.
insert into pipelines (tenant_id, nombre, tipo, orden)
select t.id, 'Ventas', 'consultivo', 1 from tenants t where t.slug = 'hellominus'
on conflict (tenant_id, nombre) do nothing;

-- pipeline_stages pasa a colgar de un pipeline.
alter table pipeline_stages add column if not exists pipeline_id bigint;

update pipeline_stages ps
set pipeline_id = p.id
from pipelines p
where p.tenant_id = ps.tenant_id and ps.pipeline_id is null;

alter table pipeline_stages alter column pipeline_id set not null;

do $$ begin
  alter table pipeline_stages
    add constraint pipeline_stages_pipeline_fk
    foreign key (tenant_id, pipeline_id) references pipelines (tenant_id, id) on delete cascade;
exception when duplicate_object then null; end $$;

-- El nombre de etapa ahora es único dentro de su pipeline, no del tenant:
-- "Nuevo" puede existir en el pipeline transaccional y en el consultivo.
alter table pipeline_stages drop constraint if exists pipeline_stages_tenant_id_nombre_key;
do $$ begin
  alter table pipeline_stages add constraint pipeline_stages_tenant_pipeline_nombre_key
    unique (tenant_id, pipeline_id, nombre);
exception when duplicate_object then null; end $$;

create index if not exists idx_pipeline_stages_pipeline_id on pipeline_stages (pipeline_id);

-- deals necesita saber en qué pipeline está, no solo en qué etapa — es lo
-- que escribe el Router y lo que permite separar métricas por tipo de lead.
alter table deals add column if not exists pipeline_id bigint;

update deals d
set pipeline_id = ps.pipeline_id
from pipeline_stages ps
where ps.id = d.stage_id and d.pipeline_id is null;

do $$ begin
  alter table deals add constraint deals_pipeline_fk
    foreign key (tenant_id, pipeline_id) references pipelines (tenant_id, id);
exception when duplicate_object then null; end $$;

create index if not exists idx_deals_pipeline_id on deals (pipeline_id);

-- ------------------------------------------------------------
-- products — ítems 15, 16, 17, 18, 22, 24, 25, 48.
-- La tabla entera no existía; el documento asumía que sí.
-- ------------------------------------------------------------
do $$ begin
  create domain tipo_venta_t as text check (value in ('catalogo', 'a_medida'));
exception when duplicate_object then null; end $$;

do $$ begin
  create domain entregable_t as text check (value in ('archivo', 'licencia', 'acceso_plataforma', 'servicio', 'ninguno'));
exception when duplicate_object then null; end $$;

create table if not exists products (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  sku text not null,
  nombre text not null,
  descripcion text,
  -- [15] le dice al Router y al Bot de Catálogo si el producto se vende solo
  -- o necesita un humano.
  tipo_venta tipo_venta_t not null default 'catalogo',
  -- [16] el Router no razona: la decisión vive en el dato del producto.
  pipeline_default_id bigint,
  -- [17] verdadero para todo producto a medida: evita que el bot mande un
  -- link de pago de algo que no tiene precio fijo.
  requiere_cotizacion boolean not null default false,
  precio numeric(12, 2),
  -- [48] sin costo no hay margen real, solo ingreso.
  costo numeric(12, 2),
  moneda text not null default 'USD',
  -- [18] rango orientativo INTERNO para productos a medida: le permite al
  -- SDR estimar el monto del deal sin comprometer precio con el cliente.
  precio_desde numeric(12, 2),
  precio_hasta numeric(12, 2),
  -- [22] el conversor entrega un archivo, una suscripción entrega
  -- credenciales. Sin esto, la entrega automática iría hardcodeada.
  entregable_tipo entregable_t not null default 'ninguno',
  entregable_config jsonb not null default '{}',
  activo boolean not null default true,
  -- [25] productos de temporada sin tener que desactivarlos a mano.
  disponible_desde timestamptz,
  disponible_hasta timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- [24] único por tenant, NO global: dos tenants pueden tener cada uno un
  -- SKU "BASICO" en catálogos independientes.
  unique (tenant_id, sku),
  unique (tenant_id, id),
  foreign key (tenant_id, pipeline_default_id) references pipelines (tenant_id, id),
  -- Coherencia entre [17] y [15]: a_medida siempre requiere cotización.
  check (tipo_venta <> 'a_medida' or requiere_cotizacion),
  check (precio_hasta is null or precio_desde is null or precio_hasta >= precio_desde),
  check (disponible_hasta is null or disponible_desde is null or disponible_hasta > disponible_desde)
);

create index if not exists idx_products_tenant_id on products (tenant_id);
create index if not exists idx_products_pipeline_default on products (pipeline_default_id);

-- ------------------------------------------------------------
-- [19] deal_items — qué productos componen cada deal. Hoy deals solo tenía
-- un valor_estimado suelto, sin desglose de qué se vendió.
-- ------------------------------------------------------------
create table if not exists deal_items (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  deal_id bigint not null,
  product_id bigint not null,
  cantidad integer not null default 1 check (cantidad > 0),
  precio_unitario numeric(12, 2),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);

create index if not exists idx_deal_items_tenant_id on deal_items (tenant_id);
create index if not exists idx_deal_items_deal_id on deal_items (deal_id);
create index if not exists idx_deal_items_product_id on deal_items (product_id);

-- [23] quotes ya existía; lo que faltaba es el versionado. Sin él se pierde
-- qué se ofreció originalmente frente a qué se terminó acordando.
alter table quotes add column if not exists version integer not null default 1;
do $$ begin
  alter table quotes add constraint quotes_deal_version_key unique (tenant_id, deal_id, version);
exception when duplicate_object then null; end $$;

-- updated_at para las tablas nuevas que lo llevan.
drop trigger if exists trg_set_updated_at on products;
create trigger trg_set_updated_at before update on products
  for each row execute function private.set_updated_at();
