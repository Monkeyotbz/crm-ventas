-- Piezas que le faltaban al Router (candidato [5] de docs/DECISIONES.md).
--
-- La especificación (docs/guia-fases-1-2.md 2.1) da por sembrada una tabla
-- `routing_rules` "ya sembrada en 1.3", y menciona un archivo
-- `20260823000002_seed_pipelines.sql` con tres pipelines y 6 reglas. Ninguna de
-- las dos cosas existe: ese archivo es de la propuesta original, nunca se creó
-- en el esquema real. Hoy hay UN solo pipeline sembrado ('Ventas', consultivo).
--
-- Esta migración cierra las dos brechas para que el Router tenga de dónde leer
-- y a dónde clasificar.

-- ---------------------------------------------------------------------------
-- 1. Los pipelines A y C. B ya existe como 'Ventas' (tipo consultivo).
-- ---------------------------------------------------------------------------
insert into pipelines (tenant_id, nombre, tipo, orden)
select t.id, 'Transaccional', 'transaccional', 0 from tenants t where t.slug = 'hellominus'
on conflict (tenant_id, nombre) do nothing;

insert into pipelines (tenant_id, nombre, tipo, orden)
select t.id, 'Expansión', 'expansion', 2 from tenants t where t.slug = 'hellominus'
on conflict (tenant_id, nombre) do nothing;

-- Etapas mínimas para los dos pipelines nuevos. El pipeline consultivo ya tiene
-- sus 7 etapas sembradas desde la primera migración; estos arrancan con lo justo
-- para que un deal recién creado tenga dónde caer.
-- pipeline_stages tiene (nombre, orden, color) — no hay columna de probabilidad,
-- aunque el documento de planeación la mencione. Se siembra con lo que existe.
-- El unique es (tenant_id, pipeline_id, nombre) desde doc48_p1, así que
-- "Lead entrante" puede repetirse en cada pipeline sin chocar.
insert into pipeline_stages (tenant_id, pipeline_id, nombre, orden, color)
select p.tenant_id, p.id, e.nombre, e.orden, e.color
from pipelines p
cross join (values
  ('Lead entrante',    1, '#22d3ee'),
  ('En conversación',  2, '#a78bfa'),
  ('Cerrado ganado',   3, '#34d399'),
  ('Cerrado perdido',  4, '#f87171')
) as e(nombre, orden, color)
where p.tipo in ('transaccional', 'expansion')
on conflict (tenant_id, pipeline_id, nombre) do nothing;

-- ---------------------------------------------------------------------------
-- 2. routing_rules — la capa 1 del Router: señales duras, sin costo de LLM.
-- ---------------------------------------------------------------------------
-- Se evalúan por `prioridad` ascendente y gana la primera que matchea. Que sean
-- datos y no código es deliberado: la especificación dice que las reglas "se
-- pueden ajustar después sin tocar código" (hoja-de-ruta, Paso 02).
create table if not exists routing_rules (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  -- Menor número = se evalúa antes. La primera que matchea gana y corta.
  prioridad smallint not null,
  nombre text not null,
  -- Sobre qué dato se evalúa la señal.
  campo text not null check (campo in ('contenido', 'origen', 'email_dominio', 'telefono')),
  operador text not null check (operador in ('contiene', 'igual', 'regex')),
  valor text not null,
  -- A qué pipeline manda si matchea.
  pipeline_id bigint not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, nombre),
  -- FK compuesta: una regla de un tenant no puede apuntar al pipeline de otro.
  foreign key (tenant_id, pipeline_id) references pipelines (tenant_id, id) on delete cascade
);

create index if not exists idx_routing_rules_tenant_prioridad
  on routing_rules (tenant_id, prioridad) where activo;

alter table routing_rules enable row level security;

-- Mismo patrón que pipelines/products/message_templates: lo lee todo el tenant,
-- lo escribe solo un admin. Un vendedor no debería poder cambiar las reglas de
-- clasificación al vuelo.
do $$ begin
  create policy "routing_rules: lectura del propio tenant" on routing_rules
    for select using (tenant_id = private.current_tenant_id());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "routing_rules: escritura de admin" on routing_rules
    for all using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()))
    with check (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Reglas iniciales.
-- ---------------------------------------------------------------------------
-- Son un punto de partida, no una verdad: la tabla existe justamente para
-- ajustarlas con lo que se aprenda de los leads reales.
insert into routing_rules (tenant_id, prioridad, nombre, campo, operador, valor, pipeline_id)
select t.id, r.prioridad, r.nombre, r.campo, r.operador, r.valor, p.id
from tenants t
cross join (values
  -- Señales de empresa → consultivo (B). Van primero: si alguien menciona
  -- equipo o empresa, eso pesa más que cualquier señal de compra chica.
  (10, 'Menciona equipo o empresa',   'contenido', 'regex',    '(?i)(mi equipo|somos [0-9]+|mi empresa|la constructora|nuestra empresa)', 'consultivo'),
  (20, 'Pide demo o reunión',          'contenido', 'regex',    '(?i)(demo|reuni[oó]n|agendar|cotizaci[oó]n formal)',                     'consultivo'),
  -- Señales de compra directa → transaccional (A).
  (50, 'Pide un producto puntual',     'contenido', 'regex',    '(?i)(convertir|conversor|descargar|comprar ya|precio de)',              'transaccional'),
  -- Cliente existente que vuelve → expansión (C).
  (70, 'Menciona renovar o ampliar',   'contenido', 'regex',    '(?i)(renovar|ampliar|agregar licencias|sumar usuarios)',                'expansion')
) as r(prioridad, nombre, campo, operador, valor, tipo_destino)
join pipelines p on p.tenant_id = t.id and p.tipo = r.tipo_destino
where t.slug = 'hellominus'
on conflict (tenant_id, nombre) do nothing;
