// API de ingesta de leads — candidato [9a] de docs/DECISIONES.md, segunda mitad.
//
// Con esto el sistema propio de un tenant (su formulario web, su ERP, su
// e-commerce) empuja leads hacia candyCRM sin que nadie de Hellominus tenga que
// construirle una integración a medida. Es la pieza que hace viable el "carril
// masivo" de venta descrito en CLAUDE.md: el comprador se conecta solo.
//
// Es el endpoint MÁS EXPUESTO del proyecto — lo llama código de terceros desde
// internet, a diferencia de ingesta-whatsapp (solo Meta, con firma HMAC) o del
// widget (tráfico de navegador con clave pública). De ahí las tres defensas que
// las otras funciones no tienen: clave secreta hasheada, límite de velocidad, y
// topes de longitud en TODOS los campos.
//
// El lead entra como conversación, y el Router hace el resto: al insertar el
// mensaje se dispara `private.disparar_router()` (que reacciona a CUALQUIER
// mensaje entrante, no solo de WhatsApp), y ese agente clasifica el lead y le
// crea la oportunidad. Por eso acá no hay ni una línea de lógica de pipelines
// ni de etapas: ya existe y funciona, sería duplicarla.
//
// SIN CORS, a propósito. Es servidor-a-servidor: que un navegador no pueda
// llamarla es una defensa, no una carencia — desalienta poner la clave secreta
// en JavaScript de cliente, donde quedaría expuesta a cualquiera que abra el
// inspector. Es lo contrario del widget, que sí necesita CORS abierto porque lo
// llama un navegador con una clave que ya es pública por diseño.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";

// Topes de longitud en TODOS los campos de texto, no solo en el mensaje.
// ingesta-widget-chat solo topea `mensaje` y guarda el cuerpo crudo entero en
// `payload_raw`, así que un POST de megabytes se persiste completo — no repetir
// eso en el endpoint más expuesto.
const MAX = {
  mensaje: 4000,
  nombre: 200,
  email: 320, // el máximo real de una dirección de correo según el RFC
  telefono: 40,
  empresa: 200,
  external_id: 200,
  utm: 200,
} as const;

// 120 peticiones por minuto por tenant. Suficiente para un formulario web o una
// sincronización normal de ERP, y muy por debajo de lo que haría falta para
// usar esto como vector de abuso.
const LIMITE_PETICIONES = 120;
const VENTANA_SEGUNDOS = 60;

// service_role a propósito, igual que las otras funciones de ingesta: escribe
// en cualquier tenant y RLS no la protege. El aislamiento depende de que cada
// escritura lleve su `tenant_id` explícito, resuelto desde `tenant_api_keys`.
const db: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** SHA-256 en hex — la base guarda el hash, nunca la clave. */
async function hashear(clave: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clave));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Valida que un campo sea texto y no exceda su tope. Devuelve el texto limpio,
 * o null si vino vacío. Lanza si el tipo es incorrecto o se pasa de largo.
 *
 * Existe porque las `interface` de TypeScript no validan nada en tiempo de
 * ejecución: si `nombre` llega como número o como array, `.trim()` explota y
 * cae en el 500 genérico. Acá se convierte en un 400 con motivo legible.
 */
function texto(valor: unknown, campo: string, tope: number): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "string") {
    throw new ErrorDeEntrada(`"${campo}" tiene que ser texto`);
  }
  const limpio = valor.trim();
  if (limpio === "") return null;
  if (limpio.length > tope) {
    throw new ErrorDeEntrada(`"${campo}" supera el máximo de ${tope} caracteres`);
  }
  return limpio;
}

class ErrorDeEntrada extends Error {}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // Header Authorization, no el cuerpo: es la convención universal para una
  // API servidor-a-servidor. El widget manda su clave en el body porque la suya
  // es pública y viaja en un navegador; esta es un secreto real.
  const auth = req.headers.get("Authorization") ?? "";
  const clave = auth.replace(/^Bearer\s+/i, "").trim();
  if (!clave) {
    return json({ error: "falta la clave de API en el header Authorization" }, 401);
  }

  const { data: fila, error: errClave } = await db
    .from("tenant_api_keys")
    .select("id, tenant_id, activo")
    .eq("hash_clave", await hashear(clave))
    .maybeSingle();

  if (errClave) {
    console.error("[ingesta-api] tenant_api_keys:", errClave.message);
    return json({ error: "error interno" }, 500);
  }

  // Clave inválida o revocada: 404 opaco y NADA en webhook_errors. Misma
  // disciplina que ingesta-whatsapp y el widget — cualquiera en internet puede
  // mandar una clave inventada, y registrar eso sería dejar que un desconocido
  // llene la tabla a gusto. Tampoco se distingue "no existe" de "revocada": no
  // le sirve a un atacante saber cuál de las dos fue.
  if (!fila || !fila.activo) {
    return json({ error: "no encontrado" }, 404);
  }

  const tenantId = fila.tenant_id as string;

  // Límite de velocidad ANTES de tocar cualquier otra cosa: con una clave ya
  // validada, el costo de todo lo que sigue lo paga el tenant, y sin esto una
  // sola clave filtrada podría inundar la base.
  const { data: permitido, error: errLimite } = await db.rpc("registrar_uso_api", {
    p_tenant: tenantId,
    p_limite: LIMITE_PETICIONES,
    p_ventana_segundos: VENTANA_SEGUNDOS,
  });
  if (errLimite) {
    console.error("[ingesta-api] registrar_uso_api:", errLimite.message);
    return json({ error: "error interno" }, 500);
  }
  if (permitido === false) {
    return new Response(
      JSON.stringify({ error: "demasiadas peticiones", limite: LIMITE_PETICIONES, ventana_segundos: VENTANA_SEGUNDOS }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(VENTANA_SEGUNDOS) } },
    );
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "json_invalido" }, 400);
  }
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return json({ error: "el cuerpo tiene que ser un objeto JSON" }, 400);
  }

  let email: string | null, telefono: string | null, nombre: string | null;
  let empresa: string | null, externalId: string | null, mensaje: string | null;
  try {
    email = texto(cuerpo.email, "email", MAX.email);
    telefono = texto(cuerpo.telefono, "telefono", MAX.telefono);
    nombre = texto(cuerpo.nombre, "nombre", MAX.nombre);
    empresa = texto(cuerpo.empresa, "empresa", MAX.empresa);
    externalId = texto(cuerpo.external_id, "external_id", MAX.external_id);
    mensaje = texto(cuerpo.mensaje, "mensaje", MAX.mensaje);
  } catch (err) {
    if (err instanceof ErrorDeEntrada) return json({ error: err.message }, 400);
    throw err;
  }

  if (!email && !telefono && !externalId) {
    return json(
      { error: "hace falta al menos uno de: email, telefono, external_id" },
      400,
    );
  }

  // Contacto: la función de Postgres arbitra la identidad y las carreras (mismo
  // criterio que H3/H4 — un check-then-insert desde acá dejaría contactos
  // huérfanos sin canal cuando dos peticiones del mismo lead llegan a la vez).
  const { data: contactId, error: errContacto } = await db.rpc("resolver_contacto_api", {
    p_tenant: tenantId,
    p_external_id: externalId,
    p_email: email,
    p_telefono: telefono,
    p_nombre: nombre,
    p_empresa: empresa,
  });
  if (errContacto) {
    console.error("[ingesta-api] resolver_contacto_api:", errContacto.message);
    await registrarError(errContacto.message, cuerpo, tenantId, "contacto");
    return json({ error: "no se pudo registrar el lead" }, 500);
  }

  // Atribución de campaña, si vino. `contact_touchpoints` ya existe justamente
  // para esto — no hace falta inventar nada.
  await registrarTouchpoint(tenantId, contactId as number, cuerpo);

  let conversationId: number | null = null;
  let messageId: number | null = null;

  // La consulta es opcional: un lead puede ser solo un contacto (alguien que
  // dejó sus datos) o traer texto. Solo si trae texto se abre conversación, y
  // solo entonces se dispara el Router.
  if (mensaje) {
    const { data: convId, error: errConv } = await db.rpc("resolver_conversacion_canal", {
      p_tenant: tenantId,
      p_contact: contactId,
      p_canal: "api",
    });
    if (errConv) {
      console.error("[ingesta-api] resolver_conversacion_canal:", errConv.message);
      await registrarError(errConv.message, cuerpo, tenantId, "conversacion");
      return json({ error: "el lead se guardó pero no se pudo abrir la conversación", contact_id: contactId }, 500);
    }
    conversationId = convId as number;

    // Al insertar esto se dispara el trigger del Router, que clasifica el lead
    // y le crea la oportunidad. Nada de eso se hace acá.
    const { data: msg, error: errMsg } = await db
      .from("messages")
      .insert({
        conversation_id: conversationId,
        direccion: "in",
        canal: "api",
        contenido: mensaje,
        externo_id: externalId,
        entregado: true,
        entregado_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    // 23505 = unique_violation sobre (conversation_id, externo_id): el tenant
    // reintentó con el mismo external_id y el mensaje ya estaba. Es éxito, no
    // error — mismo criterio de idempotencia que ingesta-whatsapp.
    if (errMsg && errMsg.code !== "23505") {
      console.error("[ingesta-api] messages:", errMsg.message);
      await registrarError(errMsg.message, cuerpo, tenantId, "mensaje");
      return json({ error: "el lead se guardó pero no se pudo registrar la consulta", contact_id: contactId }, 500);
    }
    messageId = msg?.id ?? null;

    await db
      .from("conversations")
      .update({ ultimo_mensaje_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  // Sello de último uso, para que el admin pueda ver en la pantalla de claves
  // cuál sigue viva y cuál quedó olvidada. No se espera: que falle no debe
  // hacer fallar la ingesta del lead.
  db.from("tenant_api_keys")
    .update({ ultimo_uso_at: new Date().toISOString() })
    .eq("id", fila.id)
    .then(undefined, (e: unknown) => console.error("[ingesta-api] ultimo_uso_at:", e));

  return json(
    { ok: true, contact_id: contactId, conversation_id: conversationId, message_id: messageId },
    200,
  );
});

/**
 * Atribución de campaña. Solo escribe si vino al menos un dato — una fila de
 * touchpoint vacía no dice nada y ensucia los informes.
 */
async function registrarTouchpoint(
  tenantId: string,
  contactId: number,
  cuerpo: Record<string, unknown>,
) {
  const campos: Record<string, string | null> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = cuerpo[k];
    if (typeof v === "string" && v.trim() !== "") campos[k] = v.trim().slice(0, MAX.utm);
  }
  const referrer = typeof cuerpo.referrer === "string" ? cuerpo.referrer.slice(0, MAX.utm) : null;
  const landing = typeof cuerpo.landing_page === "string" ? cuerpo.landing_page.slice(0, MAX.utm) : null;

  if (Object.keys(campos).length === 0 && !referrer && !landing) return;

  const { error } = await db.from("contact_touchpoints").insert({
    tenant_id: tenantId,
    contact_id: contactId,
    canal: "api",
    ...campos,
    referrer,
    landing_page: landing,
  });
  // Que falle la atribución no puede tumbar la ingesta del lead: el lead vale
  // mucho más que su UTM.
  if (error) console.error("[ingesta-api] contact_touchpoints:", error.message);
}

/** Solo se llama con un tenant ya autenticado — ver el comentario del 404. */
async function registrarError(
  error: string,
  payload: unknown,
  tenantId: string,
  evento: string,
) {
  await db.from("webhook_errors").insert({
    tenant_id: tenantId,
    origen: "api",
    evento,
    error,
    payload: payload as Record<string, unknown>,
  });
}
