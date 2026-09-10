-- Módulos por tenant: qué features de candyCRM tiene activadas cada empresa.
--
-- El catálogo turístico (migración 20260904120000) es de un vertical concreto
-- —Turismo Colombia—, no del CRM genérico. Hasta hoy la pestaña "Catálogo" se
-- le mostraba a TODOS los tenants: un equipo de ventas que no vende turismo veía
-- una pestaña que, en el mejor caso, le abría una pantalla vacía.
--
-- Esto NO es seguridad (el aislamiento de datos ya lo dan la RLS y el filtro por
-- tenant de src/lib/catalogo.js). Es qué se le OFRECE a la vista a cada tenant.
--
-- Versión mínima a propósito: un array `text[]` en `tenants`, no una tabla
-- `tenant_modulos`. Si algún día hace falta metadata por módulo (fecha de alta,
-- config, quién lo activó, plan), se mueve a tabla — hoy alcanza con on/off.

alter table tenants
  add column if not exists modulos text[] not null default '{crm}';

comment on column tenants.modulos is
  'Módulos de candyCRM activados para este tenant (''crm'', ''catalogo'', ...). El frontend gatea la navegación con esto. ''crm'' es el núcleo y va en todos. El default del ADD COLUMN cubre a los tenants nuevos que crea private.aprovisionar_espacio (inserta solo nombre+slug), así que esa función no se toca.';

-- Backfill de los tenants que ya existen. Hellominus vende, Turismo Colombia
-- vende Y tiene catálogo.
update tenants set modulos = '{crm}'          where slug = 'hellominus';
update tenants set modulos = '{crm,catalogo}' where slug = 'turismo-colombia';
-- Cualquier otro tenant preexistente (de pruebas) queda con el default '{crm}'.

-- No hace falta policy nueva: `tenants` ya tiene una de SELECT
-- ("el propio, o todos si es plataforma") y `modulos` viaja en esa fila.
