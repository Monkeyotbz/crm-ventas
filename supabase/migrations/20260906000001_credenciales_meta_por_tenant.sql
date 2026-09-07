-- Candidato [9a] de docs/DECISIONES.md, ACEPTADO el 6 sept 2026: cada tenant
-- registra su propia app de Meta, completa e independiente — no comparten
-- nada entre sí. Hasta hoy, ingesta-whatsapp y envio-whatsapp leían un solo
-- juego de credenciales globales (WA_VERIFY_TOKEN, META_APP_SECRET,
-- WHATSAPP_ACCESS_TOKEN) — funcionaba porque había un solo tenant real.
--
-- Los secretos NUNCA van en una columna en texto plano — mismo criterio que
-- ROUTER_SECRET (20260902171944_trigger_router_sobre_messages.sql): Vault.
--
-- Se guarda el UUID que devuelve vault.create_secret(), no se reconstruye
-- por nombre: vault.secrets.name no tiene ninguna restricción de unicidad
-- (se verificó contra la base antes de escribir esto), así que buscar por
-- nombre sería ambiguo el día que algo se cargue dos veces. Guardar el id
-- exacto elimina esa ambigüedad de raíz.
create table if not exists tenant_meta_credentials (
  tenant_id uuid primary key references tenants (id),
  meta_app_id text not null,
  vault_app_secret_id uuid not null,
  vault_verify_token_id uuid not null,
  vault_access_token_id uuid not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tenant_meta_credentials enable row level security;

-- Solo lectura para el admin del propio tenant — y ni siquiera la escritura
-- pasa por REST directo: ver la función de abajo. Guardar esta fila sin
-- guardar también los tres secretos en Vault dejaría el sistema a medias.
create policy "tenant_meta_credentials: lectura del admin del propio tenant" on tenant_meta_credentials
  for select using (tenant_id = private.current_tenant_id() and private.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- guardar_credenciales_meta — autoservicio: el admin de un tenant carga (o
-- rota) sus propias credenciales de Meta Y su número de WhatsApp en un solo
-- paso atómico.
-- ---------------------------------------------------------------------------
-- Segura porque SIEMPRE actúa sobre private.current_tenant_id() — nunca un
-- tenant_id que mande el cliente. Un admin no puede tocar la configuración
-- de otro tenant ni por error de programación del frontend.
--
-- También hace el upsert de `whatsapp_numbers`, en vez de dejar que el
-- frontend escriba esa tabla directo: su policy de escritura
-- ("whatsapp_numbers: escritura de plataforma", doc48_p4_rls_tablas_nuevas)
-- es solo para `is_platform_admin()` — conectar un número era, hasta [9a],
-- una operación exclusiva de Hellominus operando el SaaS. No se toca esa
-- policy (sigue sirviendo para el soporte de plataforma); en cambio, el
-- autoservicio de un tenant sobre SU PROPIO número pasa por esta función
-- `security definer`, ya con el candado de `is_admin` + `current_tenant_id()`.
create or replace function public.guardar_credenciales_meta(
  p_meta_app_id text,
  p_app_secret text,
  p_verify_token text,
  p_access_token text,
  p_phone_number_id text,
  p_waba_id text,
  p_numero_display text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_existente public.tenant_meta_credentials;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'Solo un admin del tenant puede configurar Meta';
  end if;

  select * into v_existente from public.tenant_meta_credentials where tenant_id = v_tenant;

  if v_existente.tenant_id is not null then
    -- Vacío/null = "no cambiar este secreto" — el frontend lo deja en
    -- blanco a propósito para no pedirle a nadie que retipee TODO solo para
    -- rotar el número de WhatsApp, por ejemplo. Sin este chequeo, un submit
    -- con el campo vacío pisaría el secreto real con una cadena vacía.
    if nullif(p_app_secret, '') is not null then
      perform vault.update_secret(v_existente.vault_app_secret_id, p_app_secret);
    end if;
    if nullif(p_verify_token, '') is not null then
      perform vault.update_secret(v_existente.vault_verify_token_id, p_verify_token);
    end if;
    if nullif(p_access_token, '') is not null then
      perform vault.update_secret(v_existente.vault_access_token_id, p_access_token);
    end if;

    update public.tenant_meta_credentials
    set meta_app_id = p_meta_app_id, activo = true, updated_at = now()
    where tenant_id = v_tenant;
  else
    if p_app_secret is null or p_app_secret = '' or p_verify_token is null or p_verify_token = ''
       or p_access_token is null or p_access_token = '' then
      raise exception 'Hacen falta los tres secretos (App Secret, Verify Token, token de acceso) la primera vez';
    end if;

    insert into public.tenant_meta_credentials
      (tenant_id, meta_app_id, vault_app_secret_id, vault_verify_token_id, vault_access_token_id)
    values (
      v_tenant,
      p_meta_app_id,
      vault.create_secret(p_app_secret, 'meta_app_secret_' || v_tenant::text),
      vault.create_secret(p_verify_token, 'meta_verify_token_' || v_tenant::text),
      vault.create_secret(p_access_token, 'meta_access_token_' || v_tenant::text)
    );
  end if;

  -- Un tenant, un número por ahora (mismo alcance que el resto de [9a] — no
  -- se generaliza a "varios números por tenant" sin que haga falta todavía).
  insert into public.whatsapp_numbers (tenant_id, phone_number_id, waba_id, numero_display, activo)
  values (v_tenant, p_phone_number_id, p_waba_id, p_numero_display, true)
  on conflict (phone_number_id) do update
    set waba_id = excluded.waba_id, numero_display = excluded.numero_display, activo = true;
end;
$$;

comment on function public.guardar_credenciales_meta(text, text, text, text, text, text, text) is
  'Autoservicio de configuración de Meta + WhatsApp por tenant (candidato [9a]). Solo actúa sobre el propio tenant del admin que llama — nunca recibe un tenant_id por parámetro. También hace upsert de whatsapp_numbers, saltando su policy de plataforma a propósito.';

-- Cualquier admin autenticado puede llamarla — la seguridad la da
-- current_tenant_id(), no el permiso de ejecución. El revoke explícito es
-- necesario: Postgres deja EXECUTE abierto a PUBLIC (y por herencia, a
-- anon) por default en toda función nueva si no se lo saca a mano — pasar
-- por alto esto es exactamente lo que marcó get_advisors la primera vez que
-- se aplicó esta migración.
revoke all on function public.guardar_credenciales_meta(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.guardar_credenciales_meta(text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- obtener_secreto_meta_tenant — la única función que puede devolver un
-- secreto de Meta en texto plano. Candado igual al de resolver_contacto_whatsapp
-- (H3): revocado a todo salvo service_role. La llaman ingesta-whatsapp y
-- envio-whatsapp desde su propio lado servidor, nunca el navegador.
-- ---------------------------------------------------------------------------
create or replace function public.obtener_secreto_meta_tenant(p_tenant uuid, p_tipo text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_valor text;
begin
  select case p_tipo
    when 'app_secret' then vault_app_secret_id
    when 'verify_token' then vault_verify_token_id
    when 'access_token' then vault_access_token_id
    else null
  end
  into v_id
  from public.tenant_meta_credentials
  where tenant_id = p_tenant and activo = true;

  if v_id is null then
    return null;
  end if;

  select decrypted_secret into v_valor from vault.decrypted_secrets where id = v_id;
  return v_valor;
end;
$$;

comment on function public.obtener_secreto_meta_tenant(uuid, text) is
  'Devuelve un secreto de Meta (app_secret/verify_token/access_token) de un tenant en texto plano. Solo service_role — nunca callable desde el navegador. p_tipo: app_secret | verify_token | access_token.';

revoke all on function public.obtener_secreto_meta_tenant(uuid, text) from public, anon, authenticated;
grant execute on function public.obtener_secreto_meta_tenant(uuid, text) to service_role;
