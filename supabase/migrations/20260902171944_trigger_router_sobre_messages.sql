-- Dispara el Router (supabase/functions/router/) en cada mensaje entrante nuevo,
-- vía net.http_post. Reemplaza al Database Webhook del panel, que en este proyecto
-- falla con "schema supabase_functions does not exist" — esa pieza la provisiona
-- Supabase automáticamente en cada proyecto y en este faltó (ver migración anterior,
-- que habilitó pg_net; ese schema propietario sigue sin existir y no hay forma de
-- crearlo por SQL, así que se construye el equivalente directo con la extensión
-- comunitaria que sí está disponible).
--
-- El secret del header (x-router-secret) vive en Vault, nunca en este archivo —
-- mismo criterio que .env y los demás secrets del proyecto: nada de credenciales en
-- texto plano en algo que se commitea. Se sembró antes con:
--   select vault.create_secret('<valor>', 'router_secret', '...');

create or replace function private.disparar_router()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  -- Solo entrantes: un mensaje que nosotros mandamos no dispara clasificación.
  -- El Router también lo filtra, pero evitar el POST de entrada es más barato.
  if new.direccion <> 'in' then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'router_secret';

  if v_secret is null then
    -- No se rompe el insert del mensaje por un problema de configuración del
    -- trigger: se deja constancia y se sigue. El mensaje igual queda guardado.
    raise warning 'disparar_router: no se encontró el secret "router_secret" en Vault';
    return new;
  end if;

  perform net.http_post(
    url := 'https://jrygtluycndiyvrxjmib.supabase.co/functions/v1/router',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'schema', 'public',
      'record', to_jsonb(new)
    ),
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'x-router-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

comment on function private.disparar_router() is
  'Dispara supabase/functions/router/ vía net.http_post en cada insert de mensaje entrante. Reemplaza al Database Webhook del panel, que en este proyecto falla por un schema faltante (supabase_functions) que Supabase no provisionó.';

drop trigger if exists trg_disparar_router on messages;
create trigger trg_disparar_router
  after insert on messages
  for each row
  execute function private.disparar_router();
