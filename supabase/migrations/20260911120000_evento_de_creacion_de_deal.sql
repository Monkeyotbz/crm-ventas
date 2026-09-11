-- El primer evento de cada oportunidad, escrito por la base y no por quien crea
-- el deal.
--
-- Por qué trigger y no una línea más en el Router: el evento de creación y la
-- fila de `deals` tienen que aparecer juntos o no aparecer. Si el Router hiciera
-- dos llamadas separadas a PostgREST y fallara la segunda, quedaría una
-- oportunidad sin su evento inicial — y ese evento es el que marca cuándo entró
-- a la primera etapa, o sea el punto de partida de "cuánto tardó cada etapa".
-- Un trigger corre en la misma transacción que el insert: o pasan las dos cosas
-- o ninguna.
--
-- Además vale para TODO el que cree un deal, no solo el Router: cuando la
-- pantalla de Pipeline permita crear oportunidades a mano, o la API de ingesta
-- las cree, el evento sale igual sin tocar ese código.
--
-- Los movimientos POSTERIORES no pasan por acá: los escribe public.mover_deal(),
-- que además valida embudo y motivo. Este trigger es solo del insert, así que no
-- hay riesgo de que los dos escriban el mismo evento dos veces.

create or replace function private.registrar_creacion_de_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.deal_events (tenant_id, deal_id, de_stage_id, a_stage_id, actor, actor_user_id)
  values (
    new.tenant_id,
    new.id,
    -- null a propósito: es el primer evento. La UI lo muestra como
    -- "Creado en <etapa>", no como "— → <etapa>".
    null,
    new.stage_id,
    -- Sin usuario en contexto, el deal lo creó el Router, que es el bot. Es
    -- cierto hoy porque el Router es lo único que inserta en `deals`; si algún
    -- día un script de mantenimiento crea deals con service_role, va a quedar
    -- atribuido a 'bot' y habrá que pasarle el actor explícitamente.
    case when auth.uid() is null then 'bot' else 'humano' end,
    auth.uid()
  );
  return new;
end;
$$;

comment on function private.registrar_creacion_de_deal() is
  'Escribe el evento inicial de deal_events en la misma transacción que el insert del deal, para que ninguna oportunidad quede sin su punto de partida.';

drop trigger if exists trg_deal_events_creacion on deals;
create trigger trg_deal_events_creacion
  after insert on deals
  for each row execute function private.registrar_creacion_de_deal();
