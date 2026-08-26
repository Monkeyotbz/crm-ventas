-- ============================================================
-- Hardening post-advisors (25 ago 2026)
-- ============================================================
-- El linter de seguridad de Supabase marcó dos cosas reales tras aplicar el
-- esquema. Ninguna bloqueante (todo WARN), pero son correcciones de bajo
-- riesgo sobre una base sin datos reales todavía — se aplican de una vez.

-- 1) search_path mutable en las 8 funciones nuevas. Sin `search_path` fijo,
-- una función podría resolver un nombre de tabla sin calificar contra un
-- objeto homónimo creado en otro schema que aparezca antes en el search_path
-- de la sesión que la llama. Se fija a public (todas las tablas referenciadas
-- viven ahí) — pg_catalog siempre se antepone igual, así que no hace falta
-- incluirlo.
alter function is_platform_admin(uuid) set search_path = public;
alter function support_session_solo_cerrar() set search_path = public;
alter function current_tenant_id() set search_path = public;
alter function active_support_session_id() set search_path = public;
alter function set_updated_at() set search_path = public;
alter function is_admin(uuid) set search_path = public;
alter function audit_deal_stage_change() set search_path = public;
alter function audit_support_write() set search_path = public;

-- 2) La extensión vector quedó en el schema public (default de `create
-- extension`). Supabase recomienda no mezclar extensiones con las tablas de
-- negocio. Se mueve a un schema dedicado — no rompe kb_chunks.embedding: el
-- tipo vector se resuelve por su nombre calificado internamente, Postgres
-- actualiza la referencia sola.
create schema if not exists extensions;
alter extension vector set schema extensions;
