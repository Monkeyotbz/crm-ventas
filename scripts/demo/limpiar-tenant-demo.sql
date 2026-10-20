-- Borra el tenant de PRUEBA 'demo-pruebas' y todo lo que cuelga de él.
-- Documento y motivo: docs/pruebas-en-produccion-que-se-deben-eliminar.md
--
-- Seguridad: el slug está escrito a mano abajo y no es un parámetro. Este script NO puede
-- tocar 'hellominus' ni ningún tenant de cliente. Es idempotente: si el tenant no existe,
-- solo lo avisa.
--
-- Cómo borra: recorre las tablas que tienen tenant_id y borra las filas del tenant; si una
-- tabla falla por una clave foránea (otra tabla todavía depende de ella), la reintenta en
-- la pasada siguiente. Así no hace falta mantener un orden de dependencias a mano, que se
-- desactualizaría con cada migración nueva. `messages` y `conversation_insights` no tienen
-- tenant_id: se van en cascada al borrar `conversations`.
--
-- NO borra el usuario de prueba de Auth: eso se hace a mano en
-- Authentication → Users (este script solo le quita el tenant).

do $limpiar$
declare
  v_slug constant text := 'demo-pruebas';
  v_tenant uuid;
  v_tabla text;
  v_pasada int := 0;
  v_pendientes text[];
  v_hubo_error boolean;
  v_borradas bigint;
  v_total bigint := 0;
begin
  select id into v_tenant from public.tenants where slug = v_slug;
  if v_tenant is null then
    raise notice 'No existe el tenant "%": no hay nada que borrar.', v_slug;
    return;
  end if;

  -- Los usuarios de prueba pierden el tenant, para que no queden apuntando a uno inexistente.
  update auth.users
     set raw_app_meta_data = raw_app_meta_data - 'tenant_id'
   where raw_app_meta_data ->> 'tenant_id' = v_tenant::text;

  select array_agg(table_name order by table_name) into v_pendientes
    from information_schema.columns
   where table_schema = 'public' and column_name = 'tenant_id' and table_name <> 'tenants'
     and table_name in (select table_name from information_schema.tables
                         where table_schema = 'public' and table_type = 'BASE TABLE');

  while coalesce(array_length(v_pendientes, 1), 0) > 0 and v_pasada < 12 loop
    v_pasada := v_pasada + 1;
    v_hubo_error := false;
    for v_tabla in select unnest(v_pendientes) loop
      begin
        execute format('delete from public.%I where tenant_id = $1', v_tabla) using v_tenant;
        get diagnostics v_borradas = row_count;
        v_total := v_total + v_borradas;
        v_pendientes := array_remove(v_pendientes, v_tabla);
      exception when others then
        -- Casi siempre es una FK: otra tabla del mismo tenant aún apunta a esta. Se reintenta.
        v_hubo_error := true;
      end;
    end loop;
    exit when not v_hubo_error;
  end loop;

  if coalesce(array_length(v_pendientes, 1), 0) > 0 then
    raise exception 'No se pudo vaciar: %. Revisar a mano antes de seguir (nada del tenant se borró en esta transacción).', v_pendientes;
  end if;

  delete from public.tenants where id = v_tenant;
  raise notice 'Listo: borrado el tenant "%" y % filas en % pasadas.', v_slug, v_total, v_pasada;
end
$limpiar$;
