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
//     todavía). Ver README.md de esta función.
//
// Credenciales por tenant (candidato [9a], 6 sept 2026): ya no hay un
// WHATSAPP_ACCESS_TOKEN global — cada tenant tiene el suyo, guardado en Vault
// (ver la migración 20260906000001 y obtener_secreto_meta_tenant). El tenant
// se identifica decodificando el propio JWT del vendedor (el mismo dato que
// lee private.current_tenant_id() del lado de Postgres, acá leído del lado
// de Deno para no pagar un round-trip extra), y la lectura del secreto usa un
// cliente `service_role` APARTE del cliente RLS-scoped de más abajo —
// obtener_secreto_meta_tenant está revocada a todo lo que no sea service_role,
// a propósito: nunca debe ser alcanzable con el JWT de un usuario común.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GRAPH_VERSION = "v21.0";

// A diferencia de ingesta-whatsapp (Meta la llama servidor-a-servidor) y
// router (la llama un trigger de Postgres), a esta la llama el navegador
// del vendedor — cross-origin real (localhost:5173 hoy, getcandycrm.com
// después), con un header Authorization propio. Sin estos headers el
// preflight OPTIONS del navegador falla y supabase-js lo reporta como
// "Failed to send a request to the Edge Function" — un error de red, no
// uno de esta función, así que no hay forma de verlo desde acá sin probarlo
// con un navegador real. Se descubrió recién probando con el usuario logueado.
//
// Allow-Headers en "*": la primera versión listaba "authorization,
// content-type" a mano y igual falló — supabase-js manda además
// `x-client-info` (y a veces `apikey`) sin avisar, así que cualquier lista
// explícita corre el riesgo de quedarse corta con la próxima versión del
// SDK. "*" es válido en CORS mientras no se usen credenciales (cookies), que
// no es el caso acá — la autenticación va en el header Authorization, no en
// una cookie de sesión.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/**
 * `app_metadata.tenant_id` del JWT — sin verificar la firma acá porque el
 * gateway de Supabase (verify_jwt: true, sin --no-verify-jwt en el deploy de
 * esta función) ya rechazó cualquier token inválido antes de que este código
 * corra. Se decodifica en vez de pedirle a Postgres el mismo dato porque ya
 * es el mismo valor que lee private.current_tenant_id(), sin el round-trip.
 */
function tenantDelJwt(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payloadB64 = token.split(".")[1];
    const normalizado = payloadB64.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
      "=",
    );
    const payload = JSON.parse(atob(normalizado));
    return payload?.app_metadata?.tenant_id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Falta autenticación" }, 401);

  const tenantId = tenantDelJwt(authHeader);
  if (!tenantId) return json({ error: "No se pudo determinar el tenant del token" }, 401);

  // Cliente scoped al usuario que llama — no service_role. Ver el comentario
  // de arriba: es lo que hace que esta función no necesite reimplementar
  // "¿esta conversación es de este vendedor?", la RLS ya lo resuelve.
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // Cliente APARTE, con service_role, únicamente para leer el secreto de
  // Meta de este tenant — nunca para tocar conversations/messages, que
  // siguen pasando por el cliente de arriba y sus RLS.
  const dbSecretos = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

  const { data: accessToken, error: errToken } = await dbSecretos.rpc("obtener_secreto_meta_tenant", {
    p_tenant: tenantId,
    p_tipo: "access_token",
  });
  if (errToken) return json({ error: `No se pudo leer la credencial de Meta: ${errToken.message}` }, 500);
  if (!accessToken) {
    return json(
      { error: "Este tenant todavía no configuró su app de Meta — hacelo desde Configuración." },
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

  // Filtrado por tenant_id — antes de [9a] esto tomaba CUALQUIER número
  // activo, sin distinguir de quién era: con un solo tenant nunca se notó,
  // pero con dos habría dejado que un vendedor mandara desde el número de
  // OTRO tenant.
  const { data: numero, error: errNumero } = await db
    .from("whatsapp_numbers")
    .select("phone_number_id")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .limit(1)
    .single();
  if (errNumero || !numero) return json({ error: "No hay un número de WhatsApp activo para este tenant" }, 500);

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
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
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
