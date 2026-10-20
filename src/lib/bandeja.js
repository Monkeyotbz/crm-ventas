// Consultas de la bandeja unificada (Sprint 1 — docs/pendientes.md).
// Lee de `inbox_conversaciones` (supabase/migrations/20260904202843_...) para
// el listado, y de `messages` directo para el hilo de una conversación
// puntual — RLS ya filtra por tenant/dueño en las dos, no hace falta
// filtrar tenant_id acá: eso es justo lo que la sesión logueada resuelve.

import { supabase } from "./supabase.js";

/** Cuántas conversaciones trae cada tanda. "Ver más" suma otra. */
export const TANDA_CONVERSACIONES = 50;

/**
 * Cortes del score de la IA. Son los mismos que `nivel_interes` en la base, que
 * `estiloScoreLista` y que el panel Copiloto: si cambian, cambian en los cuatro.
 * `sin_analizar` es score nulo, que NO es lo mismo que score bajo.
 */
const FILTROS_INTERES = {
  alto: (q) => q.gte("score", 75),
  medio: (q) => q.gte("score", 50).lt("score", 75),
  bajo: (q) => q.lt("score", 50),
  sin_analizar: (q) => q.is("score", null),
};

function aplicarFiltros(q, { canal, interes }) {
  if (canal && canal !== "todos") q = q.eq("canal", canal);
  if (interes && FILTROS_INTERES[interes]) q = FILTROS_INTERES[interes](q);
  return q;
}

/**
 * Una tanda de conversaciones, con los filtros aplicados EN LA BASE y no sobre lo
 * que ya se bajó: con filtro en el cliente, "Interés alto" solo vería las altas de
 * las primeras 50 y escondería el resto sin avisar.
 *
 * Devuelve `{ filas, total }`: `total` es cuántas hay en TODA la lista filtrada,
 * para saber si queda algo por traer. El orden sigue siendo por fecha, a propósito:
 * el score es una estimación y no debe decidir el orden por defecto.
 */
export async function listarConversaciones({ canal = "todos", interes = null, limite = TANDA_CONVERSACIONES } = {}) {
  const q = aplicarFiltros(
    supabase.from("inbox_conversaciones").select("*", { count: "exact" }),
    { canal, interes },
  )
    .order("ultimo_mensaje_at", { ascending: false, nullsFirst: false })
    .range(0, limite - 1);

  const { data, error, count } = await q;
  if (error) throw new Error(`inbox_conversaciones: ${error.message}`);
  return { filas: data ?? [], total: count ?? (data?.length ?? 0) };
}

/**
 * Cuántas conversaciones hay en cada nivel de interés, respetando el filtro de
 * canal. Cuatro consultas de solo conteo (`head: true`, no bajan filas), en
 * paralelo. RLS las limita a lo que este usuario puede ver, igual que la lista.
 */
export async function contarPorInteres({ canal = "todos" } = {}) {
  const niveles = Object.keys(FILTROS_INTERES);
  const resultados = await Promise.all(
    niveles.map(async (nivel) => {
      const { count, error } = await aplicarFiltros(
        supabase.from("inbox_conversaciones").select("conversation_id", { count: "exact", head: true }),
        { canal, interes: nivel },
      );
      if (error) throw new Error(`inbox_conversaciones (conteo ${nivel}): ${error.message}`);
      return [nivel, count ?? 0];
    }),
  );
  return Object.fromEntries(resultados);
}

export async function listarMensajes(conversationId) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, direccion, canal, contenido, created_at, entregado")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`messages: ${error.message}`);
  return data ?? [];
}

/**
 * Envía un mensaje saliente de WhatsApp — supabase-js adjunta el JWT de la
 * sesión actual automáticamente, así que `envio-whatsapp` corre con los
 * mismos permisos que el resto de la bandeja (ver el comentario de esa
 * función: RLS decide si esta conversación es de este vendedor).
 *
 * Devuelve `{ ok: true, mensaje }` o lanza con el `error` que mandó la
 * función — incluido el caso `ventana_cerrada: true`, que el llamador puede
 * usar para mostrar un mensaje distinto al de un error de red genérico.
 */
export async function enviarMensajeWhatsapp({ conversationId, contenido, templateId }) {
  const { data, error } = await supabase.functions.invoke("envio-whatsapp", {
    body: { conversation_id: conversationId, contenido, template_id: templateId },
  });

  // supabase-js no rechaza automáticamente en 4xx/5xx del lado de la función
  // (a diferencia de un fetch fallido de red, que sí cae en `error`) — el
  // cuerpo de error que arma envio-whatsapp viene en `data` igual. Se
  // normalizan los dos casos acá para que quien llama solo tenga que hacer
  // un try/catch, sin acordarse de esta distinción cada vez.
  if (error) throw Object.assign(new Error(error.message), { ventana_cerrada: false });
  if (data?.error) throw Object.assign(new Error(data.error), { ventana_cerrada: Boolean(data.ventana_cerrada) });

  return data;
}

/**
 * Se suscribe a inserts de mensajes nuevos de este tenant (RLS de Realtime
 * corre con el mismo JWT, así que ya llegan filtrados). `onNuevo` se llama
 * con la fila cruda de `messages` — quien la use decide si le importa.
 * Devuelve la función para desuscribirse.
 */
export function suscribirMensajesNuevos(onNuevo) {
  const canal = supabase
    .channel("bandeja-mensajes-nuevos")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      onNuevo(payload.new);
    })
    .subscribe();

  return () => supabase.removeChannel(canal);
}
