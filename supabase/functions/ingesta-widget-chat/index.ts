// Ingesta del widget de chat embebible (canal `chat_web`, Sprint 2 del README).
//
// Es la contraparte de ingesta-whatsapp para un canal sin Meta de por medio:
// no hay firma HMAC que valide el origen, así que la confianza acá es más
// débil por diseño. Lo único que identifica al tenant es `widget_key`, y esa
// clave NO es secreta — viaja en el HTML/JS de cualquier sitio que embeba el
// widget (ver el comentario en la migración 20260904171523). Por eso:
//
//   - Nunca se registra en webhook_errors una petición con clave inválida:
//     cualquiera en internet puede mandar una clave inventada, y honrar ese
//     registro sería dejar que un desconocido llene la tabla a gusto (mismo
//     criterio que la firma inválida de WhatsApp, ver ingesta-whatsapp).
//   - No hay límite de velocidad todavía. Es una brecha conocida, no un
//     descuido: falta antes de exponer esto en un sitio público de verdad.
//     Mientras tanto, el único límite real es un tope de longitud al mensaje.
//
// A diferencia de WhatsApp, acá SÍ conviene responder de forma síncrona: no
// hay un remitente (Meta) que reintente si tardamos, hay un navegador
// esperando saber si el mensaje se guardó para poder mostrarlo como enviado.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";

const MAX_MENSAJE = 4000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

// service_role a propósito, igual que ingesta-whatsapp: el widget escribe en
// cualquier tenant y RLS no lo protege — cada insert lleva su `tenant_id`
// explícito, resuelto desde `chat_widget_keys`.
const db: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

interface CuerpoWidget {
  widget_key?: string;
  sesion?: string;
  mensaje?: string;
  email?: string;
  telefono?: string;
  nombre?: string;
  client_message_id?: string;
}

/** `widget_key` → tenant. Único punto donde este endpoint sabe de quién es. */
async function resolverTenant(widgetKey: string) {
  const { data, error } = await db
    .from("chat_widget_keys")
    .select("tenant_id, activo")
    .eq("public_key", widgetKey)
    .maybeSingle();

  if (error) throw new Error(`chat_widget_keys: ${error.message}`);
  if (!data || !data.activo) return null;
  return data.tenant_id as string;
}

async function contactoDe(
  tenantId: string,
  sesion: string,
  email: string | null,
  telefono: string | null,
  nombre: string | null,
) {
  const { data, error } = await db.rpc("resolver_contacto_widget", {
    p_tenant: tenantId,
    p_sesion: sesion,
    p_email: email,
    p_telefono: telefono,
    p_nombre: nombre,
  });

  if (error) throw new Error(`resolver_contacto_widget: ${error.message}`);
  if (data == null) throw new Error("resolver_contacto_widget no devolvió contacto");
  return data as number;
}

async function conversacionDe(tenantId: string, contactId: number) {
  const { data, error } = await db.rpc("resolver_conversacion_canal", {
    p_tenant: tenantId,
    p_contact: contactId,
    p_canal: "chat_web",
  });

  if (error) throw new Error(`resolver_conversacion_canal: ${error.message}`);
  if (data == null) throw new Error("resolver_conversacion_canal no devolvió conversación");
  return data as number;
}

/**
 * Mensajes salientes (respuestas del vendedor) desde que el widget vio el
 * último. Es la contraparte de "recibir" — el widget no tiene sesión ni
 * cliente de Supabase propio, así que no puede suscribirse a Realtime
 * (RLS no le da nada a `anon`, a propósito). En vez de eso, el widget
 * consulta esto cada pocos segundos mientras el panel está abierto.
 *
 * Se resuelve por `sesion`, no por un `conversation_id` que mandara el
 * cliente: igual que `contactoDe`, el cruce (tenant_id, tipo, valor) de
 * `contact_channels` es lo que impide que alguien pase el conversation_id
 * de OTRO tenant y lea mensajes ajenos. Devuelve vacío, no error, si
 * todavía no hay contacto/conversación para esa sesión — es el estado
 * normal antes del primer mensaje.
 */
async function mensajesNuevos(tenantId: string, sesion: string, desde: number) {
  const { data: canal } = await db
    .from("contact_channels")
    .select("contact_id")
    .eq("tenant_id", tenantId)
    .eq("tipo", "chat_web")
    .eq("valor", sesion)
    .maybeSingle();
  if (!canal) return [];

  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("contact_id", canal.contact_id)
    .eq("canal", "chat_web")
    .eq("estado", "abierta")
    .maybeSingle();
  if (!conv) return [];

  const { data: mensajes, error } = await db
    .from("messages")
    .select("id, contenido, created_at")
    .eq("conversation_id", conv.id)
    .eq("direccion", "out")
    .gt("id", desde)
    .order("id", { ascending: true })
    .limit(50);

  if (error) throw new Error(`messages (poll): ${error.message}`);
  return mensajes ?? [];
}

/** Deja constancia del fallo. Solo se llama con un tenant ya resuelto — ver la nota de arriba. */
async function registrarError(err: unknown, payload: unknown, tenantId: string, evento: string) {
  await db.from("webhook_errors").insert({
    tenant_id: tenantId,
    origen: "chat_web",
    evento,
    error: err instanceof Error ? err.message : String(err),
    payload: payload as Record<string, unknown>,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const widgetKey = (url.searchParams.get("widget_key") ?? "").trim();
    const sesion = (url.searchParams.get("sesion") ?? "").trim();
    const desde = Number(url.searchParams.get("desde") ?? "0") || 0;

    if (!widgetKey) return json({ error: "falta widget_key" }, 400);
    if (!sesion) return json({ error: "falta sesion" }, 400);

    let tenantId: string | null;
    try {
      tenantId = await resolverTenant(widgetKey);
    } catch (err) {
      console.error("[ingesta-widget-chat] resolverTenant (poll):", err);
      return json({ error: "error interno" }, 500);
    }
    if (!tenantId) return json({ error: "widget no encontrado" }, 404);

    try {
      const mensajes = await mensajesNuevos(tenantId, sesion, desde);
      return json({ mensajes });
    } catch (err) {
      console.error("[ingesta-widget-chat] poll:", err);
      return json({ error: "no se pudo consultar mensajes" }, 500);
    }
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let cuerpo: CuerpoWidget;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "json_invalido" }, 400);
  }

  const widgetKey = (cuerpo.widget_key ?? "").trim();
  const sesion = (cuerpo.sesion ?? "").trim();
  const mensaje = (cuerpo.mensaje ?? "").trim();

  if (!widgetKey) return json({ error: "falta widget_key" }, 400);
  if (!sesion) return json({ error: "falta sesion" }, 400);
  if (!mensaje) return json({ error: "el mensaje está vacío" }, 400);
  if (mensaje.length > MAX_MENSAJE) {
    return json({ error: `el mensaje supera los ${MAX_MENSAJE} caracteres` }, 413);
  }

  let tenantId: string | null;
  try {
    tenantId = await resolverTenant(widgetKey);
  } catch (err) {
    // Acá el fallo es nuestro (la consulta a chat_widget_keys), no del
    // llamante — sí vale la pena registrarlo, pero sin tenant conocido.
    console.error("[ingesta-widget-chat] resolverTenant:", err);
    return json({ error: "error interno" }, 500);
  }
  if (!tenantId) {
    // Clave inválida o inactiva: 404 sin registrar nada (ver comentario del
    // encabezado). No se distingue "no existe" de "inactiva" en la
    // respuesta — no le sirve a un atacante saber cuál de las dos fue.
    return json({ error: "widget no encontrado" }, 404);
  }

  const email = cuerpo.email?.trim() || null;
  const telefono = cuerpo.telefono?.trim() || null;
  const nombre = cuerpo.nombre?.trim() || null;

  try {
    const contactId = await contactoDe(tenantId, sesion, email, telefono, nombre);
    const conversationId = await conversacionDe(tenantId, contactId);

    // Idempotencia igual que WhatsApp: `externo_id` lo genera el propio
    // widget (o nosotros si no lo mandó) y el índice parcial de `messages`
    // rechaza el duplicado si el navegador reintenta el mismo POST.
    const externoId = cuerpo.client_message_id?.trim() || crypto.randomUUID();
    const { error: errMsg } = await db.from("messages").insert({
      conversation_id: conversationId,
      direccion: "in",
      canal: "chat_web",
      contenido: mensaje,
      payload_raw: cuerpo as Record<string, unknown>,
      externo_id: externoId,
    });
    if (errMsg && errMsg.code !== "23505") {
      throw new Error(`messages: ${errMsg.message}`);
    }

    const { error: errUltimo } = await db
      .from("conversations")
      .update({ ultimo_mensaje_at: new Date().toISOString() })
      .eq("id", conversationId);
    if (errUltimo) throw new Error(`conversations ultimo_mensaje_at: ${errUltimo.message}`);

    return json({ ok: true, conversation_id: conversationId, contact_id: contactId });
  } catch (err) {
    console.error("[ingesta-widget-chat] mensaje:", err);
    await registrarError(err, cuerpo, tenantId, "mensaje");
    return json({ error: "no se pudo guardar el mensaje" }, 500);
  }
});
