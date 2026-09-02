// Ingesta de webhooks de WhatsApp Cloud API → CRM (candidato [3] de docs/DECISIONES.md).
//
// Tres responsabilidades, en este orden:
//   1. GET  → responder el handshake de verificación de Meta (hub.challenge).
//   2. POST → validar la firma X-Hub-Signature-256 y responder 200 en menos de 5 s.
//   3. Async → normalizar el payload y escribirlo en contacts/conversations/messages.
//
// El punto 2 y el 3 están deliberadamente separados: Meta reintenta el webhook si no
// recibe un 200 rápido, y un reintento con la ingesta a medio camino duplicaría filas.
// Se responde primero y se procesa después, con la idempotencia de `messages.externo_id`
// como red por si el reintento igual llega.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";

const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";

// El cliente usa la key de servicio a propósito: la ingesta escribe en cualquier tenant
// y RLS no la protege. Por eso cada insert lleva su `tenant_id` explícito, resuelto
// desde `whatsapp_numbers` — ver `resolverTenant`. Ver docs/guia-fases-1-2.md, Paso 2.
const db: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// ---------------------------------------------------------------------------
// Firma
// ---------------------------------------------------------------------------

/** HMAC-SHA256 del cuerpo crudo contra el App Secret, en comparación de tiempo constante. */
async function firmaValida(cuerpoCrudo: string, cabecera: string | null): Promise<boolean> {
  if (!cabecera?.startsWith("sha256=") || !APP_SECRET) return false;

  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(cuerpoCrudo));
  const esperado = [...new Uint8Array(firma)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const recibido = cabecera.slice("sha256=".length);
  if (recibido.length !== esperado.length) return false;

  // Comparación sin cortocircuito: un `===` filtra por timing cuántos bytes coinciden.
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) {
    diff |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Normalización del payload
// ---------------------------------------------------------------------------

/**
 * Texto legible de un mensaje entrante. WhatsApp manda una forma distinta por tipo,
 * y `messages.contenido` es NOT NULL — un adjunto sin texto igual tiene que guardar algo.
 */
function extraerContenido(msg: Record<string, any>): string {
  switch (msg.type) {
    case "text":
      return msg.text?.body ?? "";
    case "button":
      return msg.button?.text ?? "[botón]";
    case "interactive":
      return msg.interactive?.button_reply?.title
        ?? msg.interactive?.list_reply?.title
        ?? "[respuesta interactiva]";
    case "location":
      return `[ubicación] ${msg.location?.latitude}, ${msg.location?.longitude}`;
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker":
      return msg[msg.type]?.caption ?? `[${msg.type}]`;
    default:
      return `[${msg.type ?? "desconocido"}]`;
  }
}

// ---------------------------------------------------------------------------
// Escritura en la base
// ---------------------------------------------------------------------------

/** `phone_number_id` → tenant. Es el único punto donde el webhook sabe de quién es. */
async function resolverTenant(phoneNumberId: string) {
  const { data, error } = await db
    .from("whatsapp_numbers")
    .select("tenant_id, activo")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();

  if (error) throw new Error(`whatsapp_numbers: ${error.message}`);
  if (!data) throw new Error(`phone_number_id ${phoneNumberId} no está registrado`);
  if (!data.activo) throw new Error(`el número ${phoneNumberId} está marcado inactivo`);
  return data.tenant_id as string;
}

/**
 * Dueño por defecto de las filas que crea la ingesta. `contacts.owner_id` y
 * `conversations.owner_id` son NOT NULL, y un webhook entrante no tiene usuario logueado:
 * se asigna al `owner` del tenant hasta que alguien la reasigne desde la bandeja.
 */
async function ownerPorDefecto(tenantId: string): Promise<string> {
  const { data, error } = await db
    .from("team_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("rol", "owner")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`team_members: ${error.message}`);
  if (!data) throw new Error(`el tenant ${tenantId} no tiene ningún miembro con rol owner`);
  return data.user_id as string;
}

/**
 * Contacto por número de WhatsApp. La deduplicación NO es por `contacts.telefono`
 * (texto libre, se escribe de mil formas) sino por `contact_channels`, que tiene
 * `unique (tenant_id, tipo, valor)` — ese constraint es el que define la identidad.
 */
async function contactoDe(tenantId: string, telefono: string, nombrePerfil: string | null) {
  const { data: canal, error: errCanal } = await db
    .from("contact_channels")
    .select("contact_id")
    .eq("tenant_id", tenantId)
    .eq("tipo", "whatsapp")
    .eq("valor", telefono)
    .maybeSingle();

  if (errCanal) throw new Error(`contact_channels: ${errCanal.message}`);
  if (canal) return canal.contact_id as number;

  const ownerId = await ownerPorDefecto(tenantId);
  const { data: contacto, error: errContacto } = await db
    .from("contacts")
    .insert({
      tenant_id: tenantId,
      nombre: nombrePerfil ?? telefono,
      telefono,
      origen: "whatsapp",
      owner_id: ownerId,
      // Escribir primero equivale a consentimiento bajo las reglas de Meta: el contacto
      // inició la conversación. Sin esto no se le puede mandar una plantilla después.
      opt_in_at: new Date().toISOString(),
      opt_in_source: "whatsapp_inbound",
    })
    .select("id")
    .single();

  if (errContacto) throw new Error(`contacts: ${errContacto.message}`);

  const { error: errNuevoCanal } = await db.from("contact_channels").insert({
    tenant_id: tenantId,
    contact_id: contacto.id,
    tipo: "whatsapp",
    valor: telefono,
  });
  if (errNuevoCanal) throw new Error(`contact_channels insert: ${errNuevoCanal.message}`);

  return contacto.id as number;
}

/** Conversación abierta del contacto en WhatsApp, creándola si no hay. */
async function conversacionDe(tenantId: string, contactId: number) {
  const { data, error } = await db
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("contact_id", contactId)
    .eq("canal", "whatsapp")
    .eq("estado", "abierta")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`conversations: ${error.message}`);
  if (data) return data.id as number;

  const ownerId = await ownerPorDefecto(tenantId);
  const { data: nueva, error: errNueva } = await db
    .from("conversations")
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      canal: "whatsapp",
      estado: "abierta",
      owner_id: ownerId,
    })
    .select("id")
    .single();

  if (errNueva) throw new Error(`conversations insert: ${errNueva.message}`);
  return nueva.id as number;
}

/** Un mensaje entrante: lo guarda y corre la ventana de servicio de 24 h. */
async function guardarEntrante(
  tenantId: string,
  msg: Record<string, any>,
  nombrePerfil: string | null,
) {
  const contactId = await contactoDe(tenantId, msg.from, nombrePerfil);
  const conversationId = await conversacionDe(tenantId, contactId);

  // Idempotencia: `unique (conversation_id, externo_id)` — pero es un índice PARCIAL
  // (`where externo_id is not null`), y `.upsert({onConflict: "col,col"})` no puede
  // apuntarle: Postgres exige que el ON CONFLICT nombre exactamente un constraint o
  // índice existente, y uno parcial no matchea solo por columnas. La solución es un
  // insert liso: si Meta reintenta el mismo mensaje, el índice lo rechaza con 23505
  // (unique_violation) y se lo trata como éxito — el mensaje ya estaba guardado.
  const { error: errMsg } = await db.from("messages").insert({
    conversation_id: conversationId,
    direccion: "in",
    canal: "whatsapp",
    contenido: extraerContenido(msg),
    payload_raw: msg,
    externo_id: msg.id,
    entregado: true,
    entregado_at: new Date().toISOString(),
  });

  if (errMsg && errMsg.code !== "23505") {
    throw new Error(`messages: ${errMsg.message}`);
  }

  // La ventana la abre el contacto al escribir, no nosotros al responder: se cuenta
  // desde el timestamp que manda Meta, no desde que esta función corre.
  const recibidoAt = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000)
    : new Date();

  const { data: conv } = await db
    .from("conversations")
    .select("ventana_horas")
    .eq("id", conversationId)
    .single();

  const ventanaHoras = conv?.ventana_horas ?? 24;
  const { error: errVentana } = await db
    .from("conversations")
    .update({
      ultimo_mensaje_at: recibidoAt.toISOString(),
      ventana_abierta_hasta: new Date(
        recibidoAt.getTime() + ventanaHoras * 3600 * 1000,
      ).toISOString(),
    })
    .eq("id", conversationId);

  if (errVentana) throw new Error(`conversations ventana: ${errVentana.message}`);
}

/** Un acuse de entrega (sent/delivered/read) sobre un mensaje que ya mandamos. */
async function guardarEstado(estado: Record<string, any>) {
  if (!["delivered", "read"].includes(estado.status)) return;

  const { error } = await db
    .from("messages")
    .update({ entregado: true, entregado_at: new Date(Number(estado.timestamp) * 1000).toISOString() })
    .eq("externo_id", estado.id);

  if (error) throw new Error(`messages estado: ${error.message}`);
}

/** Deja constancia del fallo. `webhook_errors.tenant_id` es nullable justamente para esto. */
async function registrarError(
  err: unknown,
  payload: unknown,
  tenantId: string | null,
  evento: string,
) {
  await db.from("webhook_errors").insert({
    tenant_id: tenantId,
    origen: "whatsapp",
    evento,
    error: err instanceof Error ? err.message : String(err),
    payload: payload as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Procesamiento (fuera del camino de respuesta)
// ---------------------------------------------------------------------------

async function procesar(payload: Record<string, any>) {
  for (const entry of payload.entry ?? []) {
    for (const cambio of entry.changes ?? []) {
      const valor = cambio.value ?? {};
      const phoneNumberId = valor.metadata?.phone_number_id;
      let tenantId: string | null = null;

      // Primero lo que es común a todo el lote. Si esto falla, ningún ítem del cambio
      // se puede procesar, así que acá el error SÍ es del lote entero.
      let perfiles = new Map<string, string | null>();
      try {
        if (!phoneNumberId) throw new Error("el cambio no trae metadata.phone_number_id");
        tenantId = await resolverTenant(phoneNumberId);

        // `contacts` viene aparte de `messages` en el payload de Meta: trae el nombre
        // de perfil, indexado por wa_id.
        perfiles = new Map<string, string | null>(
          (valor.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name ?? null]),
        );
      } catch (err) {
        console.error("[ingesta-whatsapp] lote:", err);
        await registrarError(err, cambio, tenantId, cambio.field ?? "messages");
        continue;
      }
      if (!tenantId) continue; // inalcanzable: el catch de arriba corta. Es para el type checker.

      // De acá en adelante, cada ítem falla solo. Meta ya recibió el 200 en el handler,
      // así que NO reintenta: un mensaje que se pierda acá se pierde para siempre. Por eso
      // un ítem roto no puede llevarse puestos a los que vienen detrás, y por eso cada
      // error se registra con SU propio payload y no con el lote entero — si no, el
      // diagnóstico no dice cuál de los mensajes falló.
      for (const msg of valor.messages ?? []) {
        try {
          await guardarEntrante(tenantId, msg, perfiles.get(msg.from) ?? null);
        } catch (err) {
          console.error("[ingesta-whatsapp] mensaje:", err);
          await registrarError(err, msg, tenantId, "mensaje");
        }
      }

      for (const estado of valor.statuses ?? []) {
        try {
          await guardarEstado(estado);
        } catch (err) {
          console.error("[ingesta-whatsapp] status:", err);
          await registrarError(err, estado, tenantId, "status");
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Handshake de verificación: Meta lo dispara al registrar la Callback URL y
  // cada vez que se reactiva la suscripción.
  if (req.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (modo === "subscribe" && token === VERIFY_TOKEN && VERIFY_TOKEN !== "") {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // El cuerpo se lee crudo porque la firma se calcula sobre los bytes exactos:
  // parsear y re-serializar el JSON cambiaría el hash.
  const cuerpoCrudo = await req.text();

  if (!(await firmaValida(cuerpoCrudo, req.headers.get("x-hub-signature-256")))) {
    // Sin firma válida no se confía en el payload — ni siquiera para registrarlo
    // como error, porque cualquiera podría inundar `webhook_errors` desde afuera.
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch (err) {
    await registrarError(err, { cuerpoCrudo }, null, "json_invalido");
    return new Response("Bad Request", { status: 400 });
  }

  // 200 primero, trabajo después: Meta reintenta si la respuesta tarda más de 5 s,
  // y cada reintento es otra pasada completa sobre el mismo payload.
  EdgeRuntime.waitUntil(procesar(payload));
  return new Response("EVENT_RECEIVED", { status: 200 });
});
