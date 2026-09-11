-- Guarda la clasificación real de Haiku en router_decisions, aunque el tenant
-- no tenga un embudo para ella.
--
-- No sembrar los tres embudos (Transaccional/Consultivo/Expansión) para todo
-- tenant nuevo fue una decisión deliberada de 20260909120000, no un olvido:
-- las routing_rules de Hellominus son vocabulario de SU negocio ("conversor",
-- "la constructora"), y copiarlas a un tenant nuevo sería activamente
-- incorrecto. El Router ya degrada con gracia cuando falta un embudo — cae al
-- consultivo por defecto, sin romperse (router/index.ts, `porDefecto`).
--
-- Lo único que de verdad se perdía: cuando Haiku clasifica un mensaje como
-- 'transaccional' y el tenant solo tiene un embudo 'consultivo', la decisión
-- quedaba guardada con el embudo que SÍ existe — el tipo real que dijo el
-- modelo no sobrevivía en ningún lado. Un tenant de un solo embudo no podía
-- más adelante mirar su historial y responder "¿cuántos de mis leads hubieran
-- sido transaccionales?", que es justo el dato que le haría falta para decidir
-- si le conviene abrir un segundo embudo.

alter table router_decisions add column if not exists tipo_sugerido text;

do $$ begin
  alter table router_decisions
    add constraint router_decisions_tipo_sugerido_check
    check (tipo_sugerido in ('transaccional', 'consultivo', 'expansion'));
exception when duplicate_object then null; end $$;

comment on column router_decisions.tipo_sugerido is
  'El tipo que devolvió la capa semántica (Haiku), siempre que corrió — sin importar si coincidió con el embudo que finalmente se usó. Null cuando resolvió una regla dura (routing_rules) o cuando la capa semántica no corrió (sin API key o sin respuesta): en esos casos no hay clasificación del modelo que reportar, y fingir un valor sería mentir sobre qué decidió. Sin backfill: las filas anteriores a esta columna no tienen forma de reconstruir qué dijo Haiku en su momento.';
