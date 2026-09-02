// Router de clasificación de leads (candidato [5] de docs/DECISIONES.md,
// Paso 02 de docs/hoja-de-ruta-construccion.md, secciones 2.1-2.3 de guia-fases-1-2).
//
// No le habla al cliente. Es un paso de DECISIÓN que corre antes de que cualquier
// agente responda: mira el mensaje que acaba de entrar y decide a qué pipeline
// pertenece el lead (transaccional / consultivo / expansión).
//
// Se dispara con un Database Webhook sobre `insert` en `messages`. Eso es
// deliberado y no un detalle: cualquier canal que escriba en esa tabla — WhatsApp,
// el widget web vía n8n, lo que venga después — queda clasificado sin que ese
// canal tenga que acordarse de llamar al Router.
//
// Dos capas, en orden:
//   1. `routing_rules` — señales duras. Rápido y sin costo de LLM. Resuelve la mayoría.
//   2. Claude Haiku con salida estructurada. Solo si las reglas no resolvieron.
//
// Ante baja confianza va a consultivo, nunca a transaccional: el costo de calificar
// de más es bajo, el de perder un lead grande es alto.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ROUTER_SECRET = Deno.env.get("ROUTER_SECRET") ?? "";
const MODELO = "claude-haiku-4-5-20251001";

// Debajo de esto no se le cree al modelo y se cae al pipeline por defecto.
const UMBRAL_CONFIANZA = 0.6;

// Igual que la ingesta: service_role salta RLS, así que cada consulta y cada
// escritura llevan su `tenant_id` explícito. Ver docs/guia-fases-1-2.md, Paso 2.
const db: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

type Pipeline = { id: number; tipo: string; nombre: string };
type Decision = {
  pipeline: Pipeline;
  capa: "reglas" | "semantica";
  regla: string | null;
  confianza: number | null;
  senales: string[];
};

// ---------------------------------------------------------------------------
// Capa 1 — reglas determinísticas
// ---------------------------------------------------------------------------

/** Evalúa una regla contra el mensaje y el contacto. */
function reglaMatchea(regla: any, contenido: string, contacto: any): boolean {
  const valores: Record<string, string> = {
    contenido,
    origen: contacto?.origen ?? "",
    email_dominio: String(contacto?.email ?? "").split("@")[1] ?? "",
    telefono: contacto?.telefono ?? "",
  };
  const dato = valores[String(regla.campo)] ?? "";

  switch (regla.operador) {
    case "contiene":
      return dato.toLowerCase().includes(String(regla.valor).toLowerCase());
    case "igual":
      return dato.toLowerCase() === String(regla.valor).toLowerCase();
    case "regex":
      // Una regla mal escrita no puede tumbar la clasificación entera: si el
      // patrón no compila, esa regla no matchea y se sigue con la siguiente.
      try {
        return new RegExp(regla.valor).test(dato);
      } catch {
        console.error("[router] regex inválida en la regla:", regla.nombre);
        return false;
      }
    default:
      return false;
  }
}

/** Primera regla que matchea, por prioridad ascendente. Null si ninguna. */
async function porReglas(
  tenantId: string,
  contenido: string,
  contacto: any,
  pipelines: Pipeline[],
): Promise<Decision | null> {
  const { data: reglas, error } = await db
    .from("routing_rules")
    .select("nombre, campo, operador, valor, pipeline_id, prioridad")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .order("prioridad", { ascending: true });

  if (error) throw new Error("routing_rules: " + error.message);

  for (const regla of reglas ?? []) {
    if (!reglaMatchea(regla, contenido, contacto)) continue;
    const pipeline = pipelines.find((p) => p.id === regla.pipeline_id);
    if (!pipeline) continue; // la regla apunta a un pipeline inactivo o borrado
    return {
      pipeline,
      capa: "reglas",
      regla: regla.nombre,
      confianza: null, // una regla determinística no tiene confianza: matcheó o no
      senales: ["regla: " + regla.nombre],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capa 2 — semántica
// ---------------------------------------------------------------------------

/**
 * Clasificación con Claude Haiku, forzando salida estructurada por tool use
 * (más confiable que pedir JSON en el prompt y after parsearlo).
 *
 * Devuelve null si no hay API key o si la llamada falla. El llamador decide el
 * fallback, y eso queda registrado con honestidad en `router_decisions` — nunca
 * se inventa una decisión del modelo que el modelo no tomó.
 */
async function porSemantica(
  contenido: string,
  historial: string[],
): Promise<{ tipo: string; confianza: number; senales: string[] } | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const herramienta = {
    name: "clasificar_lead",
    description: "Clasifica el lead en uno de los tres pipelines del CRM.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["transaccional", "consultivo", "expansion"],
          description:
            "transaccional: compra chica y directa, se resuelve sola. " +
            "consultivo: hay empresa, equipo o necesidad compleja detrás. " +
            "expansion: cliente que ya compró y quiere ampliar o renovar.",
        },
        confianza: { type: "number", description: "Entre 0 y 1." },
        senales: {
          type: "array",
          items: { type: "string" },
          description: "Señales concretas del texto que sostienen la decisión.",
        },
      },
      required: ["tipo", "confianza", "senales"],
    },
  };

  const contexto = historial.length
    ? "Mensajes previos de esta conversación:\n" + historial.join("\n") + "\n\n"
    : "";

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 512,
        system:
          "Sos un clasificador de leads de un CRM. No conversás con nadie: solo " +
          "clasificás. Ante duda entre transaccional y consultivo, elegí consultivo " +
          "y bajá la confianza — perder un lead grande cuesta mucho más que " +
          "calificar de más a uno chico.",
        tools: [herramienta],
        tool_choice: { type: "tool", name: "clasificar_lead" },
        messages: [
          { role: "user", content: contexto + "Mensaje nuevo:\n" + contenido },
        ],
      }),
    });
  } catch (err) {
    console.error("[router] no se pudo llamar a Anthropic:", err);
    return null;
  }

  if (!res.ok) {
    console.error("[router] Anthropic " + res.status + ":", await res.text());
    return null;
  }

  const json = await res.json();
  const uso = (json.content ?? []).find((c: any) => c.type === "tool_use");
  if (!uso?.input) return null;

  return {
    tipo: String(uso.input.tipo),
    confianza: Number(uso.input.confianza),
    senales: Array.isArray(uso.input.senales) ? uso.input.senales : [],
  };
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

// Solo se usa para no degradar automáticamente. No es un ranking de valor:
// consultivo y expansión están al mismo nivel a propósito.
const RANGO: Record<string, number> = {
  transaccional: 1,
  consultivo: 2,
  expansion: 2,
};

async function ownerPorDefecto(tenantId: string): Promise<string> {
  const { data, error } = await db
    .from("team_members").select("user_id")
    .eq("tenant_id", tenantId).eq("rol", "owner").limit(1).maybeSingle();
  if (error) throw new Error("team_members: " + error.message);
  if (!data) throw new Error("el tenant " + tenantId + " no tiene miembro con rol owner");
  return data.user_id as string;
}

/** Primera etapa del pipeline, donde cae un deal recién clasificado. */
async function primeraEtapa(tenantId: string, pipelineId: number): Promise<number> {
  const { data, error } = await db
    .from("pipeline_stages").select("id")
    .eq("tenant_id", tenantId).eq("pipeline_id", pipelineId)
    .order("orden", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error("pipeline_stages: " + error.message);
  if (!data) throw new Error("el pipeline " + pipelineId + " no tiene etapas");
  return data.id as number;
}

/**
 * Aplica la decisión sobre el deal del contacto: lo crea si no existe, o lo
 * mueve de pipeline si corresponde escalarlo.
 *
 * `deals` cuelga del CONTACTO, no de la conversación — por eso se busca por
 * contact_id y no por conversation_id.
 */
async function aplicar(
  tenantId: string,
  contactId: number,
  conversationId: number,
  destino: Pipeline,
  esPrimerMensaje: boolean,
): Promise<{ dealId: number; transferido: boolean }> {
  const { data: existente, error: errBusca } = await db
    .from("deals").select("id, pipeline_id")
    .eq("tenant_id", tenantId).eq("contact_id", contactId)
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (errBusca) throw new Error("deals: " + errBusca.message);

  const stageId = await primeraEtapa(tenantId, destino.id);

  if (!existente) {
    const ownerId = await ownerPorDefecto(tenantId);
    const { data: nuevo, error } = await db.from("deals").insert({
      tenant_id: tenantId,
      contact_id: contactId,
      pipeline_id: destino.id,
      stage_id: stageId,
      fuente: "whatsapp",
      owner_id: ownerId,
    }).select("id").single();
    if (error) throw new Error("deals insert: " + error.message);
    return { dealId: nuevo.id as number, transferido: false };
  }

  if (existente.pipeline_id === destino.id) {
    return { dealId: existente.id as number, transferido: false };
  }

  // Tipo del pipeline actual, para distinguir escalar de degradar.
  const { data: actual } = await db.from("pipelines").select("id, tipo")
    .eq("tenant_id", tenantId).eq("id", existente.pipeline_id).maybeSingle();

  // Nunca degradar automáticamente a transaccional: un lead que ya fue tratado
  // como consultivo no vuelve solo al carril barato. Eso lo decide un humano.
  if (actual && RANGO[destino.tipo] < RANGO[actual.tipo]) {
    return { dealId: existente.id as number, transferido: false };
  }

  const { error: errMueve } = await db.from("deals")
    .update({ pipeline_id: destino.id, stage_id: stageId })
    .eq("tenant_id", tenantId).eq("id", existente.id);
  if (errMueve) throw new Error("deals update: " + errMueve.message);

  const { error: errTransfer } = await db.from("pipeline_transfers").insert({
    tenant_id: tenantId,
    deal_id: existente.id,
    conversation_id: conversationId,
    pipeline_origen_id: existente.pipeline_id,
    pipeline_destino_id: destino.id,
    detectado_por: "router",
    // Si no es el primer mensaje, veníamos atendiéndolo con el pipeline
    // equivocado: es la métrica de falla, no la de acierto.
    detectado_tarde: !esPrimerMensaje,
    motivo: "Reclasificado a " + destino.nombre,
  });
  if (errTransfer) throw new Error("pipeline_transfers: " + errTransfer.message);

  return { dealId: existente.id as number, transferido: true };
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

async function clasificar(mensaje: any) {
  // `messages` no tiene tenant_id: lo hereda de conversations, por diseño.
  const { data: conv, error: errConv } = await db
    .from("conversations").select("id, tenant_id, contact_id")
    .eq("id", mensaje.conversation_id).maybeSingle();
  if (errConv) throw new Error("conversations: " + errConv.message);
  if (!conv) throw new Error("conversación " + mensaje.conversation_id + " inexistente");

  const tenantId = conv.tenant_id as string;

  const { data: contacto } = await db.from("contacts")
    .select("id, origen, email, telefono")
    .eq("tenant_id", tenantId).eq("id", conv.contact_id).maybeSingle();

  const { data: pipelines, error: errPipes } = await db.from("pipelines")
    .select("id, tipo, nombre").eq("tenant_id", tenantId).eq("activo", true);
  if (errPipes) throw new Error("pipelines: " + errPipes.message);
  if (!pipelines?.length) {
    throw new Error("el tenant " + tenantId + " no tiene pipelines activos");
  }

  const porDefecto = (pipelines as Pipeline[]).find((p) => p.tipo === "consultivo")
    ?? (pipelines as Pipeline[])[0];
  const contenido = String(mensaje.contenido ?? "");

  // Historial para la capa semántica, y para saber si es el primer mensaje.
  // Se excluye el mensaje actual, que ya está guardado cuando esto corre.
  const { data: previos } = await db.from("messages")
    .select("id, contenido").eq("conversation_id", conv.id).eq("direccion", "in")
    .order("id", { ascending: true }).limit(10);
  const historial = (previos ?? [])
    .filter((m: any) => m.id !== mensaje.id)
    .map((m: any) => String(m.contenido));
  const esPrimerMensaje = historial.length === 0;

  // --- Capa 1: reglas ---
  let decision = await porReglas(tenantId, contenido, contacto, pipelines as Pipeline[]);

  // --- Capa 2: semántica, solo si las reglas no resolvieron ---
  if (!decision) {
    const sem = await porSemantica(contenido, historial);

    if (sem && sem.confianza >= UMBRAL_CONFIANZA) {
      const destino = (pipelines as Pipeline[]).find((p) => p.tipo === sem.tipo) ?? porDefecto;
      decision = {
        pipeline: destino,
        capa: "semantica",
        regla: null,
        confianza: sem.confianza,
        senales: sem.senales,
      };
    } else if (sem) {
      // El modelo respondió pero sin convicción: va al por defecto, y queda
      // registrada su confianza real para poder medir cuántas veces pasa.
      decision = {
        pipeline: porDefecto,
        capa: "semantica",
        regla: null,
        confianza: sem.confianza,
        senales: [
          ...sem.senales,
          "confianza " + sem.confianza + " < umbral " + UMBRAL_CONFIANZA,
        ],
      };
    } else {
      // Sin capa semántica disponible (falta la API key, o Anthropic falló).
      // Se declara como tal en vez de fingir una decisión del modelo.
      decision = {
        pipeline: porDefecto,
        capa: "reglas",
        regla: "fallback: ninguna regla matcheó y la capa semántica no respondió",
        confianza: null,
        senales: [],
      };
    }
  }

  const { dealId, transferido } = await aplicar(
    tenantId, conv.contact_id, conv.id, decision.pipeline, esPrimerMensaje,
  );

  const { error: errDec } = await db.from("router_decisions").insert({
    tenant_id: tenantId,
    conversation_id: conv.id,
    message_id: mensaje.id,
    pipeline_id: decision.pipeline.id,
    capa: decision.capa,
    regla_aplicada: decision.regla,
    confianza: decision.confianza,
    senales: decision.senales,
  });
  if (errDec) throw new Error("router_decisions: " + errDec.message);

  console.log(
    "[router] msg " + mensaje.id + " → " + decision.pipeline.nombre +
    " (" + decision.capa + (decision.regla ? ": " + decision.regla : "") + ")" +
    (transferido ? " · TRANSFERIDO" : "") + " · deal " + dealId,
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Corre con service_role: sin esto, cualquiera que descubra la URL podría
  // disparar clasificaciones y escribir deals. El secreto se configura como
  // header del Database Webhook en el panel de Supabase.
  if (!ROUTER_SECRET || req.headers.get("x-router-secret") !== ROUTER_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const mensaje = payload?.record;
  if (!mensaje?.id || !mensaje?.conversation_id) {
    return new Response("Sin record utilizable", { status: 200 });
  }

  // Solo entrantes: un mensaje que mandamos nosotros no reclasifica al lead.
  if (mensaje.direccion !== "in") {
    return new Response("Ignorado: saliente", { status: 200 });
  }

  try {
    await clasificar(mensaje);
  } catch (err) {
    console.error("[router]", err);
    await db.from("webhook_errors").insert({
      origen: "router",
      evento: "clasificar",
      error: err instanceof Error ? err.message : String(err),
      payload: mensaje,
    });
    // 200 igual: el webhook de Supabase no debe reintentar en loop una
    // clasificación que va a volver a fallar. El error ya quedó registrado.
    return new Response("Error registrado", { status: 200 });
  }

  return new Response("OK", { status: 200 });
});
