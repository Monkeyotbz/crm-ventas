-- ============================================================
-- Extender la auditoría de soporte a las tablas nuevas
-- ============================================================
-- El trigger trg_audit_support solo cubría las 14 tablas originales. Las
-- tablas nuevas que contienen DATOS DEL TENANT tienen que quedar auditadas
-- igual: si un admin de plataforma toca el catálogo de productos o un link
-- de pago de un cliente durante un soporte, eso tiene que dejar rastro.
--
-- Quedan FUERA a propósito las tablas de plataforma (agent_executions,
-- router_decisions, subscriptions, feature_usage, webhook_errors,
-- metrics_snapshots, search_console_data, whatsapp_pricing,
-- quality_rating_history): escribirlas ES el trabajo normal de la
-- plataforma, no un acceso cruzado a datos de un cliente. Auditarlas sería
-- ruido que enterraría lo que sí importa.
do $$
declare
  t text;
begin
  foreach t in array array[
    'pipelines', 'products', 'deal_items', 'message_templates',
    'whatsapp_numbers', 'contact_touchpoints', 'pipeline_transfers',
    'payment_links'
  ]
  loop
    execute format(
      'drop trigger if exists trg_audit_support on %I; create trigger trg_audit_support after insert or update or delete on %I for each row execute function private.audit_support_write();',
      t, t
    );
  end loop;
end;
$$;
