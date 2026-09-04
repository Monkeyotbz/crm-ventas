// Consultas de la bandeja unificada (Sprint 1 — docs/pendientes.md).
// Lee de `inbox_conversaciones` (supabase/migrations/20260904202843_...) para
// el listado, y de `messages` directo para el hilo de una conversación
// puntual — RLS ya filtra por tenant/dueño en las dos, no hace falta
// filtrar tenant_id acá: eso es justo lo que la sesión logueada resuelve.

import { supabase } from "./supabase.js";

export async function listarConversaciones() {
  const { data, error } = await supabase
    .from("inbox_conversaciones")
    .select("*")
    .order("ultimo_mensaje_at", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`inbox_conversaciones: ${error.message}`);
  return data ?? [];
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
