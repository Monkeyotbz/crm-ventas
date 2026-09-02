-- Corrige el hallazgo H1 de la auditoría del 2 sept 2026 (docs/corregir-errores.md).
--
-- La migración 20260829205609 recompuso tres FK a compuestas, pero escribió el
-- ON DELETE SET NULL sin lista de columnas. Sin esa lista, Postgres anula TODAS las
-- columnas de la FK — incluida tenant_id, que es NOT NULL en las tres tablas hijas.
--
-- Efecto en producción, verificado ejecutando antes de escribir esta migración:
--   delete from conversations where id = <cualquiera>;
--   ERROR 23502: null value in column "tenant_id" of relation "agent_executions"
-- Y como conversations cuelga de contacts con on delete cascade, borrar un contacto
-- fallaba por el mismo motivo.
--
-- La forma correcta ya estaba en el repo desde el 25 ago: doc48_p3 línea 81 usa
-- `on delete set null (deal_id)`. Se perdió al recomponer las FK, no era desconocida.
--
-- Requiere Postgres 15+ para la lista de columnas en SET NULL; este proyecto corre 17.

-- agent_executions.conversation_id -> conversations
alter table agent_executions drop constraint if exists agent_executions_conversation_id_fkey;
alter table agent_executions
  add constraint agent_executions_conversation_id_fkey
  foreign key (tenant_id, conversation_id) references conversations (tenant_id, id)
  on delete set null (conversation_id);

-- pipeline_transfers.conversation_id -> conversations
alter table pipeline_transfers drop constraint if exists pipeline_transfers_conversation_id_fkey;
alter table pipeline_transfers
  add constraint pipeline_transfers_conversation_id_fkey
  foreign key (tenant_id, conversation_id) references conversations (tenant_id, id)
  on delete set null (conversation_id);

-- router_decisions.conversation_id -> conversations
alter table router_decisions drop constraint if exists router_decisions_conversation_id_fkey;
alter table router_decisions
  add constraint router_decisions_conversation_id_fkey
  foreign key (tenant_id, conversation_id) references conversations (tenant_id, id)
  on delete set null (conversation_id);

-- Índices que cubren el chequeo de la FK nueva: los existentes son sobre
-- conversation_id solo (doc48_p3 líneas 87, 118, 146) y ya no alcanzan para una FK
-- compuesta. Sin esto, cada borrado de conversación hace seq scan en las tres hijas.
create index if not exists idx_agent_executions_tenant_conversation
  on agent_executions (tenant_id, conversation_id);
create index if not exists idx_pipeline_transfers_tenant_conversation
  on pipeline_transfers (tenant_id, conversation_id);
create index if not exists idx_router_decisions_tenant_conversation
  on router_decisions (tenant_id, conversation_id);
