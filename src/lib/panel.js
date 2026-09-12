import { supabase } from "./supabase.js";
import { CANALES } from "./canales.js";

// Métricas del panel del tenant — lo que cada empresa-cliente ve sobre SU
// propio negocio. (El panel de plataforma, el del equipo que opera Candy CRM,
// es otra pantalla y no pasa por acá.)
//
// v1 agrega del lado del cliente a propósito, sin vista SQL ni tabla de
// snapshots: el volumen hoy es mínimo y las métricas van a cambiar seguido —
// iterar sobre JS es más barato que sobre migraciones. Cuando un tenant tenga
// miles de filas, esto se muda a una vista `security_invoker` (patrón de
// `inbox_conversaciones`) o a poblar `metrics_snapshots`, que ya existe para eso.
//
// NO se filtra por tenant_id a mano, a diferencia de catalogo.js: estas tablas
// no tienen policy pública, así que la RLS ya alcanza. Y hace algo que conviene
// no romper — un `agent` solo ve sus propios deals y conversaciones
// (`owner_id = auth.uid()`), mientras que un `owner`/`admin` ve los de todo el
// tenant. El panel hereda esa diferencia sin una línea extra.

const DIAS_ACTIVIDAD = 14;
const DIAS_NUEVOS = 30;
const DIAS_CIERRE = 90; // ventana para conversión / ciclo / ingreso ganado

/** Etiqueta legible de un canal/fuente; cae al valor crudo si no lo conocemos. */
function etiquetaOrigen(valor) {
  if (!valor) return "Sin dato";
  return CANALES[valor]?.etiqueta ?? valor;
}

function haceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** yyyy-mm-dd local, para agrupar por día sin que el huso corra las fechas. */
function claveDia(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Cuenta por clave y devuelve [{ etiqueta, cantidad, pct }] ordenado desc. */
function distribucion(filas, campo) {
  const total = filas.length;
  if (!total) return [];
  const cuenta = new Map();
  for (const f of filas) {
    const k = f[campo] ?? null;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .map(([k, cantidad]) => ({
      clave: k,
      etiqueta: etiquetaOrigen(k),
      cantidad,
      pct: Math.round((cantidad / total) * 100),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

/** Promedio de una lista de números; null si está vacía (nunca 0, que mentiría). */
function promedio(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const VACIO = {
  resumen: {
    convsAbiertas: 0,
    contactos: 0,
    contactosNuevos: 0,
    oportunidades: 0,
    valorPipeline: 0,
    forecast: 0,
  },
  cierre: {
    ganadas: 0,
    perdidas: 0,
    tasaConversion: null,
    horasCicloPromedio: null,
    ingresoGanado: 0,
    estancadas: 0,
  },
  atribucion: {
    cobertura: { conTouchpoint: 0, totalContactos: 0 },
    clasificacion: [],
    origenPorPipeline: [],
  },
  autonomiaIA: { movimientosBot: 0, movimientosHumano: 0, cierresBot: 0, cierresTotales: 0 },
  tiempoPorEtapa: [],
  embudo: [],
  motivosPerdida: [],
  pipeline: [],
  canales: [],
  actividad: [],
  hayDatos: false,
  hayHistorial: false,
};

/** "3 d", "6 h", "45 min" — para los promedios de tiempo por etapa y ciclo. */
export function formatearDuracion(horas) {
  if (horas == null) return "—";
  if (horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas < 48) return `${Math.round(horas)} h`;
  return `${Math.round(horas / 24)} d`;
}

export async function obtenerMetricasPanel() {
  const { data: sesion } = await supabase.auth.getSession();
  if (!sesion?.session?.user?.app_metadata?.tenant_id) return VACIO;

  const desdeActividad = haceDias(DIAS_ACTIVIDAD).toISOString();
  const desdeNuevos = haceDias(DIAS_NUEVOS).toISOString();

  const [deals, etapas, embudos, conversaciones, contactos, mensajes, eventos, toques] =
    await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, valor_estimado, probabilidad, fuente, stage_id, pipeline_id, created_at, closed_at, stage_changed_at",
      ),
    supabase.from("pipeline_stages").select("id, nombre, orden, color, tipo, horas_alerta"),
    // Los embudos, para poder cruzar el origen del lead con el TIPO de venta en
    // que terminó (transaccional / consultivo / expansión). Se consulta el tipo,
    // no el nombre: el nombre lo elige cada tenant.
    supabase.from("pipelines").select("id, nombre, tipo"),
    supabase.from("conversations").select("id, canal, estado, created_at"),
    supabase.from("contacts").select("id, origen, created_at"),
    // `messages` no tiene tenant_id: su RLS cuelga de conversations, y por eso
    // esta consulta ya viene aislada sin filtro explícito.
    supabase.from("messages").select("id, direccion, created_at").gte("created_at", desdeActividad),
    // Se traen los `stage_id` crudos y se resuelven contra las `pipeline_stages`
    // que ya se cargan arriba, en vez de pedirle a PostgREST que embeba los
    // nombres. A propósito: `deal_events` tiene DOS foreign keys a
    // `pipeline_stages` (de_stage_id y a_stage_id, ambas compuestas), y ese
    // embed exige el nombre completo del constraint como hint — nombrar la
    // columna a secas devuelve PGRST200 (lo comprobamos contra el API real al
    // construir el tablero). Resolver localmente evita esa fragilidad y no
    // cuesta una consulta extra, porque las etapas ya están pedidas.
    supabase
      .from("deal_events")
      .select("deal_id, actor, motivo, created_at, de_stage_id, a_stage_id")
      .order("deal_id", { ascending: true })
      .order("created_at", { ascending: true }),
    // Atribución del origen. La RLS de esta tabla es "tenant + (admin o dueño
    // del contacto)", así que un vendedor ve los toques de SUS contactos y un
    // admin los de todo el tenant — misma asimetría que el resto del panel.
    supabase
      .from("contact_touchpoints")
      .select("contact_id, ad_id, ctwa_clid, utm_source, referrer"),
  ]);

  for (const [nombre, res] of [
    ["deals", deals],
    ["pipeline_stages", etapas],
    ["pipelines", embudos],
    ["conversations", conversaciones],
    ["contacts", contactos],
    ["messages", mensajes],
    ["deal_events", eventos],
    ["contact_touchpoints", toques],
  ]) {
    if (res.error) throw new Error(`${nombre}: ${res.error.message}`);
  }

  const filasDeals = deals.data ?? [];
  const filasConvs = conversaciones.data ?? [];
  const filasContactos = contactos.data ?? [];
  const filasMensajes = mensajes.data ?? [];
  const filasEventos = eventos.data ?? [];
  const filasToques = toques.data ?? [];

  // Índice de etapas por id: lo usan casi todos los bloques de abajo para
  // resolver nombre, color y sobre todo `tipo` (ganada/perdida/abierta).
  const etapasPorId = new Map((etapas.data ?? []).map((e) => [e.id, e]));

  // --- Resumen ---
  const valorPipeline = filasDeals.reduce((s, d) => s + Number(d.valor_estimado ?? 0), 0);
  // Forecast ponderado: cada oportunidad vale su monto por su probabilidad de
  // cierre. Sin probabilidad cargada suma 0, no el monto entero — preferimos
  // quedarnos cortos antes que inflar una previsión.
  const forecast = filasDeals.reduce(
    (s, d) => s + (Number(d.valor_estimado ?? 0) * Number(d.probabilidad ?? 0)) / 100,
    0,
  );

  const resumen = {
    convsAbiertas: filasConvs.filter((c) => c.estado === "abierta").length,
    contactos: filasContactos.length,
    contactosNuevos: filasContactos.filter((c) => c.created_at >= desdeNuevos).length,
    oportunidades: filasDeals.length,
    valorPipeline,
    forecast,
  };

  // --- Pipeline por etapa ---
  // Se listan solo las etapas que tienen al menos un deal: un tenant nuevo
  // arranca con 7 etapas vacías y mostrarlas todas en cero es puro ruido.
  const porEtapa = new Map();
  for (const d of filasDeals) {
    const actual = porEtapa.get(d.stage_id) ?? { cantidad: 0, valor: 0 };
    actual.cantidad += 1;
    actual.valor += Number(d.valor_estimado ?? 0);
    porEtapa.set(d.stage_id, actual);
  }
  const pipeline = [...porEtapa.entries()]
    .map(([stageId, v]) => {
      const e = etapasPorId.get(stageId);
      return {
        etapa: e?.nombre ?? "Sin etapa",
        color: e?.color ?? "#9b8fb5",
        orden: e?.orden ?? 999,
        cantidad: v.cantidad,
        valor: v.valor,
      };
    })
    .sort((a, b) => a.orden - b.orden);

  // --- Cierre: conversión, ciclo de venta, ingreso ganado ---
  // Estas tres eran imposibles hasta el 11 sep: necesitaban `deals.closed_at` y
  // `pipeline_stages.tipo`. Se consulta `tipo`, NUNCA el nombre de la etapa —
  // los nombres los elige cada tenant y ya difieren entre embudos ('Ganado' vs
  // 'Cerrado ganado').
  const desdeCierre = haceDias(DIAS_CIERRE).toISOString();
  const cerradasEnVentana = filasDeals.filter((d) => d.closed_at && d.closed_at >= desdeCierre);
  const ganadas = cerradasEnVentana.filter((d) => etapasPorId.get(d.stage_id)?.tipo === "ganada");
  const perdidas = cerradasEnVentana.filter((d) => etapasPorId.get(d.stage_id)?.tipo === "perdida");

  const horasCiclo = ganadas
    .map((d) => (new Date(d.closed_at) - new Date(d.created_at)) / 3600000)
    .filter((h) => Number.isFinite(h) && h >= 0);

  // Oportunidades abiertas que pasaron su umbral de "sin moverse". El umbral es
  // por etapa (`horas_alerta`), no una constante — el ritmo de un alquiler de 3
  // noches no es el de un ERP de 6 meses.
  const ahora = Date.now();
  const estancadas = filasDeals.filter((d) => {
    if (d.closed_at) return false;
    const umbral = etapasPorId.get(d.stage_id)?.horas_alerta;
    if (umbral == null || !d.stage_changed_at) return false;
    return (ahora - new Date(d.stage_changed_at)) / 3600000 >= umbral;
  }).length;

  const decididas = ganadas.length + perdidas.length;
  const cierre = {
    ganadas: ganadas.length,
    perdidas: perdidas.length,
    // Tasa de cierre sobre las DECIDIDAS, no sobre el total: incluir las
    // abiertas en el denominador haría bajar la tasa solo porque entraron
    // oportunidades nuevas, que es justo lo contrario de lo que uno quiere leer.
    tasaConversion: decididas ? Math.round((ganadas.length / decididas) * 100) : null,
    horasCicloPromedio: promedio(horasCiclo),
    ingresoGanado: ganadas.reduce((s, d) => s + Number(d.valor_estimado ?? 0), 0),
    estancadas,
  };

  // --- Autonomía de la IA: cuánto mueve y cuánto cierra el bot solo ---
  // Es el indicador que justifica (o no) toda la inversión en agentes del
  // proyecto. Sale de `deal_events.actor`, que audit_log no puede darnos porque
  // su columna `actor` es uuid y el bot no tiene usuario.
  const idsEtapasGanadas = new Set(
    (etapas.data ?? []).filter((e) => e.tipo === "ganada").map((e) => e.id),
  );
  const cierresEventos = filasEventos.filter((e) => idsEtapasGanadas.has(e.a_stage_id));
  const autonomiaIA = {
    movimientosBot: filasEventos.filter((e) => e.actor === "bot").length,
    movimientosHumano: filasEventos.filter((e) => e.actor === "humano").length,
    cierresBot: cierresEventos.filter((e) => e.actor === "bot").length,
    cierresTotales: cierresEventos.length,
  };

  // --- Tiempo promedio por etapa ---
  // Entre dos eventos consecutivos del mismo deal, el tiempo que pasó se le
  // atribuye a la etapa de ORIGEN: es la etapa donde el deal estuvo esperando.
  // Responde "dónde se atasca el proceso", que es distinto de cuánto tarda en
  // total — el dato que el ciclo de venta promedio esconde.
  const horasPorEtapa = new Map();
  for (let i = 1; i < filasEventos.length; i++) {
    const previo = filasEventos[i - 1];
    const actual = filasEventos[i];
    if (previo.deal_id !== actual.deal_id) continue; // vienen ordenados por deal
    const horas = (new Date(actual.created_at) - new Date(previo.created_at)) / 3600000;
    if (!Number.isFinite(horas) || horas < 0) continue;
    const etapaOrigen = previo.a_stage_id; // donde el deal estaba esperando
    if (!horasPorEtapa.has(etapaOrigen)) horasPorEtapa.set(etapaOrigen, []);
    horasPorEtapa.get(etapaOrigen).push(horas);
  }
  const tiempoPorEtapa = [...horasPorEtapa.entries()]
    .map(([stageId, horas]) => {
      const e = etapasPorId.get(stageId);
      return {
        etapa: e?.nombre ?? "Sin etapa",
        color: e?.color ?? "#9b8fb5",
        orden: e?.orden ?? 999,
        horasPromedio: promedio(horas),
        muestras: horas.length,
      };
    })
    .sort((a, b) => a.orden - b.orden);

  // --- Embudo de caída, etapa por etapa ---
  // De las oportunidades que ALGUNA VEZ llegaron a una etapa, cuántas siguieron
  // adelante. Se calcula sobre el historial, no sobre la posición actual: un
  // deal que ya está en "Ganado" pasó antes por "Propuesta", y ese paso tiene
  // que contar. Sin `deal_events` esto era imposible de reconstruir.
  const alcanceEtapa = new Map(); // stage_id -> Set(deal_id)
  for (const e of filasEventos) {
    if (!alcanceEtapa.has(e.a_stage_id)) alcanceEtapa.set(e.a_stage_id, new Set());
    alcanceEtapa.get(e.a_stage_id).add(e.deal_id);
  }
  const etapasAbiertasOrdenadas = (etapas.data ?? [])
    .filter((e) => e.tipo === "abierta")
    .sort((a, b) => a.orden - b.orden);

  // "Avanzar" NO es "llegó a la etapa abierta siguiente": una oportunidad puede
  // saltarse etapas y ganarse directo desde Propuesta, y contarla como abandono
  // sería exactamente al revés de la verdad. Avanzar = llegó a CUALQUIER etapa
  // posterior que no sea una pérdida — o sea, siguió avanzando o se ganó.
  // Se detectó al probar con datos reales: sin esto, el embudo marcaba 0% justo
  // en la etapa donde la venta se cerró bien.
  const etapasPosterioresUtiles = (orden) =>
    (etapas.data ?? []).filter((e) => e.orden > orden && e.tipo !== "perdida").map((e) => e.id);

  const embudo = etapasAbiertasOrdenadas
    .map((e) => {
      const dealsQueLlegaron = alcanceEtapa.get(e.id) ?? new Set();
      const llegaron = dealsQueLlegaron.size;

      const posteriores = etapasPosterioresUtiles(e.orden);
      const avanzaron = posteriores.length
        ? [...dealsQueLlegaron].filter((dealId) =>
            posteriores.some((sid) => alcanceEtapa.get(sid)?.has(dealId)),
          ).length
        : null; // es la última etapa abierta: no hay "después" que medir

      return {
        etapa: e.nombre,
        color: e.color,
        llegaron,
        siguieron: avanzaron,
        pctSiguio: llegaron && avanzaron != null ? Math.round((avanzaron / llegaron) * 100) : null,
      };
    })
    .filter((f) => f.llegaron > 0);

  // --- Motivos de pérdida ---
  // `mover_deal()` exige motivo al perder, así que este dato no tiene huecos
  // para las pérdidas registradas por el tablero.
  const idsEtapasPerdidas = new Set(
    (etapas.data ?? []).filter((e) => e.tipo === "perdida").map((e) => e.id),
  );
  const conteoMotivos = new Map();
  for (const e of filasEventos) {
    if (!idsEtapasPerdidas.has(e.a_stage_id)) continue;
    const motivo = (e.motivo ?? "").trim() || "Sin motivo registrado";
    conteoMotivos.set(motivo, (conteoMotivos.get(motivo) ?? 0) + 1);
  }
  const totalPerdidasConMotivo = [...conteoMotivos.values()].reduce((a, b) => a + b, 0);
  const motivosPerdida = [...conteoMotivos.entries()]
    .map(([motivo, cantidad]) => ({
      motivo,
      cantidad,
      pct: Math.round((cantidad / totalPerdidasConMotivo) * 100),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  // --- Atribución del origen del lead (Grupo 1 de docs/indicadores-dashboard.md) ---
  //
  // Dos indicadores, con niveles de confianza MUY distintos, y por eso se
  // presentan separados en la pantalla:
  //
  //   #15 origenPorPipeline — cobertura 100%. Sale de `deals` solo, y `fuente`
  //        existe en cada oportunidad. Lo que se lee acá es verdad completa.
  //   #2  clasificacion — cobertura parcial. Depende de que exista un
  //        `contact_touchpoints` para ese contacto, y hoy casi ninguno lo tiene
  //        (solo los que entraron por ingesta-api o por un anuncio de WhatsApp).
  //        Por eso viaja junto con su `cobertura`: sin ese número al lado, "2
  //        referidos" se leería como "solo 2 personas nos visitaron" en vez de
  //        "solo 2 tienen el dato guardado".

  // #2 — Fuente real. Se clasifica por el toque MÁS informativo de cada
  // contacto, no por el primero: si alguien tiene un toque con anuncio y otro
  // sin nada, lo que importa es que hubo un anuncio.
  const toquesPorContacto = new Map();
  for (const t of filasToques) {
    if (t.contact_id == null) continue; // toque anónimo, sin contacto asociado todavía
    if (!toquesPorContacto.has(t.contact_id)) toquesPorContacto.set(t.contact_id, []);
    toquesPorContacto.get(t.contact_id).push(t);
  }

  const PESO = { pagado: 3, campana: 2, referido: 1 };
  function clasificarToque(t) {
    if (t.ad_id || t.ctwa_clid) return "pagado";
    if (t.utm_source) return "campana";
    if (t.referrer) return "referido";
    return null; // fila de touchpoint sin ninguna señal de origen
  }

  const ETIQUETA_FUENTE = {
    pagado: "Pagado (anuncio)",
    campana: "Campaña (UTM)",
    referido: "Referido (otro sitio)",
    directo: "Directo / sin rastro",
  };

  const conteoFuente = { pagado: 0, campana: 0, referido: 0, directo: 0 };
  for (const c of filasContactos) {
    const suyos = toquesPorContacto.get(c.id) ?? [];
    let mejor = null;
    for (const t of suyos) {
      const clase = clasificarToque(t);
      if (clase && (!mejor || PESO[clase] > PESO[mejor])) mejor = clase;
    }
    // Sin toque, o con toques que no traían ninguna señal: "directo / sin
    // rastro". Es la categoría honesta — no sabemos de dónde vino, y decir eso
    // es más útil que repartirlo entre las otras con un supuesto.
    conteoFuente[mejor ?? "directo"] += 1;
  }

  const totalContactos = filasContactos.length;
  const clasificacion = Object.entries(conteoFuente)
    .filter(([, cantidad]) => cantidad > 0)
    .map(([clave, cantidad]) => ({
      clave,
      etiqueta: ETIQUETA_FUENTE[clave],
      cantidad,
      pct: totalContactos ? Math.round((cantidad / totalContactos) * 100) : 0,
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  // #15 — Origen cruzado con embudo. Una fila por combinación real de
  // (canal de entrada × tipo de embudo), con su valor: el canal que trae MÁS
  // leads no es siempre el que trae MÁS dinero, y esto es lo que lo muestra.
  const embudosPorId = new Map((embudos.data ?? []).map((p) => [p.id, p]));
  const TIPO_EMBUDO = {
    transaccional: "Transaccional",
    consultivo: "Consultivo",
    expansion: "Expansión",
  };

  const cruce = new Map();
  for (const d of filasDeals) {
    const embudo = embudosPorId.get(d.pipeline_id);
    const tipo = embudo?.tipo ?? "sin-embudo";
    const clave = `${d.fuente}||${tipo}`;
    const actual = cruce.get(clave) ?? { fuente: d.fuente, tipo, cantidad: 0, valor: 0 };
    actual.cantidad += 1;
    actual.valor += Number(d.valor_estimado ?? 0);
    cruce.set(clave, actual);
  }

  const origenPorPipeline = [...cruce.values()]
    .map((f) => ({
      fuente: etiquetaOrigen(f.fuente),
      tipoEmbudo: TIPO_EMBUDO[f.tipo] ?? "Sin embudo",
      cantidad: f.cantidad,
      valor: f.valor,
      pct: filasDeals.length ? Math.round((f.cantidad / filasDeals.length) * 100) : 0,
    }))
    .sort((a, b) => b.valor - a.valor || b.cantidad - a.cantidad);

  const atribucion = {
    cobertura: {
      conTouchpoint: toquesPorContacto.size,
      totalContactos,
    },
    clasificacion,
    origenPorPipeline,
  };

  // --- Actividad de los últimos días ---
  const porDia = new Map();
  for (let i = DIAS_ACTIVIDAD - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    porDia.set(claveDia(d), { dia: claveDia(d), entrantes: 0, salientes: 0 });
  }
  for (const m of filasMensajes) {
    const fila = porDia.get(claveDia(m.created_at));
    if (!fila) continue; // fuera de la ventana por diferencia de huso
    if (m.direccion === "out") fila.salientes += 1;
    else fila.entrantes += 1;
  }

  return {
    resumen,
    cierre,
    atribucion,
    autonomiaIA,
    tiempoPorEtapa,
    embudo,
    motivosPerdida,
    pipeline,
    // `origen` (distribución de deals por fuente) se quitó el 12 sep: el cruce
    // origen × tipo de embudo de `atribucion.origenPorPipeline` muestra lo mismo
    // y además el tipo de venta y el valor. Tener los dos era responder la
    // misma pregunta dos veces en la misma pantalla.
    canales: distribucion(filasConvs, "canal"),
    actividad: [...porDia.values()],
    hayDatos: filasDeals.length + filasConvs.length + filasContactos.length > 0,
    // Distingue "no hay historial todavía" de "hay historial y da cero" — la UI
    // necesita esa diferencia para no mostrar un embudo vacío como si fuera un
    // embudo con 0% de conversión.
    hayHistorial: filasEventos.length > 0,
  };
}
