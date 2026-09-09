-- Registro autoservicio: cada alta de usuario crea su propio espacio de
-- trabajo (tenant) y deja a esa persona como `owner`.
--
-- Es el "carril masivo" de venta descrito en CLAUDE.md llevado hasta el
-- final: alguien compra Candy CRM, se registra desde la pantalla de login, y
-- ya tiene un espacio funcional sin que nadie de Hellominus toque SQL. Mismo
-- criterio de autoservicio que crear_api_key (20260907120000) y
-- guardar_credenciales_meta (20260906000001).
--
-- Hasta hoy el alta era el proceso manual de tres pasos de supabase/README.md
-- (§3): crear el usuario, asignarle `app_metadata.tenant_id` con la
-- service_role key, e insertar su fila en team_members a mano. Servía para un
-- único tenant real; no escala a "el comprador se conecta solo".
--
-- ---------------------------------------------------------------------------
-- Por qué un trigger sobre auth.users y no una función RPC que llame el front
-- ---------------------------------------------------------------------------
-- El front no puede escribir `app_metadata` — es justamente el campo que el
-- usuario NO controla (a diferencia de user_metadata), y de eso depende todo
-- el aislamiento por RLS: private.current_tenant_id() lo lee del JWT. Solo
-- algo que corra del lado servidor con permisos sobre el schema `auth` puede
-- setearlo. Un trigger `security definer` sobre el INSERT de auth.users es ese
-- lado servidor, y se dispara pase lo que pase por el camino de registro
-- (signUp del SDK, alta desde el panel, etc.) sin un paso extra que el front
-- se pueda olvidar de invocar.

-- ---------------------------------------------------------------------------
-- private.aprovisionar_espacio — el trabajo, para UN usuario
-- ---------------------------------------------------------------------------
-- La lógica va en una función parametrizada por user_id (no directamente en el
-- trigger) para que la pueda reusar el backfill del final: los usuarios que se
-- registraron ANTES de aplicar esta migración quedaron sin espacio, y hay que
-- repararlos con exactamente el mismo procedimiento.
create or replace function private.aprovisionar_espacio(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario  auth.users;
  v_nombre   text;
  v_slug     text;
  v_tenant   uuid;
  v_pipeline bigint;
begin
  select * into v_usuario from auth.users where id = p_user;
  if v_usuario.id is null then
    raise exception 'no existe el usuario %', p_user;
  end if;

  -- Guarda: si ya tiene tenant asignado, no se toca. Cubre el alta
  -- pre-provisionada (el primer usuario de README §3, o un futuro flujo de
  -- invitación a un equipo existente) y hace la función idempotente.
  if v_usuario.raw_app_meta_data ? 'tenant_id' then
    return (v_usuario.raw_app_meta_data ->> 'tenant_id')::uuid;
  end if;

  -- Recuperación de una corrida a medias: si ya existe la fila de team_members
  -- (se creó, pero el proceso murió antes de escribir app_metadata), se reusa
  -- su tenant en vez de crear uno nuevo y dejar el primero huérfano.
  select tenant_id into v_tenant
  from public.team_members
  where user_id = p_user
  limit 1;

  if v_tenant is null then
    -- Nombre del espacio: lo manda el formulario de registro en options.data
    -- (signUp → raw_user_meta_data). Si no vino, se cae a la parte local del
    -- correo, y si eso tampoco, a un genérico — nunca se aborta por esto.
    v_nombre := coalesce(
      nullif(trim(v_usuario.raw_user_meta_data ->> 'nombre_espacio'), ''),
      nullif(split_part(v_usuario.email, '@', 1), ''),
      'Mi espacio'
    );

    -- Slug: derivado del nombre + 8 hex de entropía. El sufijo elimina la
    -- necesidad de un bucle de reintento contra el `unique (slug)` — el slug no
    -- se muestra en ninguna pantalla, es solo una clave, así que una cola
    -- aleatoria no molesta a nadie y hace la colisión irrelevante.
    v_slug := left(regexp_replace(lower(v_nombre), '[^a-z0-9]+', '-', 'g'), 40);
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then
      v_slug := 'espacio';
    end if;
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 8);

    insert into public.tenants (nombre, slug)
    values (v_nombre, v_slug)
    returning id into v_tenant;

    -- Quien crea el espacio queda como responsable.
    insert into public.team_members (user_id, tenant_id, rol)
    values (p_user, v_tenant, 'owner')
    on conflict (user_id) do nothing;
  end if;

  -- Pipeline. `pipeline_stages.pipeline_id` es NOT NULL (lo agregó
  -- doc48_p1_pipelines_y_productos: las etapas cuelgan de un pipeline, no
  -- sueltas del tenant), así que hay que crear el pipeline ANTES que las
  -- etapas. Buscar-o-crear: si el tenant ya tiene alguno (corrida a medias),
  -- se reusa el primero.
  select id into v_pipeline
  from public.pipelines
  where tenant_id = v_tenant
  order by id
  limit 1;

  if v_pipeline is null then
    -- Mismo pipeline por defecto que doc48_p1 le dio al tenant Hellominus:
    -- 'Ventas', tipo consultivo. No se siembran los pipelines A/C ni
    -- routing_rules — son decisiones de negocio por tenant, no un default.
    insert into public.pipelines (tenant_id, nombre, tipo, orden)
    values (v_tenant, 'Ventas', 'consultivo', 1)
    returning id into v_pipeline;
  end if;

  -- Etapas del pipeline. Hacen falta sí o sí: deals tiene FK a pipeline_stages,
  -- así que sin etapas el Router no puede crear oportunidades. Las mismas 7 que
  -- usa Hellominus — genéricas; el owner las reordena o renombra después.
  --
  -- Se siembra solo si el pipeline no tiene NINGUNA etapa (no con ON CONFLICT):
  -- el unique de pipeline_stages es (tenant_id, pipeline_id, nombre) y hay
  -- nombres repetidos entre pipelines en la base real, así que un ON CONFLICT
  -- es frágil. El chequeo por existencia también hace idempotente el backfill.
  if not exists (select 1 from public.pipeline_stages where pipeline_id = v_pipeline) then
    insert into public.pipeline_stages (tenant_id, pipeline_id, nombre, orden, color)
    values
      (v_tenant, v_pipeline, 'Nuevo', 1, '#22d3ee'),
      (v_tenant, v_pipeline, 'Contactado', 2, '#22d3ee'),
      (v_tenant, v_pipeline, 'Calificado', 3, '#a78bfa'),
      (v_tenant, v_pipeline, 'Propuesta', 4, '#a78bfa'),
      (v_tenant, v_pipeline, 'Negociación', 5, '#a78bfa'),
      (v_tenant, v_pipeline, 'Ganado', 6, '#34d399'),
      (v_tenant, v_pipeline, 'Perdido', 7, '#64748b');
  end if;

  -- `sectors` NO se siembra a propósito: contacts.sector_id es nullable (el
  -- README lo confirma — un slug que no existe deja el campo en null, no
  -- rompe), y no hay un juego de sectores genérico que tenga sentido para un
  -- rubro cualquiera. El owner define los suyos, igual que dice el comentario
  -- del seed de Hellominus ("Otro tenant siembra los suyos").

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tenant_id', v_tenant::text)
  where id = p_user;

  return v_tenant;
end;
$$;

comment on function private.aprovisionar_espacio(uuid) is
  'Crea el espacio (tenant + owner + pipeline) de un usuario y le escribe tenant_id en app_metadata. Idempotente: si ya tiene tenant, no hace nada. La usan el trigger de alta y el backfill de esta misma migración.';

-- Nunca callable desde afuera: la ejecuta el trigger (contexto de GoTrue) y el
-- backfill de abajo (contexto de la migración), los dos ya con permisos de
-- sobra. Mismo candado que las funciones internas de las otras migraciones.
revoke all on function private.aprovisionar_espacio(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.handle_new_user — el trigger
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (new.raw_app_meta_data ? 'tenant_id') then
    perform private.aprovisionar_espacio(new.id);
  end if;
  return new;
end;
$$;

comment on function private.handle_new_user() is
  'Trigger de alta: por cada auth.users nuevo sin tenant_id previo, delega en private.aprovisionar_espacio. Registro autoservicio del carril masivo (CLAUDE.md).';

-- El trigger vive en el schema `auth` porque es sobre auth.users. Es el mismo
-- patrón que usa el propio Supabase para sus hooks de usuario.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Backfill único: usuarios que se registraron antes de esta migración
-- ---------------------------------------------------------------------------
-- El trigger solo dispara en INSERT, así que quien ya se dio de alta por el
-- formulario de registro nuevo (tiene `nombre_espacio` en user_metadata) pero
-- todavía no tiene tenant, quedó sin espacio y sin poder entrar. Se repara acá,
-- una sola vez, con la misma función.
--
-- El filtro por `nombre_espacio` es a propósito: NO se toca a un usuario
-- tenant-less que no haya pasado por ese formulario (podría ser un alta a
-- medio configurar hecha a mano desde el panel).
do $$
declare
  r record;
begin
  for r in
    select id
    from auth.users
    where not (coalesce(raw_app_meta_data, '{}'::jsonb) ? 'tenant_id')
      and nullif(trim(raw_user_meta_data ->> 'nombre_espacio'), '') is not null
  loop
    perform private.aprovisionar_espacio(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notas / límites conocidos
-- ---------------------------------------------------------------------------
-- - El token que devuelve signUp cuando la confirmación de correo está
--   DESACTIVADA se emite antes de que este trigger escriba app_metadata, así
--   que no trae el claim todavía. El front lo resuelve pidiendo un token nuevo
--   (src/pages/PreparandoEspacio.jsx). Con la confirmación activada no pasa: el
--   token que cuenta es el del click de confirmación, ya posterior al trigger.
-- - Un admin de plataforma (platform_admins) que se registre por este camino
--   también recibe un tenant personal. Es inofensivo — sus permisos de
--   plataforma son una tabla aparte — pero si molesta, la guarda ya contempla
--   pre-asignarle un tenant en el alta para que el trigger lo saltee.
-- - Cuando exista un flujo de invitación a un equipo, ese alta tiene que
--   crear el usuario con raw_app_meta_data.tenant_id ya puesto, para caer en
--   la guarda y no generar un espacio nuevo.
