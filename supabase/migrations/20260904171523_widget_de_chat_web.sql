-- Widget de chat embebible (candidato del Sprint 2 del README, "chat web de
-- hellominus.com"). Reusa el canal `chat_web` que el domain `canal_type` ya
-- traía sembrado desde la primera migración, sin usar hasta ahora.
--
-- Decisión de arquitectura (3 sept 2026): entra DIRECTO a una Edge Function,
-- igual que WhatsApp — no por n8n. n8n hoy no existe (ni cuenta ni flujos), y
-- meterlo en el camino crítico de este widget significaría construir esa
-- pieza antes de tener nada funcionando. Ver docs/DECISIONES.md.
--
-- Decisión de identidad: un visitante "registrado" es simplemente alguien
-- que en algún momento del chat escribió su email o teléfono — no depende de
-- ningún login de hellominus.com. Arranca anónimo (identificado solo por una
-- `sesion_anonima` que genera el propio widget en el navegador) y se
-- enriquece cuando se identifica, reusando el mismo patrón de
-- `contact_channels` que ya resuelve la identidad de WhatsApp.

-- ---------------------------------------------------------------------------
-- contact_channels: dos tipos nuevos.
-- ---------------------------------------------------------------------------
-- `chat_web` es la sesión anónima del navegador (cookie/localStorage) — el
-- mismo campo que contact_touchpoints.sesion_anonima ya documentaba como "el
-- puente entre los toques previos y el contacto identificado", pero nunca se
-- había cableado un canal real que lo usara. `telefono` es un teléfono que NO
-- implica WhatsApp (alguien lo tipea en un chat web, no se le puede mandar un
-- mensaje de WhatsApp solo por eso) — separarlo de `whatsapp` importa porque
-- ese tipo sí dispara flujos de mensajería real más adelante.
alter table contact_channels drop constraint if exists contact_channels_tipo_check;
alter table contact_channels add constraint contact_channels_tipo_check
  check (tipo in ('whatsapp', 'instagram', 'messenger', 'linkedin', 'email', 'chat_web', 'telefono'));

-- ---------------------------------------------------------------------------
-- chat_widget_keys — el equivalente de whatsapp_numbers para este canal.
-- ---------------------------------------------------------------------------
-- La clave pública NO es un secreto: viaja en el HTML/JS que cualquiera puede
-- ver con "Inspeccionar elemento" en la página donde se embeba el widget.
-- Cumple el mismo rol que una publishable key de Stripe: identifica al
-- tenant, no autoriza nada por sí sola. Por eso la política de abajo la deja
-- leer a cualquier miembro del tenant (no hay nada que esconder puertas
-- adentro que no esté ya expuesto puertas afuera).
--
-- Un tenant, una clave por ahora (unique en tenant_id). Si más adelante hace
-- falta más de un sitio con su propia clave por tenant, se relaja acá.
create table if not exists chat_widget_keys (
  id bigint generated always as identity primary key,
  tenant_id uuid not null unique references tenants (id),
  public_key text not null unique,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table chat_widget_keys enable row level security;

create policy "chat_widget_keys: lectura del propio tenant" on chat_widget_keys
  for select using (tenant_id = private.current_tenant_id());

-- Sin policy de escritura a propósito: alta y rotación de la clave son
-- infrecuentes y de alto impacto (cambiarla rompe el widget ya embebido en
-- el sitio del cliente hasta que se actualice el snippet) — quedan por SQL
-- directo con service_role, igual que el alta/baja de platform_admins.

insert into chat_widget_keys (tenant_id, public_key)
select id, 'wgt_' || replace(gen_random_uuid()::text, '-', '')
from tenants
where slug = 'hellominus'
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- resolver_contacto_widget — identidad del visitante del chat web.
-- ---------------------------------------------------------------------------
-- Mismo espíritu que resolver_contacto_whatsapp (H3): check-then-insert
-- desde la Edge Function dejaría el mismo tipo de contacto huérfano bajo
-- carrera, así que se resuelve acá con el unique de contact_channels como
-- árbitro. La diferencia es que acá puede haber HASTA TRES identificadores
-- en juego (sesión, email, teléfono) en vez de uno solo.
--
-- Regla de prioridad, deliberada y simple — nunca se hace merge automático
-- de contactos:
--   1. Si ya existe un contacto para ese email o ese teléfono, es ese.
--   2. Si no, el que ya tenga esta sesión anónima.
--   3. Si no existe ninguno de los tres, se crea uno nuevo.
-- Una vez resuelto el contacto de la sesión, un email/teléfono que ya
-- pertenece a UN CONTACTO DISTINTO no se reclama ni se mezcla: se ignora esa
-- reclamación puntual y la conversación sigue con el contacto de la sesión.
-- Fusionar el historial de dos contactos es una operación que puede perder
-- datos si se hace mal, y no es la que hace falta para que el widget
-- funcione — queda documentado como limitación conocida, no resuelto a
-- medias con una migración apurada.
create or replace function public.resolver_contacto_widget(
  p_tenant uuid,
  p_sesion text,
  p_email text default null,
  p_telefono text default null,
  p_nombre text default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id bigint;
  v_ganador bigint;
  v_owner uuid;
begin
  if p_email is not null then
    select contact_id into v_contact_id
    from public.contact_channels
    where tenant_id = p_tenant and tipo = 'email' and valor = p_email;
  end if;

  if v_contact_id is null and p_telefono is not null then
    select contact_id into v_contact_id
    from public.contact_channels
    where tenant_id = p_tenant and tipo = 'telefono' and valor = p_telefono;
  end if;

  if v_contact_id is null then
    select contact_id into v_contact_id
    from public.contact_channels
    where tenant_id = p_tenant and tipo = 'chat_web' and valor = p_sesion;
  end if;

  if v_contact_id is null then
    select user_id into v_owner
    from public.team_members
    where tenant_id = p_tenant and rol = 'owner'
    limit 1;
    if v_owner is null then
      raise exception 'el tenant % no tiene ningún miembro con rol owner', p_tenant;
    end if;

    insert into public.contacts (tenant_id, nombre, email, telefono, origen, owner_id)
    values (
      p_tenant,
      coalesce(nullif(p_nombre, ''), 'Visitante web'),
      p_email, p_telefono, 'chat_web', v_owner
    )
    returning id into v_contact_id;

    -- Reclamo de la sesión. Si perdimos la carrera contra otra petición
    -- concurrente de la misma sesión nueva, el contacto recién creado queda
    -- huérfano (cero canales) — se borra, igual que en resolver_contacto_whatsapp.
    insert into public.contact_channels (tenant_id, contact_id, tipo, valor)
    values (p_tenant, v_contact_id, 'chat_web', p_sesion)
    on conflict (tenant_id, tipo, valor) do nothing;

    select contact_id into v_ganador
    from public.contact_channels
    where tenant_id = p_tenant and tipo = 'chat_web' and valor = p_sesion;

    if v_ganador <> v_contact_id then
      delete from public.contacts where id = v_contact_id and tenant_id = p_tenant;
      v_contact_id := v_ganador;
    end if;
  end if;

  -- Enriquecimiento: reclamar email/teléfono para el contacto ya resuelto,
  -- SIN pisar a otro contacto que ya los tenga (ver la regla de prioridad
  -- de arriba en el comentario de la función).
  if p_email is not null then
    insert into public.contact_channels (tenant_id, contact_id, tipo, valor)
    values (p_tenant, v_contact_id, 'email', p_email)
    on conflict (tenant_id, tipo, valor) do nothing;

    update public.contacts set email = p_email
    where id = v_contact_id and tenant_id = p_tenant and email is null;
  end if;

  if p_telefono is not null then
    insert into public.contact_channels (tenant_id, contact_id, tipo, valor)
    values (p_tenant, v_contact_id, 'telefono', p_telefono)
    on conflict (tenant_id, tipo, valor) do nothing;

    update public.contacts set telefono = p_telefono
    where id = v_contact_id and tenant_id = p_tenant and telefono is null;
  end if;

  return v_contact_id;
end;
$$;

revoke all on function public.resolver_contacto_widget(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.resolver_contacto_widget(uuid, text, text, text, text) to service_role;

comment on function public.resolver_contacto_widget(uuid, text, text, text, text) is
  'Resuelve o crea atómicamente el contacto de un visitante del widget de chat web. Prioridad email/teléfono > sesión anónima; nunca hace merge entre contactos distintos, ver comentario en la migración 20260904171523.';

-- ---------------------------------------------------------------------------
-- resolver_conversacion_canal — igual que resolver_conversacion_whatsapp,
-- pero parametrizada por canal en vez de hardcodear 'whatsapp'.
-- ---------------------------------------------------------------------------
-- No se tocó resolver_conversacion_whatsapp (no se edita una función que ya
-- está en producción sirviendo al Router sin necesidad); esta es nueva y
-- sirve tanto al widget como a cualquier canal futuro que entre por el mismo
-- patrón de "resolver o abrir la conversación abierta de este contacto".
create or replace function public.resolver_conversacion_canal(
  p_tenant uuid,
  p_contact bigint,
  p_canal canal_type
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_id bigint;
  v_owner uuid;
begin
  select id into v_conv_id
  from public.conversations
  where tenant_id = p_tenant and contact_id = p_contact
    and canal = p_canal and estado = 'abierta';
  if v_conv_id is not null then
    return v_conv_id;
  end if;

  select user_id into v_owner
  from public.team_members
  where tenant_id = p_tenant and rol = 'owner'
  limit 1;
  if v_owner is null then
    raise exception 'el tenant % no tiene ningún miembro con rol owner', p_tenant;
  end if;

  -- Mismo árbitro que resolver_conversacion_whatsapp: el índice parcial
  -- uq_conversations_abierta_por_canal ya es agnóstico de canal (canal es
  -- parte de la clave), así que no hace falta tocarlo.
  insert into public.conversations (tenant_id, contact_id, canal, estado, owner_id)
  values (p_tenant, p_contact, p_canal, 'abierta', v_owner)
  on conflict (tenant_id, contact_id, canal) where estado = 'abierta' do nothing
  returning id into v_conv_id;

  if v_conv_id is null then
    select id into v_conv_id
    from public.conversations
    where tenant_id = p_tenant and contact_id = p_contact
      and canal = p_canal and estado = 'abierta';
  end if;

  return v_conv_id;
end;
$$;

revoke all on function public.resolver_conversacion_canal(uuid, bigint, canal_type) from public, anon, authenticated;
grant execute on function public.resolver_conversacion_canal(uuid, bigint, canal_type) to service_role;

comment on function public.resolver_conversacion_canal(uuid, bigint, canal_type) is
  'Igual que resolver_conversacion_whatsapp pero parametrizada por canal. La usa el widget de chat web y cualquier canal nuevo que siga el mismo patrón.';
