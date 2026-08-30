-- Cierra el hueco encontrado por scripts/validar-multitenant.sql (candidato [2] de
-- docs/DECISIONES.md, corrida del 29 ago 2026): cinco foreign keys simples hacia tablas
-- que sí tienen tenant_id, creadas por doc48_p3_atribucion_agentes_saas mientras el núcleo
-- (migración 1) ya usaba compuestas en todos lados. RLS aislaba la lectura, pero nada
-- impedía escribir una fila que apuntara al padre de OTRO tenant.
--
-- Dos tablas padre no tenían el unique (tenant_id, id) que una FK compuesta necesita del
-- lado del padre — se agrega primero. quotes ya lo tenía (quotes_tenant_id_id_key).

-- Capa previa: unique (tenant_id, id) en los padres que todavía no lo tenían.
alter table conversations add constraint conversations_tenant_id_id_key unique (tenant_id, id);
alter table support_sessions add constraint support_sessions_tenant_id_id_key unique (tenant_id, id);

-- Hallazgo adicional durante la corrida: payments.tenant_id era nullable. Con MATCH SIMPLE
-- (el default de Postgres), una FK compuesta no se evalúa si cualquiera de sus columnas es
-- null — un tenant_id nulo habría dejado la fila sin proteger, vaciando la garantía que
-- esta migración agrega. La tabla está vacía en producción (verificado antes de aplicar),
-- así que no hay filas existentes que rompan el NOT NULL.
alter table payments alter column tenant_id set not null;

-- agent_executions.conversation_id -> conversations
alter table agent_executions drop constraint agent_executions_conversation_id_fkey;
alter table agent_executions
  add constraint agent_executions_conversation_id_fkey
  foreign key (tenant_id, conversation_id) references conversations (tenant_id, id)
  on delete set null;

-- pipeline_transfers.conversation_id -> conversations
alter table pipeline_transfers drop constraint pipeline_transfers_conversation_id_fkey;
alter table pipeline_transfers
  add constraint pipeline_transfers_conversation_id_fkey
  foreign key (tenant_id, conversation_id) references conversations (tenant_id, id)
  on delete set null;

-- router_decisions.conversation_id -> conversations
alter table router_decisions drop constraint router_decisions_conversation_id_fkey;
alter table router_decisions
  add constraint router_decisions_conversation_id_fkey
  foreign key (tenant_id, conversation_id) references conversations (tenant_id, id)
  on delete set null;

-- payments.quote_id -> quotes
alter table payments drop constraint payments_quote_id_fkey;
alter table payments
  add constraint payments_quote_id_fkey
  foreign key (tenant_id, quote_id) references quotes (tenant_id, id)
  on delete cascade;

-- audit_log.support_session_id -> support_sessions
alter table audit_log drop constraint audit_log_support_session_id_fkey;
alter table audit_log
  add constraint audit_log_support_session_id_fkey
  foreign key (tenant_id, support_session_id) references support_sessions (tenant_id, id)
  on delete no action;
