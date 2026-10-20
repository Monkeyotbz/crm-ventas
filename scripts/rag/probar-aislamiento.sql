-- Prueba de AISLAMIENTO entre tenants del RAG (paso 6 del traspaso, candidato [10]).
-- Resultado documentado abajo; correr de nuevo cada vez que cambie la RLS de kb_chunks o match_kb_chunks.
--
-- Cómo funciona: la RLS de kb_chunks decide con private.current_tenant_id(), que lee
-- auth.jwt() -> app_metadata -> tenant_id, y auth.jwt() lee la variable de sesión
-- request.jwt.claims. Es el MISMO mecanismo que usa PostgREST con el token de un usuario real:
-- acá se simula poniendo esa variable a mano con `set local role` y `set_config`.
-- Es solo LECTURA (salvo el intento de escritura del caso E, que debe fallar) y cada bloque se
-- corre por separado en el SQL Editor, porque `set local` dura solo lo que dura la transacción.
--
-- Límite honesto: esto prueba la política y la función, no el viaje HTTP completo con un login
-- real. Para eso falta una prueba con la contraseña de dos usuarios de empresas distintas.
--
-- Ids usados el 20 oct 2026 (cambiarlos si se corre con otros):
--   usuario demo        436be542-4cd9-4945-b6f4-266453382583   tenant demo-pruebas  ecc25240-84ef-49f1-ac67-6eb88bf1f855
--   usuario hellominus  49a24f7c-6cee-4ddc-afc5-a7d602a89785   tenant hellominus    1381dbb7-fe71-42be-b989-13820d0343dd

-- ============================================================================================
-- A · Usuario del tenant DEMO (32 fragmentos): ve los suyos y solo los suyos.
--     ESPERADO: filas_visibles = 32, tenants_distintos_visibles = 1, match devuelve 6 de 6 pedidos.
--     RESULTADO 20 oct 2026: 32 · 1 · 6   → CUMPLE
-- ============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"436be542-4cd9-4945-b6f4-266453382583","role":"authenticated","app_metadata":{"tenant_id":"ecc25240-84ef-49f1-ac67-6eb88bf1f855"}}', true);
select (select count(*) from kb_chunks) as filas_visibles,
       (select count(distinct tenant_id) from kb_chunks) as tenants_distintos_visibles,
       (select count(*) from match_kb_chunks(array_fill(0.01::real, array[1024])::extensions.vector, 6, -1.0)) as match_devuelve_de_6_pedidos;

-- ============================================================================================
-- B · Usuario de OTRA empresa (Hellominus): no ve nada del demo, ni directo ni por la función.
--     ESPERADO: 0 · 0 · 0
--     RESULTADO 20 oct 2026: 0 · 0 · 0   → CUMPLE
-- ============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"49a24f7c-6cee-4ddc-afc5-a7d602a89785","role":"authenticated","app_metadata":{"tenant_id":"1381dbb7-fe71-42be-b989-13820d0343dd"}}', true);
select (select count(*) from kb_chunks) as filas_visibles,
       (select count(*) from kb_chunks where tenant_id = 'ecc25240-84ef-49f1-ac67-6eb88bf1f855') as filas_del_demo_que_logra_ver,
       (select count(*) from match_kb_chunks(array_fill(0.01::real, array[1024])::extensions.vector, 6, -1.0)) as match_devuelve;

-- ============================================================================================
-- C · Logueado pero SIN tenant en el token: no ve nada.
--     ESPERADO: 0 · 0     RESULTADO 20 oct 2026: 0 · 0   → CUMPLE
-- ============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}', true);
select (select count(*) from kb_chunks) as filas_visibles,
       (select count(*) from match_kb_chunks(array_fill(0.01::real, array[1024])::extensions.vector, 6, -1.0)) as match_devuelve;

-- ============================================================================================
-- D · SIN sesión (rol anon): la tabla no le devuelve filas y la función le está prohibida.
--     ESPERADO: filas_visibles = 0, y la segunda consulta falla con
--               «42501: permission denied for function match_kb_chunks»
--     RESULTADO 20 oct 2026: 0, y error 42501 → CUMPLE
-- ============================================================================================
set local role anon;
select count(*) as filas_visibles from kb_chunks;
-- (correr aparte)
set local role anon;
select count(*) from match_kb_chunks(array_fill(0.01::real, array[1024])::extensions.vector, 6, -1.0);

-- ============================================================================================
-- E · Un usuario normal NO puede escribir fragmentos (solo la clave de servicio, del lado servidor).
--     ESPERADO: error «42501: new row violates row-level security policy for table "kb_chunks"»
--     RESULTADO 20 oct 2026: ese error, sin fila nueva → CUMPLE
-- ============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"436be542-4cd9-4945-b6f4-266453382583","role":"authenticated","app_metadata":{"tenant_id":"ecc25240-84ef-49f1-ac67-6eb88bf1f855"}}', true);
insert into kb_chunks (tenant_id, contenido, fuente, origen_id)
values ('ecc25240-84ef-49f1-ac67-6eb88bf1f855', 'texto inyectado por un usuario', 'catalogo', 'intento-de-escritura');

-- ============================================================================================
-- Pendiente de medir ([por verificar]): con MUCHOS tenants el índice HNSW busca primero los vecinos
-- más cercanos de TODA la tabla y la RLS filtra después, así que un tenant chico podría recibir menos
-- resultados de los pedidos. Con 1 tenant con datos no se puede observar; repetir el caso A con
-- varios tenants cargados antes de vender el producto (pgvector >= 0.8: hnsw.iterative_scan).
-- ============================================================================================
