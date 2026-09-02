-- Las dos funciones de H3/H4 tienen que ser alcanzables por `db.rpc()` desde la
-- Edge Function, y PostgREST solo enruta al schema `public`. Quedaron en `private`
-- por reflejo de la convención del proyecto, pero ahí son inalcanzables.
--
-- Se mueven a `public` con los permisos cerrados a mano. Esto NO contradice la
-- migración 20260825115754 (que movió las funciones internas a `private`): ahí
-- revocar EXECUTE no era opción porque las policies de RLS necesitaban poder
-- llamarlas como el usuario invocante. Estas dos las llama únicamente la ingesta
-- con service_role, así que revocar sí alcanza — y es indispensable: ambas reciben
-- `p_tenant` como parámetro y son SECURITY DEFINER, de modo que si quedaran
-- invocables por `authenticated`, cualquier usuario podría pasar el tenant de otro
-- y crearle contactos y conversaciones.

drop function if exists private.resolver_contacto_whatsapp(uuid, text, text);
drop function if exists private.resolver_conversacion_whatsapp(uuid, bigint);

create or replace function public.resolver_contacto_whatsapp(
  p_tenant uuid,
  p_telefono text,
  p_nombre text
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
  select contact_id into v_contact_id
  from public.contact_channels
  where tenant_id = p_tenant and tipo = 'whatsapp' and valor = p_telefono;
  if v_contact_id is not null then
    return v_contact_id;
  end if;

  select user_id into v_owner
  from public.team_members
  where tenant_id = p_tenant and rol = 'owner'
  limit 1;
  if v_owner is null then
    raise exception 'el tenant % no tiene ningún miembro con rol owner', p_tenant;
  end if;

  insert into public.contacts
    (tenant_id, nombre, telefono, origen, owner_id, opt_in_at, opt_in_source)
  values
    (p_tenant, coalesce(nullif(p_nombre, ''), p_telefono), p_telefono, 'whatsapp',
     v_owner, now(), 'whatsapp_inbound')
  returning id into v_contact_id;

  insert into public.contact_channels (tenant_id, contact_id, tipo, valor)
  values (p_tenant, v_contact_id, 'whatsapp', p_telefono)
  on conflict (tenant_id, tipo, valor) do nothing;

  select contact_id into v_ganador
  from public.contact_channels
  where tenant_id = p_tenant and tipo = 'whatsapp' and valor = p_telefono;

  if v_ganador <> v_contact_id then
    delete from public.contacts where id = v_contact_id and tenant_id = p_tenant;
    return v_ganador;
  end if;

  return v_contact_id;
end;
$$;

create or replace function public.resolver_conversacion_whatsapp(
  p_tenant uuid,
  p_contact bigint
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
    and canal = 'whatsapp' and estado = 'abierta';
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

  insert into public.conversations (tenant_id, contact_id, canal, estado, owner_id)
  values (p_tenant, p_contact, 'whatsapp', 'abierta', v_owner)
  on conflict (tenant_id, contact_id, canal) where estado = 'abierta' do nothing
  returning id into v_conv_id;

  if v_conv_id is null then
    select id into v_conv_id
    from public.conversations
    where tenant_id = p_tenant and contact_id = p_contact
      and canal = 'whatsapp' and estado = 'abierta';
  end if;

  return v_conv_id;
end;
$$;

-- Lo que hace segura la exposición: nadie salvo service_role puede invocarlas.
revoke all on function public.resolver_contacto_whatsapp(uuid, text, text) from public, anon, authenticated;
revoke all on function public.resolver_conversacion_whatsapp(uuid, bigint) from public, anon, authenticated;
grant execute on function public.resolver_contacto_whatsapp(uuid, text, text) to service_role;
grant execute on function public.resolver_conversacion_whatsapp(uuid, bigint) to service_role;

comment on function public.resolver_contacto_whatsapp(uuid, text, text) is
  'Resuelve o crea atómicamente el contacto de un número de WhatsApp (H3). En public porque PostgREST no enruta a private, pero con EXECUTE revocado a anon/authenticated: solo service_role.';
comment on function public.resolver_conversacion_whatsapp(uuid, bigint) is
  'Resuelve o abre atómicamente la conversación de WhatsApp de un contacto (H4). Mismos permisos acotados que la anterior.';
