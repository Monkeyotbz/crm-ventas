-- ============================================================
-- Módulo de catálogo turístico — destinos, hospedajes, tours
-- ============================================================
-- Primer consumidor: turismocolombia.fit (tenant nuevo "Turismo Colombia",
-- sembrado en la migración siguiente). El sitio público lo lee sin login
-- (es un catálogo tipo OTA, no un dato del CRM interno) — por eso estas
-- tablas rompen el patrón del resto del esquema: además de la policy
-- "tenant_id = private.current_tenant_id()" para el equipo del tenant,
-- llevan una policy de lectura pública para `status = 'published'`.
--
-- Separado de `products` (catálogo genérico de ventas del SaaS, sin fotos
-- ni amenities): un tour o un hospedaje son contenido rico específico de
-- este vertical, no algo que todo tenant de candyCRM vaya a tener.
--
-- i18n: los campos de texto son jsonb `{ es, en }`, igual que el resto del
-- esquema no toca — el mapeo lo hace el cliente (pickText/pickList del
-- sitio). MVP llena solo "es".

-- ------------------------------------------------------------
-- destinations
-- ------------------------------------------------------------
create table if not exists destinations (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  slug text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  featured boolean not null default false,
  sort_order smallint,
  name jsonb not null default '{}',
  region text,
  country text,
  tagline jsonb,
  description jsonb,
  hero_image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (tenant_id, id)
);

create index if not exists idx_destinations_tenant_id on destinations (tenant_id);
create index if not exists idx_destinations_status on destinations (tenant_id, status);

drop trigger if exists trg_set_updated_at on destinations;
create trigger trg_set_updated_at before update on destinations
  for each row execute function private.set_updated_at();

create table if not exists destination_images (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  destination_id bigint not null,
  storage_path text not null,
  is_cover boolean not null default false,
  sort_order smallint not null default 0,
  alt jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, destination_id) references destinations (tenant_id, id) on delete cascade
);

create index if not exists idx_destination_images_destination_id on destination_images (destination_id);

-- ------------------------------------------------------------
-- features — taxonomía de amenities/inclusiones, configurable por tenant
-- (mismo criterio que `sectors`: no es un check hardcodeado).
-- ------------------------------------------------------------
create table if not exists features (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  slug text not null,
  kind text not null check (kind in ('amenity', 'inclusion')),
  icon text,
  sort_order smallint,
  label jsonb not null,
  unique (tenant_id, slug),
  unique (tenant_id, id)
);

create index if not exists idx_features_tenant_id on features (tenant_id);

-- ------------------------------------------------------------
-- accommodations
-- ------------------------------------------------------------
create table if not exists accommodations (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  slug text not null,
  type text not null check (type in ('cabin', 'hotel', 'apartment', 'house')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  featured boolean not null default false,
  sort_order smallint,
  name jsonb not null default '{}',
  summary jsonb,
  description jsonb,
  city text,
  region text,
  country text,
  destination_id bigint,
  price_from numeric(12, 2),
  currency text not null default 'COP',
  max_guests smallint,
  bedrooms smallint,
  beds smallint,
  bathrooms smallint,
  location_note jsonb,
  -- MVP: la reserva real hoy pasa por la plataforma externa (Booking, etc.),
  -- no por un checkout propio. Cuando exista, esto se reemplaza por
  -- deals/quotes del propio candyCRM.
  external_booking_url text,
  external_platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (tenant_id, id),
  foreign key (tenant_id, destination_id) references destinations (tenant_id, id)
);

create index if not exists idx_accommodations_tenant_id on accommodations (tenant_id);
create index if not exists idx_accommodations_status on accommodations (tenant_id, status);
create index if not exists idx_accommodations_destination_id on accommodations (destination_id);

drop trigger if exists trg_set_updated_at on accommodations;
create trigger trg_set_updated_at before update on accommodations
  for each row execute function private.set_updated_at();

create table if not exists accommodation_images (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  accommodation_id bigint not null,
  storage_path text not null,
  is_cover boolean not null default false,
  sort_order smallint not null default 0,
  alt jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, accommodation_id) references accommodations (tenant_id, id) on delete cascade
);

create index if not exists idx_accommodation_images_accommodation_id on accommodation_images (accommodation_id);

create table if not exists accommodation_features (
  tenant_id uuid not null references tenants (id),
  accommodation_id bigint not null,
  feature_id bigint not null,
  primary key (tenant_id, accommodation_id, feature_id),
  foreign key (tenant_id, accommodation_id) references accommodations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, feature_id) references features (tenant_id, id) on delete cascade
);

create index if not exists idx_accommodation_features_feature_id on accommodation_features (feature_id);

-- ------------------------------------------------------------
-- tours
-- ------------------------------------------------------------
create table if not exists tours (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  slug text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  featured boolean not null default false,
  sort_order smallint,
  category text,
  name jsonb not null default '{}',
  summary jsonb,
  description jsonb,
  city text,
  region text,
  destination_id bigint,
  price_from numeric(12, 2),
  currency text not null default 'COP',
  duration_label jsonb,
  duration_hours numeric(5, 1),
  schedule_label jsonb,
  difficulty text check (difficulty in ('easy', 'moderate', 'hard')),
  min_pax smallint,
  max_pax smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (tenant_id, id),
  foreign key (tenant_id, destination_id) references destinations (tenant_id, id),
  check (max_pax is null or min_pax is null or max_pax >= min_pax)
);

create index if not exists idx_tours_tenant_id on tours (tenant_id);
create index if not exists idx_tours_status on tours (tenant_id, status);
create index if not exists idx_tours_destination_id on tours (destination_id);

drop trigger if exists trg_set_updated_at on tours;
create trigger trg_set_updated_at before update on tours
  for each row execute function private.set_updated_at();

create table if not exists tour_images (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  tour_id bigint not null,
  storage_path text not null,
  is_cover boolean not null default false,
  sort_order smallint not null default 0,
  alt jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, tour_id) references tours (tenant_id, id) on delete cascade
);

create index if not exists idx_tour_images_tour_id on tour_images (tour_id);

create table if not exists tour_features (
  tenant_id uuid not null references tenants (id),
  tour_id bigint not null,
  feature_id bigint not null,
  primary key (tenant_id, tour_id, feature_id),
  foreign key (tenant_id, tour_id) references tours (tenant_id, id) on delete cascade,
  foreign key (tenant_id, feature_id) references features (tenant_id, id) on delete cascade
);

create index if not exists idx_tour_features_feature_id on tour_features (feature_id);

-- ============================================================
-- RLS
-- ============================================================
alter table destinations enable row level security;
alter table destination_images enable row level security;
alter table features enable row level security;
alter table accommodations enable row level security;
alter table accommodation_images enable row level security;
alter table accommodation_features enable row level security;
alter table tours enable row level security;
alter table tour_images enable row level security;
alter table tour_features enable row level security;

-- Lectura pública (sin JWT): el sitio del tenant-cliente pega acá con la
-- anon key. Solo lo publicado; borrador/archivado quedan solo para el
-- equipo del tenant vía la policy de admin.
create policy "destinations: lectura pública de publicados" on destinations
  for select using (status = 'published');
create policy "destinations: lectura del propio tenant" on destinations
  for select using (tenant_id = private.current_tenant_id());
create policy "destinations: escritura de admin" on destinations
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "destination_images: lectura pública vía destino publicado" on destination_images
  for select using (exists (select 1 from destinations d where d.id = destination_id and d.status = 'published'));
create policy "destination_images: lectura del propio tenant" on destination_images
  for select using (tenant_id = private.current_tenant_id());
create policy "destination_images: escritura de admin" on destination_images
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

-- features es solo taxonomía (icono + etiqueta): sin dato sensible, lectura
-- pública siempre, sin filtrar por status de nada.
create policy "features: lectura pública" on features
  for select using (true);
create policy "features: escritura de admin" on features
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "accommodations: lectura pública de publicados" on accommodations
  for select using (status = 'published');
create policy "accommodations: lectura del propio tenant" on accommodations
  for select using (tenant_id = private.current_tenant_id());
create policy "accommodations: escritura de admin" on accommodations
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "accommodation_images: lectura pública vía hospedaje publicado" on accommodation_images
  for select using (exists (select 1 from accommodations a where a.id = accommodation_id and a.status = 'published'));
create policy "accommodation_images: lectura del propio tenant" on accommodation_images
  for select using (tenant_id = private.current_tenant_id());
create policy "accommodation_images: escritura de admin" on accommodation_images
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "accommodation_features: lectura pública vía hospedaje publicado" on accommodation_features
  for select using (exists (select 1 from accommodations a where a.id = accommodation_id and a.status = 'published'));
create policy "accommodation_features: lectura del propio tenant" on accommodation_features
  for select using (tenant_id = private.current_tenant_id());
create policy "accommodation_features: escritura de admin" on accommodation_features
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "tours: lectura pública de publicados" on tours
  for select using (status = 'published');
create policy "tours: lectura del propio tenant" on tours
  for select using (tenant_id = private.current_tenant_id());
create policy "tours: escritura de admin" on tours
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "tour_images: lectura pública vía tour publicado" on tour_images
  for select using (exists (select 1 from tours t where t.id = tour_id and t.status = 'published'));
create policy "tour_images: lectura del propio tenant" on tour_images
  for select using (tenant_id = private.current_tenant_id());
create policy "tour_images: escritura de admin" on tour_images
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

create policy "tour_features: lectura pública vía tour publicado" on tour_features
  for select using (exists (select 1 from tours t where t.id = tour_id and t.status = 'published'));
create policy "tour_features: lectura del propio tenant" on tour_features
  for select using (tenant_id = private.current_tenant_id());
create policy "tour_features: escritura de admin" on tour_features
  for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
  with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));
