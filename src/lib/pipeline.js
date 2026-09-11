import { supabase } from "./supabase.js";

// Capa de datos del tablero de Pipeline. Lee de `pipeline_tablero`
// (security_invoker, migración 20260910130000): hereda la RLS de `deals`, así
// que un 'agent' ve solo las suyas y un owner/admin ve todo el tenant, sin
// filtro extra acá — mismo criterio que panel.js.

const DIAS_HISTORIAL_CERRADOS = 30;

/** Los embudos del tenant, para el selector. Si hay uno solo, la pantalla no
 * muestra selector — no tiene sentido elegir entre una sola opción. */
export async function obtenerPipelines() {
  const { data, error } = await supabase
    .from("pipelines")
    .select("id, nombre, tipo")
    .eq("activo", true)
    .order("orden", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`pipelines: ${error.message}`);
  return data ?? [];
}

/** El tablero de un embudo: filas agrupadas por etapa, en el orden del embudo.
 * Las columnas cerradas (ganada/perdida) se acotan a los últimos 30 días —
 * si no, "Ganado" acumula cientos de filas en pocos meses y deja de servir
 * como tablero de trabajo. Las abiertas no tienen límite: son las que importa
 * ver completas. */
export async function obtenerTablero(pipelineId) {
  const desde = new Date();
  desde.setDate(desde.getDate() - DIAS_HISTORIAL_CERRADOS);

  const { data, error } = await supabase
    .from("pipeline_tablero")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .or(`closed_at.is.null,closed_at.gte.${desde.toISOString()}`)
    .order("etapa_orden", { ascending: true })
    .order("stage_changed_at", { ascending: true });
  if (error) throw new Error(`pipeline_tablero: ${error.message}`);

  const filas = data ?? [];
  const porEtapa = new Map();
  for (const f of filas) {
    if (!porEtapa.has(f.stage_id)) {
      porEtapa.set(f.stage_id, {
        stageId: f.stage_id,
        nombre: f.etapa_nombre,
        orden: f.etapa_orden,
        color: f.etapa_color,
        tipo: f.etapa_tipo,
        horasAlerta: f.etapa_horas_alerta,
        deals: [],
      });
    }
    porEtapa.get(f.stage_id).deals.push(f);
  }

  const columnas = [...porEtapa.values()].sort((a, b) => a.orden - b.orden);

  // Totales de cabecera: solo lo ABIERTO. Lo cerrado ya no cuenta como
  // "en juego" — es historial reciente, no pipeline vivo.
  const abiertos = filas.filter((f) => f.etapa_tipo === "abierta");
  const resumen = {
    cantidad: abiertos.length,
    valor: abiertos.reduce((s, f) => s + Number(f.valor_estimado ?? 0), 0),
  };

  return { columnas, resumen };
}

/** Mueve una oportunidad de etapa. Envuelve public.mover_deal(); el mensaje de
 * error que devuelve la función ya es legible en español ("Para dar una
 * oportunidad por perdida hace falta indicar el motivo", etc.) — no se
 * reescribe acá, se deja pasar tal cual. */
export async function moverDeal(dealId, stageId, motivo) {
  const { error } = await supabase.rpc("mover_deal", {
    p_deal_id: dealId,
    p_stage_id: stageId,
    p_motivo: motivo ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Línea de tiempo de una oportunidad: un evento por movimiento de etapa.
 *
 * `deal_events` tiene DOS foreign keys hacia `pipeline_stages`
 * (de_stage_id y a_stage_id, ambas compuestas por tenant_id), así que
 * PostgREST no puede resolver el embed solo con el nombre de la columna —
 * hace falta el nombre completo de cada constraint como hint (`tabla!fk`).
 * Verificado contra el API real: nombrar la columna a secas devuelve
 * PGRST200 ("no matches"); el nombre de constraint sí resuelve. */
export async function obtenerHistorial(dealId) {
  const { data, error } = await supabase
    .from("deal_events")
    .select(
      "id, actor, motivo, created_at, " +
        "de:pipeline_stages!deal_events_tenant_id_de_stage_id_fkey(nombre), " +
        "a:pipeline_stages!deal_events_tenant_id_a_stage_id_fkey(nombre)",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`deal_events: ${error.message}`);
  return (data ?? []).map((e) => ({
    id: e.id,
    actor: e.actor,
    motivo: e.motivo,
    createdAt: e.created_at,
    deEtapa: e.de?.nombre ?? null,
    aEtapa: e.a?.nombre ?? "",
  }));
}

const ETIQUETA_ACTOR = { bot: "el bot", humano: "una persona", sistema: "el sistema" };

export function etiquetaActor(actor) {
  return ETIQUETA_ACTOR[actor] ?? actor;
}

/** "3 d", "6 h", "ahora" — para el chip de tiempo en etapa de cada tarjeta. */
export function formatearHoras(horas) {
  if (horas == null) return "";
  if (horas < 1) return "ahora";
  if (horas < 24) return `${Math.floor(horas)} h`;
  return `${Math.floor(horas / 24)} d`;
}

/** Nivel de alerta de una tarjeta según cuánto lleva en la etapa vs. el umbral
 * que esa etapa tiene configurado. Sin umbral (null), nunca alerta — es el
 * caso de las etapas ganada/perdida y de cualquier etapa que nadie configuró
 * todavía. */
export function nivelAlerta(horasEnEtapa, horasAlerta) {
  if (horasAlerta == null || horasEnEtapa == null) return "normal";
  if (horasEnEtapa >= horasAlerta * 3) return "frio";
  if (horasEnEtapa >= horasAlerta) return "tibio";
  return "normal";
}
