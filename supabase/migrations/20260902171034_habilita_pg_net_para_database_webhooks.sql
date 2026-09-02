-- Los Database Webhooks del panel de Supabase (Database → Webhooks / Integrations →
-- Database Webhooks) dependen de pg_net para hacer las peticiones HTTP salientes desde
-- Postgres. Nunca se había habilitado en este proyecto — por eso el panel fallaba al
-- crear el webhook del Router con "schema supabase_functions does not exist": ese
-- schema y su función auxiliar los provisiona el propio panel la primera vez que pg_net
-- está disponible, pero sin la extensión ni siquiera llega a intentarlo.
create extension if not exists pg_net;
