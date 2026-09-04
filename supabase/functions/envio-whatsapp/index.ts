// Envío saliente de WhatsApp — responder desde la bandeja unificada (Sprint 1).
//
// Distinto de ingesta-whatsapp (webhook público de Meta) y router (llamado
// por un trigger con secreto compartido): a esta la llama el FRONTEND
// logueado. Corre con el JWT de quien la invoca, no con service_role — así
// que la lectura de la conversación y la escritura del mensaje pasan por
// las mismas RLS que protegen todo lo demás. Un vendedor no puede mandar un
// mensaje a una conversación que no es suya ni de otro tenant, porque
// directamente no la puede leer: no hace falta reimplementar esa regla acá.
//
// Reglas de WhatsApp que esto respeta (private.validar_plantilla_para_iniciar
// ya las hace cumplir a nivel de base — esto solo evita el viaje a Meta
// cuando ya se sabe que va a fallar, y da un error legible en vez de un 500
// de Postgres):
//   - Ventana de servicio abierta (24h desde el último mensaje ENTRANTE):
//     se puede mandar texto libre.
//   - Ventana cerrada: hace falta una plantilla aprobada por Meta. Este
//     camino existe en el código pero NO se probó contra la API real todavía
//     — message_templates está vacía (nadie sometió una plantilla a Meta
//     todavía) y falta el secret WHATSAPP_ACCESS_TOKEN. Ver README.md de
//     esta función.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const GRAPH_VERSION = "v21.0";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Falta autenticación" }, 401);

  // Cliente scoped al usuario que llama — no service_role. Ver el comentario
  // de arriba: es lo que hace que esta función no necesite reimplementar
  // "¿esta conversación es de este vendedor?", la RLS ya lo resuelve.
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  let body: { conversation_id?: number; contenido?: string; template_id?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const { conversation_id, contenido, template_id } = body;
  if (!conversation_id) return json({ error: "Falta conversation_id" }, 400);
  if (!contenido && !template_id) return json({ error: "Falta contenido o template_id" }, 400);

  if (!WHATSAPP_ACCESS_TOKEN) {
    return json(
      { error: "WHATSAPP_ACCESS_TOKEN no está configurado — no se puede enviar todavía. Ver README.md." },
      503,
    );
  }

  // RLS filtra por tenant + (owner_id = quien llama, o admin). Si la
  // conversación no es suya, .single() no devuelve fila — el 404 no delata
  // si existe en otro tenant.
  const { data: conv, error: errConv } = await db
    .from("conversations")
    .select("id, canal, ventana_abierta_hasta, contact:contacts(telefono)")
    .eq("id", conversation_id)
    .single();

  if (errConv || !conv) return json({ error: "Conversación no encontrada" }, 404);
  if (conv.canal !== "whatsapp") return json({ error: "Esta función solo envía por WhatsApp" }, 400);

  const contacto = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact;
  const telefono = contacto?.telefono;
  if (!telefono) return json({ error: "El contacto no tiene teléfono" }, 400);

  const { data: numero, error: errNumero } = await db
    .from("whatsapp_numbers")
    .select("phone_number_id")
    .eq("activo", true)
    .limit(1)
    .single();
  if (errNumero || !numero) return json({ error: "No hay un número de WhatsApp activo" }, 500);

  const ventanaAbierta = Boolean(
    conv.ventana_abierta_hasta && new Date(conv.ventana_abierta_hasta) > new Date(),
  );

  let payloadMeta: Record<string, unknown>;
  let contenidoGuardado: string;

  if (ventanaAbierta) {
    if (!contenido) return json({ error: "Hace falta el texto del mensaje" }, 400);
    payloadMeta = { messaging_product: "whatsapp", to: telefono, type: "text", text: { body: contenido } };
    contenidoGuardado = contenido;
  } else {
    if (!template_id) {
      return json(
        {
          error: "La ventana de 24h está cerrada — hace falta una plantilla aprobada por Meta para reabrir la conversación",
          ventana_cerrada: true,
        },
        409,
      );
    }

    const { data: plantilla, error: errPlantilla } = await db
      .from("message_templates")
      .select("id, nombre, idioma, estado, cuerpo")
      .eq("id", template_id)
      .single();
    if (errPlantilla || !plantilla) return json({ error: "Plantilla no encontrada" }, 404);
    if (plantilla.estado !== "aprobada") {
      return json({ error: `La plantilla está en estado "${plantilla.estado}", no aprobada` }, 400);
    }

    payloadMeta = {
      messaging_product: "whatsapp",
      to: telefono,
      type: "template",
      template: { name: plantilla.nombre, language: { code: plantilla.idioma } },
    };
    contenidoGuardado = plantilla.cuerpo;
  }

  let respuestaMeta: Response;
  try {
    respuestaMeta = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${numero.phone_number_id}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payloadMeta),
      },
    );
  } catch (err) {
    return json({ error: `No se pudo contactar a Meta: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  const cuerpoMeta = await respuestaMeta.json().catch(() => ({}));

  if (!respuestaMeta.ok) {
    const motivo = cuerpoMeta?.error?.message ?? "Error desconocido de Meta";
    return json({ error: `WhatsApp rechazó el envío: ${motivo}` }, 502);
  }

  const wamid = cuerpoMeta?.messages?.[0]?.id ?? null;

  // externo_id = wamid: conecta este mensaje con guardarEstado() de
  // ingesta-whatsapp, que ya actualiza entregado/entregado_at cuando llega
  // el webhook de status — no hace falta duplicar ese tracking acá.
  const { data: mensaje, error: errInsert } = await db
    .from("messages")
    .insert({
      conversation_id,
      direccion: "out",
      canal: "whatsapp",
      contenido: contenidoGuardado,
      template_id: ventanaAbierta ? null : template_id,
      externo_id: wamid,
    })
    .select()
    .single();

  if (errInsert) {
    // El mensaje YA salió por WhatsApp — no hay forma de "deshacer" un envío.
    // Preferible avisar que falló guardarlo (con el wamid, para reconciliar
    // a mano) que fingir que no pasó nada.
    return json({ error: `Se envió por WhatsApp pero no se pudo guardar: ${errInsert.message}`, wamid }, 500);
  }

  await db.from("conversations").update({ ultimo_mensaje_at: new Date().toISOString() }).eq("id", conversation_id);

  return json({ ok: true, mensaje }, 200);
});
