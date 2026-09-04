// Consultas de la bandeja unificada (Sprint 1, solo lectura — docs/pendientes.md).
// Lee de `inbox_conversaciones` (supabase/migrations/20260905000001_...) para
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
