-- Segunda mitad del candidato [9a] de docs/DECISIONES.md: la API de ingesta
-- con la que el sistema propio de un tenant empuja leads hacia candyCRM.
-- (La primera mitad, credenciales de Meta por tenant, ya está en
-- 20260906000001.)
--
-- La regla que manda sobre este diseño está en CLAUDE.md, "Se vende por dos
-- carriles": candyCRM también se vende de forma masiva, donde el comprador se
-- lo adapta solo, sin nadie de Hellominus del otro lado. Por eso el alta y la
-- rotación de claves son AUTOSERVICIO — a diferencia de chat_widget_keys, que
-- a propósito no tiene policy de escritura y se administra por SQL directo.
-- Copiar ese patrón acá dejaría al tenant del carril masivo sin poder conectar
-- su sistema.

-- ---------------------------------------------------------------------------
-- Dominios: 'api' como canal y como fuente
-- ---------------------------------------------------------------------------
-- Sin esto, un lead entrado por API tendría que registrarse como 'manual', que
-- significa "lo cargó una persona a mano" — ensucia la atribución de origen que
-- después leen los indicadores del dashboard (docs/indicadores-dashboard.md).
alter domain canal_type drop constraint canal_type_check;
alter domain canal_type add constraint canal_type_check
  check (value in ('chat_web', 'whatsapp', 'instagram', 'messenger', 'linkedin', 'api'));

alter domain fuente_type drop constraint fuente_type_check;
alter domain fuente_type add constraint fuente_type_check
  check (value in ('chat_web', 'whatsapp', 'instagram', 'messenger', 'linkedin', 'meta_ads', 'manual', 'api'));

-- ---------------------------------------------------------------------------
-- contacts.external_id — idempotencia de la ingesta
-- ---------------------------------------------------------------------------
-- El identificador del registro en el sistema DEL TENANT, no nuestro. Un
-- sistema externo reintenta cuando algo falla, y hasta hoy nada impedía que el
-- mismo lead entrara dos veces (el propio supabase/README.md lo marcaba como
-- pendiente sin resolver). Con esto, un reintento actualiza en vez de duplicar.
alter table contacts add column if not exists external_id text;

-- Parcial (`where external_id is not null`) por dos motivos: los miles de
-- contactos que ya existen lo tienen null y no deben chocar entre sí, y un
-- tenant que nunca use la API no paga nada por el índice.
create unique index if not exists uq_contacts_tenant_external
  on contacts (tenant_id, external_id)
  where external_id is not null;

comment on column contacts.external_id is
  'Identificador de este contacto en el sistema del propio tenant (no de candyCRM). Lo manda la API de ingesta para poder deduplicar reintentos. Null para contactos que no entraron por API.';

-- ---------------------------------------------------------------------------
-- tenant_api_keys
-- ---------------------------------------------------------------------------
-- Diferencia deliberada con chat_widget_keys: esa clave es PUBLICABLE (viaja en
-- el HTML de cualquier sitio que embeba el widget) y por eso se guarda en
-- claro. Esta vive en el servidor del tenant y es un secreto real, así que se
-- guarda SOLO el hash: ni nosotros podemos recuperarla. Se muestra una única
-- vez, al crearla — mismo criterio de "secreto de escritura única" que ya se
-- usó para los tokens de Meta.
--
-- Varias claves por tenant (chat_widget_keys tiene tenant_id unique, esta no):
-- sin eso no se puede rotar sin cortar el servicio. El flujo sano es crear la
-- nueva, migrar el sistema que la usa, y recién ahí revocar la vieja.
create table if not exists tenant_api_keys (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  nombre text not null,
  prefijo text not null,
  hash_clave text not null unique,
  activo boolean not null default true,
  ultimo_uso_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create index if not exists idx_tenant_api_keys_tenant on tenant_api_keys (tenant_id);

alter table tenant_api_keys enable row level security;

-- Solo lectura, y solo del admin del propio tenant. `hash_clave` viaja en el
-- select pero no sirve para nada: es un hash, no la clave.
create policy "tenant_api_keys: lectura del admin del propio tenant" on tenant_api_keys
  for select using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

-- Sin policy de escritura a propósito: crear una clave implica generarla,
-- hashearla y devolver el valor en claro una sola vez — eso no se puede hacer
-- desde un insert por REST. Pasa por crear_api_key(), abajo.

comment on table tenant_api_keys is
  'Claves de la API de ingesta, una o varias por tenant (candidato [9a]). Guarda solo el hash SHA-256: la clave en claro se muestra únicamente al crearla y no se puede recuperar después.';

-- ---------------------------------------------------------------------------
-- crear_api_key — autoservicio: el admin del tenant genera su propia clave
-- ---------------------------------------------------------------------------
-- Mismo molde que guardar_credenciales_meta (20260906000001): siempre actúa
-- sobre private.current_tenant_id(), nunca sobre un tenant_id que mande el
-- cliente, así que un admin no puede crear una clave para otro tenant ni por
-- error de programación del frontend.
--
-- Devuelve la clave EN CLARO. Es la única vez que existe fuera del servidor del
-- tenant: de la fila guardada solo se puede recuperar el hash.
create or replace function public.crear_api_key(p_nombre text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_clave text;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'Solo un admin del tenant puede crear claves de API';
  end if;

  if nullif(trim(p_nombre), '') is null then
    raise exception 'La clave necesita un nombre que la identifique';
  end if;

  -- 32 bytes de aleatoriedad real de pgcrypto (que vive en el schema
  -- `extensions`, hay que calificarlo con search_path vacío). El prefijo
  -- `cdy_` sirve para que un secreto filtrado sea reconocible de un vistazo,
  -- igual que hacen Stripe o GitHub con los suyos.
  v_clave := 'cdy_' || encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.tenant_api_keys (tenant_id, nombre, prefijo, hash_clave)
  values (
    v_tenant,
    trim(p_nombre),
    left(v_clave, 12),
    encode(extensions.digest(v_clave, 'sha256'), 'hex')
  );

  return v_clave;
end;
$$;

comment on function public.crear_api_key(text) is
  'Crea una clave de API para el propio tenant del admin que llama y devuelve su valor en claro UNA SOLA VEZ. Solo se persiste el hash.';

-- El revoke explícito no es opcional: Postgres deja EXECUTE abierto a PUBLIC
-- (y por herencia a anon) en toda función nueva. Pasarlo por alto es
-- exactamente lo que marcó get_advisors la primera vez que se aplicó la
-- migración de credenciales de Meta.
revoke all on function public.crear_api_key(text) from public, anon;
grant execute on function public.crear_api_key(text) to authenticated;

-- ---------------------------------------------------------------------------
-- revocar_api_key
-- ---------------------------------------------------------------------------
-- No borra la fila: la desactiva. Así el admin sigue viendo en la pantalla que
-- esa clave existió y cuándo se usó por última vez, que es justo lo que hace
-- falta para auditar una filtración.
create or replace function public.revocar_api_key(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'Solo un admin del tenant puede revocar claves de API';
  end if;

  update public.tenant_api_keys
  set activo = false
  where id = p_id and tenant_id = v_tenant;

  if not found then
    raise exception 'No existe esa clave en este tenant';
  end if;
end;
$$;

comment on function public.revocar_api_key(bigint) is
  'Desactiva (no borra) una clave de API del propio tenant del admin que llama.';

revoke all on function public.revocar_api_key(bigint) from public, anon;
grant execute on function public.revocar_api_key(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Límite de velocidad
-- ---------------------------------------------------------------------------
-- No existía NINGÚN rate limiting en el proyecto — ni en las Edge Functions ni
-- en la base. Se construye acá porque esta API es la puerta más expuesta que
-- tiene candyCRM: la llama código de terceros desde internet, a diferencia del
-- widget (clave pública pero tráfico de navegador) o de WhatsApp (solo Meta).
--
-- Ventana fija, no deslizante: una ventana deslizante exige guardar cada
-- petición y contar sobre un rango, que en el endpoint más caliente es
-- exactamente el volumen de escritura que no se quiere. La ventana fija cuesta
-- una fila por tenant por ventana.
create table if not exists api_rate_limits (
  tenant_id uuid not null references tenants (id),
  ventana_inicio timestamptz not null,
  contador integer not null default 0,
  primary key (tenant_id, ventana_inicio)
);

alter table api_rate_limits enable row level security;

-- Sin ninguna policy: nadie la lee ni la escribe salvo service_role, que las
-- saltea. No es dato de negocio del tenant, es contabilidad interna del
-- endpoint — misma lógica que webhook_errors siendo solo de plataforma.

comment on table api_rate_limits is
  'Contador de peticiones por tenant y ventana para el límite de velocidad de la API de ingesta. Contabilidad interna: ningún tenant la lee.';

-- Atómico a propósito: el `on conflict do update ... returning` resuelve el
-- incremento y la lectura en una sola sentencia, así que dos peticiones
-- simultáneas del mismo tenant no pueden leer el mismo contador y pisarse.
-- Un `select` seguido de un `update` sí tendría esa carrera.
create or replace function public.registrar_uso_api(
  p_tenant uuid,
  p_limite integer,
  p_ventana_segundos integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inicio timestamptz;
  v_contador integer;
begin
  -- Trunca el instante al inicio de su ventana: todas las peticiones de los
  -- mismos N segundos caen en la misma fila.
  v_inicio := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_ventana_segundos) * p_ventana_segundos
  );

  insert into public.api_rate_limits (tenant_id, ventana_inicio, contador)
  values (p_tenant, v_inicio, 1)
  on conflict (tenant_id, ventana_inicio)
    do update set contador = public.api_rate_limits.contador + 1
  returning contador into v_contador;

  -- Barrido oportunista de ventanas viejas, para que la tabla no crezca sin
  -- techo. Va acá y no en un cron porque el proyecto no tiene pg_cron: es
  -- barato (borra por PK sobre un rango ya indexado) y solo corre de vez en
  -- cuando, no en cada petición.
  if random() < 0.01 then
    delete from public.api_rate_limits
    where ventana_inicio < v_inicio - make_interval(secs => p_ventana_segundos * 10);
  end if;

  return v_contador <= p_limite;
end;
$$;

comment on function public.registrar_uso_api(uuid, integer, integer) is
  'Cuenta una petición del tenant en la ventana actual y devuelve si sigue dentro del límite. Atómico: el incremento y la lectura son una sola sentencia.';

revoke all on function public.registrar_uso_api(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.registrar_uso_api(uuid, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- resolver_contacto_api — identidad del lead que entra por la API
-- ---------------------------------------------------------------------------
-- No se reusa resolver_contacto_widget por dos razones concretas: su `p_sesion`
-- es de hecho obligatorio (en la rama de creación inserta un contact_channel
-- 'chat_web' con ese valor, y contact_channels.valor es NOT NULL, así que pasar
-- null revienta), y hardcodea origen='chat_web', que marcaría todo lead de API
-- como chat web.
--
-- Misma corrección de carrera que H3/H4: la identidad la arbitra el
-- `unique (tenant_id, tipo, valor)` de contact_channels, no un check-then-insert
-- desde el cliente. Dos peticiones simultáneas del mismo email no pueden dejar
-- un contacto huérfano sin canal.
create or replace function public.resolver_contacto_api(
  p_tenant uuid,
  p_external_id text default null,
  p_email text default null,
  p_telefono text default null,
  p_nombre text default null,
  p_empresa text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact bigint;
  v_owner uuid;
  v_email text := lower(nullif(trim(p_email), ''));
  v_telefono text := nullif(trim(p_telefono), '');
  v_external text := nullif(trim(p_external_id), '');
  v_nombre text := nullif(trim(p_nombre), '');
begin
  if v_email is null and v_telefono is null and v_external is null then
    raise exception 'Hace falta al menos email, teléfono o external_id para identificar el lead';
  end if;

  -- El email se normaliza a minúsculas porque la base NO lo hace: no hay
  -- lower() ni índice funcional sobre contact_channels.valor, así que sin esto
  -- "Juan@X.com" y "juan@x.com" serían dos contactos distintos.

  -- Prioridad de identidad: el id del propio sistema del tenant manda sobre
  -- todo, porque es el único identificador que ese sistema considera estable.
  if v_external is not null then
    select id into v_contact from public.contacts
    where tenant_id = p_tenant and external_id = v_external;
  end if;

  if v_contact is null and v_email is not null then
    select contact_id into v_contact from public.contact_channels
    where tenant_id = p_tenant and tipo = 'email' and valor = v_email;
  end if;

  if v_contact is null and v_telefono is not null then
    select contact_id into v_contact from public.contact_channels
    where tenant_id = p_tenant and tipo = 'telefono' and valor = v_telefono;
  end if;

  if v_contact is null then
    select user_id into v_owner from public.team_members
    where tenant_id = p_tenant and rol = 'owner' limit 1;

    if v_owner is null then
      raise exception 'El tenant % no tiene ningún miembro con rol owner', p_tenant;
    end if;

    insert into public.contacts (tenant_id, nombre, email, telefono, empresa, external_id, origen, owner_id)
    values (
      p_tenant,
      coalesce(v_nombre, v_email, v_telefono, 'Lead sin nombre'),
      v_email,
      v_telefono,
      nullif(trim(p_empresa), ''),
      v_external,
      'api',
      v_owner
    )
    returning id into v_contact;
  else
    -- Contacto ya conocido: se enriquece sin pisar. Un dato que ya está se
    -- respeta — el sistema del tenant no es necesariamente más confiable que
    -- lo que ya cargó un vendedor a mano.
    update public.contacts
    set nombre = case when nombre = 'Lead sin nombre' then coalesce(v_nombre, nombre) else nombre end,
        email = coalesce(email, v_email),
        telefono = coalesce(telefono, v_telefono),
        empresa = coalesce(empresa, nullif(trim(p_empresa), '')),
        external_id = coalesce(external_id, v_external)
    where id = v_contact and tenant_id = p_tenant;
  end if;

  -- Los canales se reclaman para el contacto resuelto, sea nuevo o viejo. El
  -- `do nothing` cubre el caso de que otra petición simultánea haya ganado la
  -- carrera: el unique arbitra y acá no hace falta reintentar.
  if v_email is not null then
    insert into public.contact_channels (tenant_id, contact_id, tipo, valor)
    values (p_tenant, v_contact, 'email', v_email)
    on conflict (tenant_id, tipo, valor) do nothing;
  end if;

  if v_telefono is not null then
    insert into public.contact_channels (tenant_id, contact_id, tipo, valor)
    values (p_tenant, v_contact, 'telefono', v_telefono)
    on conflict (tenant_id, tipo, valor) do nothing;
  end if;

  return v_contact;
end;
$$;

comment on function public.resolver_contacto_api(uuid, text, text, text, text, text) is
  'Resuelve (o crea) el contacto de un lead entrado por la API de ingesta. Identidad por external_id > email > teléfono. Normaliza el email a minúsculas. Solo service_role.';

-- Mismo candado que resolver_contacto_whatsapp / resolver_contacto_widget (H3):
-- la llama la Edge Function desde su lado servidor, nunca el navegador.
revoke all on function public.resolver_contacto_api(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.resolver_contacto_api(uuid, text, text, text, text, text) to service_role;
