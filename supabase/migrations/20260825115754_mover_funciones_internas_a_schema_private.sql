-- ============================================================
-- Ocultar funciones internas del RPC público (25 ago 2026)
-- ============================================================
-- El advisor de seguridad marcó 6 funciones SECURITY DEFINER expuestas como
-- endpoints RPC públicos (/rest/v1/rpc/is_admin, etc.) porque vivían en
-- `public`, el único schema que PostgREST expone por default. La corrección
-- correcta NO es revocar EXECUTE (eso rompería las policies de RLS, que
-- necesitan poder invocar estas mismas funciones internamente) — es mover
-- las funciones a un schema separado que PostgREST no expone.
--
-- Es seguro hacerlo después de crear las policies/triggers: Postgres ya
-- resolvió y ató esas 17 policies y 4 triggers a las funciones por OID en
-- el momento en que se crearon (igual que un CHECK constraint o una vista),
-- no por nombre buscado en cada consulta — así que moverlas de schema ahora
-- no rompe nada de lo ya creado.
create schema if not exists private;

alter function is_platform_admin(uuid) set schema private;
alter function support_session_solo_cerrar() set schema private;
alter function current_tenant_id() set schema private;
alter function active_support_session_id() set schema private;
alter function set_updated_at() set schema private;
alter function is_admin(uuid) set schema private;
alter function audit_deal_stage_change() set schema private;
alter function audit_support_write() set schema private;

-- Reafirmar el search_path ahora que viven en `private`: sus cuerpos llaman
-- a otras funciones de este mismo schema por nombre sin calificar (ej.
-- is_admin llama a is_platform_admin y a current_tenant_id) y leen tablas
-- de `public` (team_members, support_sessions, etc.) — necesitan ambos
-- schemas en el search_path para resolver las dos cosas.
alter function private.is_platform_admin(uuid) set search_path = private, public;
alter function private.support_session_solo_cerrar() set search_path = private, public;
alter function private.current_tenant_id() set search_path = private, public;
alter function private.active_support_session_id() set search_path = private, public;
alter function private.set_updated_at() set search_path = private, public;
alter function private.is_admin(uuid) set search_path = private, public;
alter function private.audit_deal_stage_change() set search_path = private, public;
alter function private.audit_support_write() set search_path = private, public;
