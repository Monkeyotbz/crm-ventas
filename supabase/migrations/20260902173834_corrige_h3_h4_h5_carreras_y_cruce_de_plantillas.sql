-- Corrige tres hallazgos de la auditoría del 2 sept 2026 (docs/corregir-errores.md).
--
-- H3 y H4 son la misma clase de bug: check-then-insert sin transacción. Dos webhooks
-- concurrentes del mismo contacto leen "no existe", los dos insertan, y queda basura.
-- WhatsApp entrega mensajes en paralelo de forma rutinaria, así que no es teórico.
--
-- H5 es un cruce entre tenants real y explotable hoy desde la API.
--
-- NOTA: las dos funciones que crea esta migración se movieron a `public` en la
-- migración siguiente (20260902174357) porque PostgREST no enruta a `private` y la
-- Edge Function no podía llamarlas. Allá quedan con EXECUTE revocado a
-- anon/authenticated. Este archivo se conserva tal como se aplicó.

-- ---------------------------------------------------------------------------
-- H4 — el índice que faltaba: una sola conversación abierta por canal.
-- ---------------------------------------------------------------------------
-- Sin esto, dos conversaciones "abierta" del mismo contacto rompen la idempotencia
-- entera: la clave es unique (conversation_id, externo_id), así que el mismo wamid
-- reintentado por Meta contra la OTRA conversación no da 23505 y se guarda duplicado.
-- Verificado antes de aplicar: cero duplicados en los datos actuales.
create unique index if not exists uq_conversations_abierta_por_canal
  on conversations (tenant_id, contact_id, canal)
  where estado = 'abierta';

-- ---------------------------------------------------------------------------
-- H3 — resolución atómica del contacto por su canal de WhatsApp.
-- ---------------------------------------------------------------------------
-- El árbitro es contact_channels_tenant_id_tipo_valor_key: gana quien reclame el
-- canal primero. Si perdemos la carrera, borramos el contacto que alcanzamos a
-- crear en vez de dejarlo huérfano — un contacto sin canal es indeduplicable
-- después, porque la identidad la define el canal, no contacts.telefono.
create or replace function private.resolver_contacto_whatsapp(
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
  -- Camino feliz: el canal ya existe, no se escribe nada.
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

  -- Reclamo del canal. Si otra ejecución llegó primero, la suya queda.
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

comment on function private.resolver_contacto_whatsapp(uuid, text, text) is
  'Resuelve (o crea) el contacto de un número de WhatsApp de forma atómica. Corrige H3: el check-then-insert de la Edge Function dejaba contactos huérfanos bajo concurrencia.';

-- ---------------------------------------------------------------------------
-- H4 — resolución atómica de la conversación abierta.
-- ---------------------------------------------------------------------------
create or replace function private.resolver_conversacion_whatsapp(
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

  -- El índice parcial uq_conversations_abierta_por_canal arbitra la carrera.
  insert into public.conversations (tenant_id, contact_id, canal, estado, owner_id)
  values (p_tenant, p_contact, 'whatsapp', 'abierta', v_owner)
  on conflict (tenant_id, contact_id, canal) where estado = 'abierta' do nothing
  returning id into v_conv_id;

  -- Si perdimos la carrera, el insert no devolvió nada: leemos la ganadora.
  if v_conv_id is null then
    select id into v_conv_id
    from public.conversations
    where tenant_id = p_tenant and contact_id = p_contact
      and canal = 'whatsapp' and estado = 'abierta';
  end if;

  return v_conv_id;
end;
$$;

comment on function private.resolver_conversacion_whatsapp(uuid, bigint) is
  'Resuelve (o abre) la conversación de WhatsApp de un contacto de forma atómica. Corrige H4: dos conversaciones abiertas simultáneas rompían la idempotencia de messages.externo_id.';

-- ---------------------------------------------------------------------------
-- H5 — la plantilla tiene que ser del mismo tenant que la conversación.
-- ---------------------------------------------------------------------------
-- messages.template_id -> message_templates(id) es una FK simple, y no puede ser
-- compuesta porque messages no tiene tenant_id (lo hereda de conversations). Sin
-- esta validación, un usuario del tenant A podía insertar un mensaje apuntando a
-- una plantilla del tenant B — y de paso saltear la regla de la ventana de 24 h,
-- porque el trigger solo miraba que template_id no fuera nulo, nunca de quién era.
create or replace function private.validar_plantilla_para_iniciar()
returns trigger
language plpgsql
security definer
set search_path = 'private', 'public'
as $$
declare
  abierta_hasta timestamptz;
  tenant_conversacion uuid;
  tenant_plantilla uuid;
begin
  if new.direccion <> 'out' or new.canal <> 'whatsapp' then
    return new;
  end if;

  select c.tenant_id, c.ventana_abierta_hasta
    into tenant_conversacion, abierta_hasta
  from conversations c where c.id = new.conversation_id;

  if new.template_id is not null then
    select t.tenant_id into tenant_plantilla
    from message_templates t where t.id = new.template_id;

    if tenant_plantilla is null or tenant_plantilla is distinct from tenant_conversacion then
      raise exception
        'La plantilla % no pertenece al tenant de la conversación % — cruce entre tenants rechazado.',
        new.template_id, new.conversation_id;
    end if;

    return new;
  end if;

  if abierta_hasta is null or abierta_hasta <= now() then
    raise exception 'Fuera de la ventana de servicio de WhatsApp: un mensaje saliente sin ventana abierta requiere template_id (plantilla aprobada por Meta).';
  end if;

  return new;
end;
$$;
